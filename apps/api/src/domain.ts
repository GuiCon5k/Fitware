import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Row } from "./db.js";
import { today, dateText, addDays, nextMonth } from "./dates.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const text = z.string().trim().min(1).max(180);
export const method = z.enum(["cash", "transfer"]);
export const orderSchema = z.object({
  member_id: text,
  plan_ids: z
    .array(text)
    .min(1)
    .max(15)
    .transform((ids) => [...new Set(ids)].sort()),
  partner_id: text.optional(),
  promotion_id: text.optional(),
  discount_cents: z.number().int().min(0).default(0),
  method,
  request_key: z.uuid(),
  expected_total_cents: z.number().int().min(0).optional(),
  expected_periods: z
    .array(
      z.object({
        member_id: text,
        plan_id: text,
        starts_on: z.iso.date(),
        ends_on: z.iso.date(),
      }),
    )
    .min(1)
    .max(30)
    .optional(),
});
export type OrderInput = z.infer<typeof orderSchema>;
export const fingerprint = (input: unknown) => JSON.stringify(input);
export async function quote(
  tx: Database,
  gymId: string,
  b: OrderInput,
  canDiscount: boolean,
  newMember?: { id: string; name: string },
) {
  const member =
    newMember ||
    (
      await tx.query(
        "SELECT * FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
        [b.member_id, gymId],
      )
    ).rows[0];
  if (!member) throw new HttpError(404, "Socio no encontrado en este gimnasio");
  const lines: Row[] = [];
  for (const id of b.plan_ids) {
    const plan = (
      await tx.query(
        "SELECT * FROM plans WHERE id=$1 AND gym_id=$2 AND active",
        [id, gymId],
      )
    ).rows[0];
    if (!plan) throw new HttpError(400, "Uno de los planes no está disponible");
    lines.push({
      member_id: member.id,
      member_name: member.name,
      plan,
      price_cents: plan.price_cents,
      discount_cents: 0,
    });
  }
  let promotion: Row | undefined,
    discount = 0;
  if (b.promotion_id) {
    promotion = (
      await tx.query(
        "SELECT * FROM promotions WHERE id=$1 AND gym_id=$2 AND active",
        [b.promotion_id, gymId],
      )
    ).rows[0];
    if (
      !promotion ||
      (promotion.starts_on && dateText(promotion.starts_on) > today()) ||
      (promotion.ends_on && dateText(promotion.ends_on) < today())
    )
      throw new HttpError(400, "La promoción no está vigente");
    const participants = (promotion.member_ids || []) as string[];
    if (participants.length) {
      const selected =
        promotion.kind === "two_for_one"
          ? [b.member_id, b.partner_id]
          : [b.member_id];
      if (
        selected.length !== participants.length ||
        selected.some((id) => !id || !participants.includes(id))
      )
        throw new HttpError(
          400,
          "Esta promoción corresponde a los socios indicados al crearla",
        );
    }
    const required = promotion.plan_ids as string[];
    if (required.length && required.some((id) => !b.plan_ids.includes(id)))
      throw new HttpError(
        400,
        "Faltan actividades requeridas por la promoción",
      );
    if (promotion.kind === "two_for_one") {
      if (
        b.plan_ids.length !== 1 ||
        !b.partner_id ||
        b.partner_id === b.member_id
      )
        throw new HttpError(
          400,
          "El 2x1 requiere un plan y dos socios diferentes",
        );
      if (required.length && required[0] !== b.plan_ids[0])
        throw new HttpError(400, "El plan no corresponde a esta promoción");
      const partner = (
        await tx.query(
          "SELECT * FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
          [b.partner_id, gymId],
        )
      ).rows[0];
      if (!partner)
        throw new HttpError(
          400,
          "El segundo socio no pertenece a este gimnasio",
        );
      lines.push({
        ...lines[0],
        member_id: partner.id,
        member_name: partner.name,
      });
      discount = lines[0].price_cents;
    } else {
      if (
        promotion.kind === "combo" &&
        (b.plan_ids.length < 2 ||
          new Set(lines.map((l) => l.plan.activity)).size !== lines.length)
      )
        throw new HttpError(
          400,
          "El combo requiere al menos dos actividades distintas",
        );
      if (required.length && b.plan_ids.some((id) => !required.includes(id)))
        throw new HttpError(
          400,
          "La promoción requiere exactamente los planes configurados",
        );
      const gross = lines.reduce((a, l) => a + l.price_cents, 0);
      discount =
        promotion.discount_type === "percent"
          ? Math.round((gross * promotion.value) / 100)
          : promotion.value;
    }
  }
  if (b.partner_id && promotion?.kind !== "two_for_one")
    throw new HttpError(
      400,
      "El segundo socio solo corresponde a una promoción 2x1",
    );
  if (b.discount_cents && !canDiscount)
    throw new HttpError(
      403,
      "No tenés permiso para aplicar descuentos manuales",
    );
  if (b.discount_cents && promotion)
    throw new HttpError(
      400,
      "No se acumulan promociones y descuentos manuales",
    );
  discount += b.discount_cents;
  const gross = lines.reduce((a, l) => a + l.price_cents, 0);
  if (gross > 1000000000)
    throw new HttpError(400, "El importe de la operación es demasiado alto");
  if (discount > gross)
    throw new HttpError(400, "El descuento supera el precio total");
  // Distribute cents exactly, including 2x1: both activities share the net price.
  let assigned = 0;
  lines.forEach((l, i) => {
    l.discount_cents =
      i === lines.length - 1
        ? discount - assigned
        : Number((BigInt(discount) * BigInt(l.price_cents)) / BigInt(gross));
    assigned += l.discount_cents;
    l.amount_cents = l.price_cents - l.discount_cents;
  });
  for (const l of lines) {
    const last = (
      await tx.query(
        "SELECT * FROM subscriptions WHERE member_id=$1 AND plan_id=$2 AND gym_id=$3 AND cancelled_at IS NULL ORDER BY ends_on DESC LIMIT 1",
        [l.member_id, l.plan.id, gymId],
      )
    ).rows[0];
    l.starts_on =
      last && dateText(last.ends_on) > today()
        ? dateText(last.ends_on)
        : today();
    const anchor =
      last && dateText(last.ends_on) >= today()
        ? last.anchor_day
        : Number(l.starts_on.slice(8));
    l.ends_on =
      l.plan.duration_unit === "month"
        ? nextMonth(l.starts_on, anchor)
        : addDays(l.starts_on, l.plan.duration_days);
  }
  return {
    lines,
    gross_cents: gross,
    discount_cents: discount,
    total_cents: gross - discount,
    promotion_name: promotion?.name || "",
  };
}
export async function charge(
  tx: Database,
  gymId: string,
  userId: string,
  b: OrderInput,
  canDiscount: boolean,
) {
  await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [gymId]);
  const existing = (
    await tx.query("SELECT * FROM orders WHERE request_key=$1", [b.request_key])
  ).rows[0];
  const fp = fingerprint(b);
  if (existing) {
    if (existing.gym_id !== gymId || existing.fingerprint !== fp)
      throw new HttpError(409, "La referencia ya corresponde a otro cobro");
    if (existing.voided_at)
      throw new HttpError(
        409,
        "Este cobro fue anulado. Iniciá una nueva operación.",
      );
    return existing;
  }
  const calculated = await quote(tx, gymId, b, canDiscount);
  if (
    b.expected_total_cents !== undefined &&
    b.expected_total_cents !== calculated.total_cents
  )
    throw new HttpError(409, "El precio cambió. Revisá nuevamente el total.");
  if (b.expected_periods) {
    const periods = (
      items: {
        member_id: string;
        plan_id: string;
        starts_on: string;
        ends_on: string;
      }[],
    ) =>
      JSON.stringify(
        [...items].sort((a, b) =>
          (a.member_id + a.plan_id).localeCompare(b.member_id + b.plan_id),
        ),
      );
    const actual = calculated.lines.map((l) => ({
      member_id: l.member_id,
      plan_id: l.plan.id,
      starts_on: l.starts_on,
      ends_on: l.ends_on,
    }));
    if (periods(b.expected_periods) !== periods(actual))
      throw new HttpError(
        409,
        "Los vencimientos cambiaron desde la cotización. Revisá el cobro nuevamente.",
      );
  }
  const orderId = randomUUID();
  await tx.query(
    "INSERT INTO orders(id,gym_id,request_key,fingerprint,amount_cents,promotion_name) VALUES($1,$2,$3,$4,$5,$6)",
    [
      orderId,
      gymId,
      b.request_key,
      fp,
      calculated.total_cents,
      calculated.promotion_name,
    ],
  );
  for (const l of calculated.lines) {
    const plan = l.plan;
    const last = (
      await tx.query(
        "SELECT * FROM subscriptions WHERE member_id=$1 AND plan_id=$2 AND gym_id=$3 AND cancelled_at IS NULL ORDER BY ends_on DESC LIMIT 1",
        [l.member_id, plan.id, gymId],
      )
    ).rows[0];
    const start =
      last && dateText(last.ends_on) > today()
        ? dateText(last.ends_on)
        : today();
    const anchor =
      last && dateText(last.ends_on) >= today()
        ? last.anchor_day
        : Number(start.slice(8));
    const end =
      plan.duration_unit === "month"
        ? nextMonth(start, anchor)
        : addDays(start, plan.duration_days);
    const sid = randomUUID();
    await tx.query(
      "INSERT INTO subscriptions(id,member_id,plan_id,starts_on,ends_on,gym_id,anchor_day) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [sid, l.member_id, plan.id, start, end, gymId, anchor],
    );
    await tx.query(
      "INSERT INTO member_activities VALUES($1,$2) ON CONFLICT DO NOTHING",
      [l.member_id, plan.id],
    );
    await tx.query(
      "INSERT INTO payments(id,member_id,subscription_id,amount_cents,discount_cents,method,created_by,request_key,gym_id,order_id,activity_snapshot,plan_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        randomUUID(),
        l.member_id,
        sid,
        l.amount_cents,
        l.discount_cents,
        b.method,
        userId,
        randomUUID(),
        gymId,
        orderId,
        plan.activity,
        plan.name,
      ],
    );
  }
  return {
    id: orderId,
    amount_cents: calculated.total_cents,
    promotion_name: calculated.promotion_name,
  };
}
