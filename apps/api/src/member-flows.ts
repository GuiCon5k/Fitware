import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Row } from "./db.js";
import { HttpError, orderSchema, charge, fingerprint } from "./domain.js";
import { memberSchema } from "./validators.js";
import { audit } from "./features.js";
import { today, dateText } from "./dates.js";
export const registrationSchema = z.object({
  member: memberSchema,
  payment: orderSchema.omit({ member_id: true }),
  request_key: z.uuid(),
});
export async function registerAndCharge(
  db: Database,
  gymId: string,
  userId: string,
  accountId: string,
  raw: unknown,
  discountAllowed: boolean,
) {
  const b = registrationSchema.parse(raw),
    fp = fingerprint(b);
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [gymId]);
    const prior = (
      await tx.query(
        "SELECT * FROM member_registrations WHERE request_key=$1",
        [b.request_key],
      )
    ).rows[0];
    if (prior) {
      if (prior.gym_id !== gymId || prior.fingerprint !== fp)
        throw new HttpError(
          409,
          "La referencia corresponde a otra inscripción",
        );
      return prior.response;
    }
    const id = randomUUID(),
      m = b.member;
    if (
      m.plan_ids.length !== b.payment.plan_ids.length ||
      m.plan_ids.some((p) => !b.payment.plan_ids.includes(p))
    )
      throw new HttpError(
        400,
        "Las actividades del alta deben coincidir con el primer cobro",
      );
    await tx.query(
      "INSERT INTO members(id,gym_id,name,document,email,phone,address,emergency_name,emergency_phone,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        id,
        gymId,
        m.name,
        m.document,
        m.email,
        m.phone,
        m.address,
        m.emergency_name,
        m.emergency_phone,
        m.notes,
      ],
    );
    const order = await charge(
      tx,
      gymId,
      userId,
      {
        ...b.payment,
        member_id: id,
        ...(b.payment.expected_periods
          ? {
              expected_periods: b.payment.expected_periods.map((p) => ({
                ...p,
                member_id: p.member_id === "new-member" ? id : p.member_id,
              })),
            }
          : {}),
      },
      discountAllowed,
    );
    const response = { id, order };
    await tx.query("INSERT INTO member_registrations VALUES($1,$2,$3,$4)", [
      b.request_key,
      gymId,
      fp,
      JSON.stringify(response),
    ]);
    await audit(
      tx,
      accountId,
      userId,
      "member.registered_and_paid",
      { member_id: id, order_id: order.id },
      gymId,
    );
    return response;
  });
}
export async function renewalTemplate(
  db: Database,
  gymId: string,
  memberId: string,
  discountAllowed: boolean,
  promotionsEnabled: boolean,
) {
  if (
    !(
      await db.query(
        "SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
        [memberId, gymId],
      )
    ).rows.length
  )
    throw new HttpError(404, "Socio no encontrado");
  const payment = (
    await db.query(
      "SELECT p.*,o.fingerprint FROM payments p LEFT JOIN orders o ON o.id=p.order_id WHERE p.member_id=$1 AND p.gym_id=$2 AND p.voided_at IS NULL ORDER BY p.created_at DESC LIMIT 1",
      [memberId, gymId],
    )
  ).rows[0];
  const warnings: string[] = [];
  if (!payment)
    return {
      member_id: memberId,
      plan_ids: [],
      warnings: ["Este socio todavía no tiene cobros. Elegí sus actividades."],
    };
  const lines = (
    await db.query(
      "SELECT p.member_id,s.plan_id,pl.active FROM payments p JOIN subscriptions s ON s.id=p.subscription_id JOIN plans pl ON pl.id=s.plan_id WHERE p.gym_id=$1 AND p.voided_at IS NULL AND " +
        (payment.order_id ? "p.order_id=$2" : "p.id=$2"),
      [gymId, payment.order_id || payment.id],
    )
  ).rows;
  const plan_ids = [
    ...new Set(
      lines
        .filter((l) => l.member_id === memberId && l.active)
        .map((l) => l.plan_id),
    ),
  ];
  if (lines.some((l) => !l.active))
    warnings.push("Un plan anterior está desactivado. Revisá las actividades.");
  let original: Row = {};
  try {
    original = JSON.parse(payment.fingerprint || "{}");
  } catch {}
  let promotion_id = original.promotion_id,
    partner_id = lines.find((l) => l.member_id !== memberId)?.member_id;
  if (promotion_id) {
    const p = (
      await db.query("SELECT * FROM promotions WHERE id=$1 AND gym_id=$2", [
        promotion_id,
        gymId,
      ])
    ).rows[0];
    const partner = partner_id
      ? (
          await db.query(
            "SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
            [partner_id, gymId],
          )
        ).rows[0]
      : true;
    if (
      !promotionsEnabled ||
      !p?.active ||
      (p.starts_on && dateText(p.starts_on) > today()) ||
      (p.ends_on && dateText(p.ends_on) < today()) ||
      !partner
    ) {
      promotion_id = undefined;
      partner_id = undefined;
      warnings.push(
        "La promoción anterior ya no se puede usar. Se aplican precios actuales sin esa promoción.",
      );
    }
  }
  let discount = Number(original.discount_cents || 0) / 100;
  if (discount && (!discountAllowed || !promotionsEnabled)) {
    discount = 0;
    warnings.push(
      "El descuento anterior requiere autorización y se quitó del nuevo cobro.",
    );
  }
  return {
    member_id: memberId,
    plan_ids,
    promotion_id,
    partner_id,
    discount,
    method: payment.method,
    warnings,
  };
}
export async function voidMovement(
  db: Database,
  gymId: string,
  accountId: string,
  userId: string,
  kind: string,
  id: string,
  reason: string,
) {
  if (!["payment", "sale", "expense"].includes(kind))
    throw new HttpError(400, "Tipo de movimiento no válido");
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [gymId]);
    const table =
      kind === "payment" ? "payments" : kind === "sale" ? "sales" : "expenses";
    const row = (
      await tx.query(
        `SELECT * FROM ${table} WHERE id=$1 AND gym_id=$2 FOR UPDATE`,
        [id, gymId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Movimiento no encontrado");
    if (row.voided_at) return { id, already_voided: true };
    const target = kind === "payment" ? row.order_id || id : id;
    if (kind === "payment") {
      const lines = (
        await tx.query(
          "SELECT p.*,s.member_id,s.plan_id,s.ends_on FROM payments p JOIN subscriptions s ON s.id=p.subscription_id WHERE p.gym_id=$1 AND " +
            (row.order_id ? "p.order_id=$2" : "p.id=$2"),
          [gymId, target],
        )
      ).rows;
      for (const line of lines) {
        const later = (
          await tx.query(
            "SELECT id FROM subscriptions WHERE gym_id=$1 AND member_id=$2 AND plan_id=$3 AND id<>$4 AND cancelled_at IS NULL AND starts_on>=$5 LIMIT 1",
            [
              gymId,
              line.member_id,
              line.plan_id,
              line.subscription_id,
              line.ends_on,
            ],
          )
        ).rows[0];
        if (later)
          throw new HttpError(
            409,
            "Primero anulá las renovaciones posteriores de esta actividad",
          );
      }
      for (const line of lines) {
        await tx.query(
          "UPDATE payments SET voided_at=now(),void_reason=$2,voided_by=$3 WHERE id=$1",
          [line.id, reason, userId],
        );
        await tx.query(
          "UPDATE subscriptions SET cancelled_at=now() WHERE id=$1",
          [line.subscription_id],
        );
      }
      if (row.order_id)
        await tx.query(
          "UPDATE orders SET voided_at=now(),void_reason=$2,voided_by=$3 WHERE id=$1",
          [row.order_id, reason, userId],
        );
    } else {
      if (kind === "sale") {
        const product = (
          await tx.query(
            "SELECT * FROM products WHERE id=$1 AND gym_id=$2 FOR UPDATE",
            [row.product_id, gymId],
          )
        ).rows[0];
        const stock = product.stock + row.quantity;
        if (stock > 100000000)
          throw new HttpError(
            409,
            "El stock resultante supera el máximo permitido",
          );
        const cost = Math.round(
          (product.stock * product.cost_cents + row.cost_cents) / stock,
        );
        await tx.query(
          "UPDATE products SET stock=$2,cost_cents=$3 WHERE id=$1",
          [product.id, stock, cost],
        );
        await tx.query(
          "INSERT INTO inventory_movements(id,gym_id,product_id,quantity,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            gymId,
            product.id,
            row.quantity,
            "Anulación de venta: " + reason,
            userId,
          ],
        );
      }
      await tx.query(
        `UPDATE ${table} SET voided_at=now(),void_reason=$2,voided_by=$3 WHERE id=$1`,
        [id, reason, userId],
      );
    }
    await tx.query(
      "INSERT INTO void_events(id,gym_id,kind,target_id,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), gymId, kind, target, reason, userId],
    );
    await audit(
      tx,
      accountId,
      userId,
      "movement.voided",
      { kind, target_id: target, reason },
      gymId,
    );
    return { id, voided: true };
  });
}
