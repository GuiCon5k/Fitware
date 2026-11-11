import type { Express, RequestHandler } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import type { Database, Row } from "./db.js";
import {
  HttpError,
  orderSchema,
  quote,
  charge,
  text,
  fingerprint,
} from "./domain.js";
import { methods, resolveMethod } from "./payment-methods.js";
import { today } from "./dates.js";
import { audit } from "./features.js";

const safeDate = (v: unknown) => z.iso.date().parse(v || today());
const sha = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function cashSnapshot(db: Database, gymId: string, day: string) {
  const rows = (
    await db.query(
      `SELECT id,'Cuota' kind,method,method_name,amount_cents,voided_at FROM payments WHERE gym_id=$1 AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date=$2
    UNION ALL SELECT id,'Venta',method,method_name,amount_cents,voided_at FROM sales WHERE gym_id=$1 AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date=$2
    UNION ALL SELECT id,'Egreso',method,method_name,-amount_cents,voided_at FROM expenses WHERE gym_id=$1 AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date=$2 ORDER BY kind,id`,
      [gymId, day],
    )
  ).rows;
  const groups = new Map<string, Row>();
  groups.set("cash:Efectivo", {
    key: "cash:Efectivo",
    name: "Efectivo",
    method: "cash",
    expected_cents: 0,
  });
  for (const r of rows.filter((r) => !r.voided_at)) {
    const name =
        r.method_name || (r.method === "cash" ? "Efectivo" : "Transferencia"),
      key = r.method + ":" + name;
    if (!groups.has(key))
      groups.set(key, { key, name, method: r.method, expected_cents: 0 });
    groups.get(key)!.expected_cents += Number(r.amount_cents);
  }
  return { rows: [...groups.values()], movements_hash: sha(rows) };
}
export function installGymOperations(
  app: Express,
  db: Database,
  permit: (p: string) => RequestHandler,
  owner: RequestHandler,
) {
  app.get("/api/payment-methods", async (req, res) =>
    res.json(await methods(db, req.gymId)),
  );
  app.post("/api/payment-methods", owner, async (req, res) => {
    const b = z
      .object({
        name: text.pipe(z.string().max(80)),
        method: z.enum(["cash", "transfer"]),
      })
      .parse(req.body);
    const result = (
      await db.query(
        "INSERT INTO payment_methods(id,gym_id,name,method) VALUES($1,$2,$3,$4) RETURNING *",
        [randomUUID(), req.gymId, b.name, b.method],
      )
    ).rows[0];
    await audit(
      db,
      req.user.account_id,
      req.user.id,
      "payment_method.created",
      { id: result.id, name: b.name },
      req.gymId,
    );
    res.status(201).json(result);
  });
  app.put("/api/payment-methods/:id", owner, async (req, res) => {
    const b = z.object({ active: z.boolean() }).parse(req.body);
    const r = await db.query(
      "UPDATE payment_methods SET active=$3 WHERE id=$1 AND gym_id=$2 RETURNING *",
      [req.params.id, req.gymId, b.active],
    );
    if (!r.rows.length) throw new HttpError(404, "Medio no encontrado");
    await audit(
      db,
      req.user.account_id,
      req.user.id,
      "payment_method.updated",
      { id: req.params.id, active: b.active },
      req.gymId,
    );
    res.json(r.rows[0]);
  });
  app.get("/api/pending-payments", permit("payments.read"), async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT p.id,p.member_id,m.name member_name,m.document,p.amount_cents,p.method_name,p.reference,p.status,p.verification,p.reason,p.order_id,p.created_at,p.reviewed_at,u.name reviewed_by_name FROM pending_payments p JOIN members m ON m.id=p.member_id LEFT JOIN users u ON u.id=p.reviewed_by WHERE p.gym_id=$1 AND (p.status='pending' OR p.id IN(SELECT id FROM pending_payments WHERE gym_id=$1 AND status<>'pending' ORDER BY reviewed_at DESC LIMIT 100)) ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END,p.created_at DESC`,
          [req.gymId],
        )
      ).rows,
    ),
  );
  app.post(
    "/api/pending-payments",
    permit("payments.write"),
    async (req, res) => {
      const b = orderSchema.parse(req.body);
      if (b.method !== "transfer")
        throw new HttpError(
          400,
          "Solo los medios electrónicos pueden quedar pendientes de acreditación.",
        );
      if ((b.promotion_id || b.discount_cents) && !req.modules.promotions)
        throw new HttpError(
          403,
          "Habilitá Promociones para aplicar este descuento.",
        );
      const result = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [
          req.gymId,
        ]);
        const old = (
          await tx.query(
            "SELECT * FROM pending_payments WHERE request_key=$1",
            [b.request_key],
          )
        ).rows[0];
        if (old) {
          if (old.gym_id !== req.gymId || old.fingerprint !== fingerprint(b))
            throw new HttpError(409, "Referencia utilizada en otro cobro.");
          return { id: old.id, status: old.status };
        }
        if (
          (
            await tx.query("SELECT id FROM orders WHERE request_key=$1", [
              b.request_key,
            ])
          ).rows.length
        )
          throw new HttpError(
            409,
            "Este pago ya fue cobrado. No puede quedar pendiente.",
          );
        const m = await resolveMethod(tx, req.gymId, b),
          q = await quote(
            tx,
            req.gymId,
            b,
            req.user.role === "owner" ||
              req.user.permissions.includes("promos.manage"),
          );
        if (
          b.expected_total_cents !== undefined &&
          b.expected_total_cents !== q.total_cents
        )
          throw new HttpError(409, "El importe cambió. Revisá el cobro.");
        const id = randomUUID();
        await tx.query(
          "INSERT INTO pending_payments(id,gym_id,member_id,request_key,fingerprint,payload,amount_cents,method_name,reference,created_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)",
          [
            id,
            req.gymId,
            b.member_id,
            b.request_key,
            fingerprint(b),
            JSON.stringify(b),
            q.total_cents,
            m.name,
            m.reference,
            req.user.id,
          ],
        );
        return { id, status: "pending" };
      });
      res.status(201).json(result);
    },
  );
  app.get(
    "/api/pending-payments/:id/quote",
    permit("payments.reconcile"),
    async (req, res) => {
      const p = (
        await db.query(
          "SELECT * FROM pending_payments WHERE id=$1 AND gym_id=$2 AND status='pending'",
          [req.params.id, req.gymId],
        )
      ).rows[0];
      if (!p) throw new HttpError(404, "Cobro pendiente no encontrado");
      res.json(await quote(db, req.gymId, orderSchema.parse(p.payload), true));
    },
  );
  app.get(
    "/api/gym-mercadopago",
    permit("payments.reconcile"),
    async (req, res) =>
      res.json({
        configured: !!(
          process.env.GYM_MP_ACCESS_TOKEN &&
          process.env.GYM_MP_COLLECTOR_ID &&
          process.env.GYM_MP_GYM_ID === req.gymId
        ),
        message:
          "La conexión debe pertenecer a la cuenta que recibe las cuotas del gimnasio. Es independiente de tu suscripción a FITWare.",
      }),
  );
  app.post(
    "/api/pending-payments/:id/review",
    permit("payments.reconcile"),
    async (req, res) => {
      const b = z
        .object({
          action: z.enum(["confirm", "reject", "mercadopago"]),
          reason: text,
          provider_payment_id: z
            .string()
            .regex(/^\d{1,30}$/)
            .optional(),
          expected_total_cents: z.number().int().min(0).optional(),
          expected_periods: orderSchema.shape.expected_periods,
        })
        .parse(req.body);
      // Query the provider before opening the transaction; never trust a browser receipt.
      let provider: Row | undefined;
      if (b.action === "mercadopago") {
        if (
          !process.env.GYM_MP_ACCESS_TOKEN ||
          !process.env.GYM_MP_COLLECTOR_ID ||
          process.env.GYM_MP_GYM_ID !== req.gymId
        )
          throw new HttpError(
            503,
            "Falta conectar la cuenta de Mercado Pago de este gimnasio. Podés revisar la acreditación en tu cuenta y confirmar manualmente.",
          );
        if (!b.provider_payment_id)
          throw new HttpError(
            400,
            "Ingresá el número de operación de Mercado Pago.",
          );
        let response: globalThis.Response;
        try {
          response = await fetch(
            `https://api.mercadopago.com/v1/payments/${b.provider_payment_id}`,
            {
              headers: {
                Authorization: `Bearer ${process.env.GYM_MP_ACCESS_TOKEN}`,
              },
              signal: AbortSignal.timeout(10000),
            },
          );
        } catch {
          throw new HttpError(
            502,
            "Mercado Pago no respondió. El cobro continúa pendiente.",
          );
        }
        if (!response.ok)
          throw new HttpError(
            502,
            "No se pudo verificar esa operación en Mercado Pago. El cobro continúa pendiente.",
          );
        provider = (await response.json()) as Row;
      }
      const result = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [
          req.gymId,
        ]);
        const p = (
          await tx.query(
            "SELECT * FROM pending_payments WHERE id=$1 AND gym_id=$2 FOR UPDATE",
            [req.params.id, req.gymId],
          )
        ).rows[0];
        if (!p) throw new HttpError(404, "Cobro no encontrado");
        if (p.status !== "pending") {
          if (p.status === "confirmed" && b.action !== "reject")
            return { id: p.order_id, status: p.status };
          throw new HttpError(409, "Este cobro ya fue revisado.");
        }
        let order: Row | undefined;
        if (b.action !== "reject") {
          if (!b.expected_periods || b.expected_total_cents === undefined)
            throw new HttpError(
              400,
              "Revisá el importe y los vencimientos antes de confirmar.",
            );
          if (b.expected_total_cents !== p.amount_cents)
            throw new HttpError(
              409,
              "El precio cambió desde que se informó el pago. Rechazá el pendiente y registrá un nuevo cobro con el importe correcto.",
            );
          if (provider) {
            if (
              String(provider.id) !== b.provider_payment_id ||
              provider.status !== "approved" ||
              provider.currency_id !== "ARS" ||
              String(provider.collector_id) !==
                process.env.GYM_MP_COLLECTOR_ID ||
              Math.round(Number(provider.transaction_amount) * 100) !==
                p.amount_cents ||
              Number(provider.transaction_amount_refunded || 0) > 0 ||
              (process.env.NODE_ENV === "production" &&
                provider.live_mode !== true) ||
              !provider.date_approved ||
              !Number.isFinite(new Date(provider.date_approved).getTime()) ||
              new Date(provider.date_approved).getTime() >
                Date.now() + 300000 ||
              new Date(provider.date_approved).getTime() <
                new Date(p.created_at).getTime() - 86400000
            )
              throw new HttpError(
                409,
                "La operación no coincide: revisá estado, importe, moneda, fecha y cuenta receptora. No se habilitó el pase.",
              );
            if (
              (
                await tx.query(
                  "SELECT id FROM pending_payments WHERE provider_payment_id=$1",
                  [b.provider_payment_id],
                )
              ).rows.length
            )
              throw new HttpError(
                409,
                "Esta operación de Mercado Pago ya se utilizó para otro cobro.",
              );
          }
          order = await charge(
            tx,
            req.gymId,
            req.user.id,
            {
              ...orderSchema.parse(p.payload),
              expected_total_cents: b.expected_total_cents,
              expected_periods: b.expected_periods,
            },
            true,
            true,
          );
        }
        await tx.query(
          "UPDATE pending_payments SET status=$3,order_id=$4,verification=$5,reason=$6,reviewed_by=$7,reviewed_at=now(),provider_payment_id=$8 WHERE id=$1 AND gym_id=$2",
          [
            p.id,
            req.gymId,
            b.action === "reject" ? "rejected" : "confirmed",
            order?.id || null,
            b.action === "mercadopago"
              ? "mercadopago"
              : b.action === "confirm"
                ? "manual"
                : null,
            b.reason,
            req.user.id,
            b.action === "mercadopago" ? b.provider_payment_id : null,
          ],
        );
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "payment.reconciled",
          {
            pending_id: p.id,
            action: b.action,
            order_id: order?.id,
            reason: b.reason,
          },
          req.gymId,
        );
        return {
          id: order?.id,
          status: b.action === "reject" ? "rejected" : "confirmed",
        };
      });
      res.json(result);
    },
  );
  app.get("/api/cash-counts", permit("reports.read"), async (req, res) => {
    const day = safeDate(req.query.day),
      current = await cashSnapshot(db, req.gymId, day);
    const history = (
      await db.query(
        "SELECT c.*,u.name created_by_name FROM cash_counts c JOIN users u ON u.id=c.created_by WHERE c.gym_id=$1 AND c.day=$2 ORDER BY c.created_at DESC",
        [req.gymId, day],
      )
    ).rows;
    res.json({ day, ...current, history });
  });
  app.post("/api/cash-counts", permit("cash.count"), async (req, res) => {
    const b = z
      .object({
        day: z.iso.date(),
        opening_cents: z.number().int().min(0).max(1000000000),
        movements_hash: z.string().length(64),
        counts: z
          .array(
            z.object({
              key: text,
              counted_cents: z.number().int().min(0).max(1000000000),
            }),
          )
          .max(200),
        reason: z.string().max(180).default(""),
        request_key: z.uuid(),
      })
      .parse(req.body);
    if (b.day > today())
      throw new HttpError(400, "No se puede arquear un día futuro.");
    const r = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [req.gymId]);
      const old = (
        await tx.query("SELECT * FROM cash_counts WHERE request_key=$1", [
          b.request_key,
        ])
      ).rows[0];
      if (old) {
        if (old.gym_id !== req.gymId || old.fingerprint !== fingerprint(b))
          throw new HttpError(409, "Referencia utilizada");
        return old;
      }
      const snapshot = await cashSnapshot(tx, req.gymId, b.day);
      if (snapshot.movements_hash !== b.movements_hash)
        throw new HttpError(
          409,
          "Los movimientos cambiaron. Actualizá el arqueo y volvé a contar.",
        );
      if (
        b.counts.length !== snapshot.rows.length ||
        new Set(b.counts.map((c) => c.key)).size !== b.counts.length
      )
        throw new HttpError(
          400,
          "Completá todos los medios de pago sin duplicados.",
        );
      const rows = snapshot.rows.map((r) => {
        const c = b.counts.find((c) => c.key === r.key);
        if (!c) throw new HttpError(400, "Falta contar un medio de pago.");
        const expected =
          r.expected_cents + (r.key === "cash:Efectivo" ? b.opening_cents : 0);
        return {
          ...r,
          expected_cents: expected,
          counted_cents: c.counted_cents,
          difference_cents: c.counted_cents - expected,
        };
      });
      if (rows.some((r) => r.difference_cents !== 0) && !b.reason.trim())
        throw new HttpError(
          400,
          "Explicá la diferencia antes de guardar el arqueo.",
        );
      const result = (
        await tx.query(
          "INSERT INTO cash_counts(id,gym_id,day,opening_cents,rows,movements_hash,reason,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) RETURNING *",
          [
            randomUUID(),
            req.gymId,
            b.day,
            b.opening_cents,
            JSON.stringify(rows),
            snapshot.movements_hash,
            b.reason,
            req.user.id,
            b.request_key,
            fingerprint(b),
          ],
        )
      ).rows[0];
      await audit(
        tx,
        req.user.account_id,
        req.user.id,
        "cash.counted",
        { id: result.id, day: b.day },
        req.gymId,
      );
      return result;
    });
    res.status(201).json(r);
  });
  app.get(
    "/api/payments/history",
    permit("payments.read"),
    async (req, res) => {
      const from = safeDate(req.query.from || today().slice(0, 7) + "-01"),
        to = safeDate(req.query.to);
      if (from > to)
        throw new HttpError(
          400,
          "La fecha inicial debe ser anterior a la final.",
        );
      const q = z
          .string()
          .max(180)
          .parse(req.query.q || ""),
        medium = z
          .string()
          .max(180)
          .parse(req.query.method_name || "all"),
        page = z.coerce
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(req.query.page || 1);
      const where = `p.gym_id=$1 AND (p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3 AND position(lower($4) in lower(concat_ws(' ',m.name,m.document,m.phone,p.reference)))>0 AND ($5='all' OR COALESCE(NULLIF(p.method_name,''),CASE WHEN p.method='cash' THEN 'Efectivo' ELSE 'Transferencia' END)=$5)`;
      const params = [req.gymId, from, to, q, medium];
      const result = await db.transaction(async (tx) => {
        await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
        const totals = (
          await tx.query(
            `SELECT count(*)::integer total,count(*) FILTER(WHERE p.voided_at IS NULL)::integer passes,count(DISTINCT COALESCE(p.order_id,p.id)) FILTER(WHERE p.voided_at IS NULL)::integer charges,COALESCE(sum(p.amount_cents) FILTER(WHERE p.voided_at IS NULL),0) confirmed_cents FROM payments p JOIN members m ON m.id=p.member_id WHERE ${where}`,
            params,
          )
        ).rows[0];
        const rows = (
          await tx.query(
            `SELECT p.*,m.name member_name,m.document member_document,m.phone member_phone,COALESCE(p.plan_snapshot,pl.name) plan_name,COALESCE(o.promotion_name,'') promotion_name FROM payments p JOIN members m ON m.id=p.member_id JOIN subscriptions s ON s.id=p.subscription_id JOIN plans pl ON pl.id=s.plan_id LEFT JOIN orders o ON o.id=p.order_id WHERE ${where} ORDER BY p.created_at DESC,p.id DESC LIMIT 50 OFFSET $6`,
            [...params, (page - 1) * 50],
          )
        ).rows;
        const names = (
          await tx.query(
            `SELECT DISTINCT COALESCE(NULLIF(method_name,''),CASE WHEN method='cash' THEN 'Efectivo' ELSE 'Transferencia' END) name FROM payments WHERE gym_id=$1 ORDER BY name`,
            [req.gymId],
          )
        ).rows.map((r) => r.name);
        return {
          ...totals,
          confirmed_cents: Number(totals.confirmed_cents),
          rows,
          method_names: names,
          page,
        };
      });
      res.json(result);
    },
  );
  app.get(
    "/api/payments/export.xlsx",
    permit("payments.read"),
    async (req, res) => {
      const from = safeDate(req.query.from || today().slice(0, 7) + "-01"),
        to = safeDate(req.query.to);
      if (from > to)
        throw new HttpError(
          400,
          "La fecha inicial debe ser anterior a la final.",
        );
      const rows = (
        await db.query(
          `SELECT p.*,m.name,m.document,m.phone,COALESCE(p.plan_snapshot,pl.name) pass,COALESCE(o.promotion_name,'') promotion FROM payments p JOIN members m ON m.id=p.member_id JOIN subscriptions s ON s.id=p.subscription_id JOIN plans pl ON pl.id=s.plan_id LEFT JOIN orders o ON o.id=p.order_id WHERE p.gym_id=$1 AND (p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3 ORDER BY p.created_at DESC,p.id`,
          [req.gymId, from, to],
        )
      ).rows;
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet("Cuotas");
      sheet.addRow([
        "Fecha",
        "Nombre",
        "DNI",
        "Teléfono",
        "Pase",
        "Precio ARS",
        "Forma de pago",
        "Referencia",
        "Promoción",
        "Descuento ARS",
        "Estado",
        "Cobro",
      ]);
      const q = String(req.query.q || "").toLowerCase(),
        medium = String(req.query.method_name || "all");
      for (const r of rows.filter(
        (r) =>
          `${r.name} ${r.document} ${r.phone} ${r.reference}`
            .toLowerCase()
            .includes(q) &&
          (medium === "all" ||
            (r.method_name ||
              (r.method === "cash" ? "Efectivo" : "Transferencia")) === medium),
      ))
        sheet.addRow([
          new Intl.DateTimeFormat("es-AR", {
            timeZone: "America/Argentina/Buenos_Aires",
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(r.created_at)),
          r.name,
          r.document,
          r.phone,
          r.pass,
          r.amount_cents / 100,
          r.method_name || (r.method === "cash" ? "Efectivo" : "Transferencia"),
          r.reference,
          r.promotion,
          r.discount_cents / 100,
          r.voided_at ? "Anulado" : "Confirmado",
          r.order_id,
        ]);
      sheet.views = [{ state: "frozen", ySplit: 1 }];
      sheet.autoFilter = "A1:L1";
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((c, i) => {
        c.width = [24, 28, 16, 18, 30, 18, 25, 24, 28, 18, 18, 38][i];
      });
      sheet.getColumn(6).numFmt = '"$" #,##0.00';
      sheet.getColumn(10).numFmt = '"$" #,##0.00';
      const notes = workbook.addWorksheet("Cómo leer");
      notes.addRow([
        "Cada fila corresponde a un socio y un pase. Los combos y 2x1 distribuyen el descuento sin duplicar el importe cobrado.",
      ]);
      notes.addRow([
        "Las filas anuladas se conservan para auditoría y se excluyen de caja y balances. Las transferencias pendientes no son ingresos.",
      ]);
      notes.addRow([
        "DNI, teléfono y nombre reflejan la ficha actual del socio. Los precios, promociones y medios corresponden al cobro registrado.",
      ]);
      notes.getColumn(1).width = 130;
      res
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .attachment(`FITWare-cuotas-${from}-${to}.xlsx`)
        .send(Buffer.from(await workbook.xlsx.writeBuffer()));
    },
  );
}
