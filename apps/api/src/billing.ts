import { randomUUID } from "node:crypto";
import { WebhookSignatureValidator } from "mercadopago";
import type { Request, Response } from "express";
import type { Database, Row } from "./db.js";
import { today, dateText, nextMonth } from "./dates.js";
import { HttpError } from "./domain.js";
import { servicePriceUSDCents, recipient } from "./exchange.js";
export function billingConfig() {
  return {
    enabled: process.env.REQUIRE_SUBSCRIPTION === "true",
    configured: !!(
      process.env.MP_ACCESS_TOKEN &&
      process.env.MP_WEBHOOK_SECRET &&
      process.env.MP_COLLECTOR_ID &&
      process.env.PUBLIC_URL?.startsWith("https://")
    ),
    usd_cents: servicePriceUSDCents,
    recipient,
  };
}
export async function billingStatus(db: Database, accountId: string) {
  const account = (
    await db.query("SELECT * FROM accounts WHERE id=$1", [accountId])
  ).rows[0];
  const receipts = (
    await db.query(
      "SELECT starts_on,ends_on FROM billing_receipts WHERE account_id=$1 AND status='approved' ORDER BY starts_on,ends_on",
      [accountId],
    )
  ).rows;
  const trialValid = dateText(account.trial_until) > today();
  let coveredUntil = trialValid ? dateText(account.trial_until) : today();
  let paid = false;
  for (const receipt of receipts) {
    if (
      dateText(receipt.starts_on) <= coveredUntil &&
      dateText(receipt.ends_on) > coveredUntil
    ) {
      coveredUntil = dateText(receipt.ends_on);
      paid = true;
    }
  }
  const active = coveredUntil > today();
  const until = active ? coveredUntil : dateText(account.trial_until);
  return {
    ...billingConfig(),
    active,
    until,
    paid,
    account_name: account.name,
  };
}
async function provider(path: string, options: RequestInit = {}) {
  const response = await fetch("https://api.mercadopago.com" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + process.env.MP_ACCESS_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new HttpError(
      502,
      "Mercado Pago no pudo completar la operación. Intentá nuevamente.",
    );
  return response.json() as Promise<Row>;
}
export async function checkout(
  db: Database,
  accountId: string,
  quoteId: string,
  fetcher: typeof fetch = fetch,
) {
  if (!billingConfig().configured)
    throw new HttpError(
      503,
      "El cobro del servicio todavía no está configurado",
    );
  const quote = (
    await db.query(
      "SELECT * FROM service_quotes WHERE id=$1 AND account_id=$2",
      [quoteId, accountId],
    )
  ).rows[0];
  if (!quote) throw new HttpError(404, "Cotización no encontrada");
  if (new Date(quote.expires_at).getTime() <= Date.now())
    throw new HttpError(
      409,
      "La cotización venció. Actualizá el importe antes de pagar.",
    );
  const order = await db.transaction(async (tx) => {
    await tx.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
      accountId,
    ]);
    const prior = (
      await tx.query("SELECT * FROM billing_orders WHERE quote_id=$1", [
        quote.id,
      ])
    ).rows[0];
    if (prior) return prior;
    return (
      await tx.query(
        "INSERT INTO billing_orders(id,account_id,amount_cents,quote_id,usd_cents,rate_micro,fx_source,fx_as_of,recipient_alias,recipient_cvu) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
        [
          randomUUID(),
          accountId,
          quote.ars_cents,
          quote.id,
          quote.usd_cents,
          quote.rate_micro,
          quote.source,
          quote.rate_as_of,
          recipient.alias,
          recipient.cvu,
        ],
      )
    ).rows[0];
  });
  if (order.status === "approved")
    throw new HttpError(
      409,
      "Esta orden ya fue abonada. Generá una nueva cotización si querés pagar otro mes.",
    );
  if (order.init_point)
    return { url: order.init_point, amount_cents: order.amount_cents };
  const url = process.env.PUBLIC_URL!.replace(/\/$/, "");
  // The amount and reference are taken only from the saved quote; client-supplied amounts are ignored.
  const response = await fetcher(
    "https://api.mercadopago.com/checkout/preferences",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.MP_ACCESS_TOKEN,
        "Content-Type": "application/json",
        "X-Idempotency-Key": order.id,
      },
      body: JSON.stringify({
        items: [
          {
            id: "fitware-monthly",
            title: "FITWare · Un mes de servicio (USD 15 convertido a ARS)",
            quantity: 1,
            currency_id: "ARS",
            unit_price: order.amount_cents / 100,
          },
        ],
        external_reference: order.id,
        notification_url: url + "/api/billing/webhook",
        back_urls: {
          success: url + "/?billing=success",
          pending: url + "/?billing=pending",
          failure: url + "/?billing=failure",
        },
        auto_return: "approved",
        expires: true,
        expiration_date_from: new Date().toISOString(),
        expiration_date_to: new Date(quote.expires_at).toISOString(),
      }),
      signal: AbortSignal.timeout(12000),
    },
  );
  if (!response.ok)
    throw new HttpError(502, "Mercado Pago no pudo iniciar el pago");
  const preference = (await response.json()) as Row;
  if (
    typeof preference.init_point !== "string" ||
    new URL(preference.init_point).protocol !== "https:" ||
    !/(^|\.)mercadopago\.(com|com\.ar)$/.test(
      new URL(preference.init_point).hostname,
    )
  )
    throw new HttpError(502, "Respuesta inesperada de la pasarela");
  await db.query(
    "UPDATE billing_orders SET preference_id=$2,init_point=$3 WHERE id=$1",
    [order.id, preference.id, preference.init_point],
  );
  return { url: preference.init_point, amount_cents: order.amount_cents };
}
// Payment data must come from the authenticated provider API, never from the browser or notification body.
export async function applyProviderPayment(db: Database, payment: Row) {
  const id = String(payment.id);
  const paymentStatus =
    Number(payment.transaction_amount_refunded || 0) > 0
      ? "refunded"
      : payment.status;
  const order = (
    await db.query("SELECT * FROM billing_orders WHERE id=$1", [
      payment.external_reference,
    ])
  ).rows[0];
  if (!order) return;
  if (
    payment.currency_id !== "ARS" ||
    Math.round(Number(payment.transaction_amount) * 100) !==
      order.amount_cents ||
    String(payment.collector_id) !== process.env.MP_COLLECTOR_ID
  )
    throw new HttpError(400, "El pago no coincide con la orden del servicio");
  if (
    payment.live_mode !== true &&
    (process.env.MP_ALLOW_TEST_PAYMENTS !== "true" ||
      process.env.NODE_ENV === "production")
  )
    throw new HttpError(
      400,
      "No se aceptan pagos de prueba para habilitar el servicio",
    );
  await db.transaction(async (tx) => {
    const account = (
      await tx.query("SELECT * FROM accounts WHERE id=$1 FOR UPDATE", [
        order.account_id,
      ])
    ).rows[0];
    const prior = (
      await tx.query("SELECT * FROM billing_receipts WHERE payment_id=$1", [id])
    ).rows[0];
    const freshOrder = (
      await tx.query(
        "SELECT status FROM billing_orders WHERE id=$1 FOR UPDATE",
        [order.id],
      )
    ).rows[0];
    if (paymentStatus !== "approved") {
      if (
        prior &&
        ["refunded", "charged_back", "cancelled"].includes(paymentStatus)
      ) {
        await tx.query(
          "UPDATE billing_receipts SET status=$2 WHERE payment_id=$1",
          [id, paymentStatus],
        );
        await tx.query("UPDATE billing_orders SET status=$2 WHERE id=$1", [
          order.id,
          paymentStatus,
        ]);
        const last = (
          await tx.query(
            "SELECT ends_on FROM billing_receipts WHERE account_id=$1 AND status='approved' ORDER BY ends_on DESC LIMIT 1",
            [account.id],
          )
        ).rows[0];
        await tx.query("UPDATE accounts SET paid_until=$2 WHERE id=$1", [
          account.id,
          last ? dateText(last.ends_on) : null,
        ]);
      }
      return;
    }
    if (prior || freshOrder.status === "approved") return;
    const last = (
      await tx.query(
        "SELECT * FROM billing_receipts WHERE account_id=$1 AND status='approved' ORDER BY ends_on DESC LIMIT 1",
        [account.id],
      )
    ).rows[0];
    const start =
      account.paid_until && dateText(account.paid_until) > today()
        ? dateText(account.paid_until)
        : today();
    const anchor =
      last && dateText(last.ends_on) >= today()
        ? last.anchor_day
        : Number(start.slice(8));
    const end = nextMonth(start, anchor);
    await tx.query(
      "INSERT INTO billing_receipts(payment_id,account_id,order_id,starts_on,ends_on,anchor_day) VALUES($1,$2,$3,$4,$5,$6)",
      [id, account.id, order.id, start, end, anchor],
    );
    await tx.query(
      "UPDATE billing_orders SET status='approved',provider_payment_id=$2 WHERE id=$1",
      [order.id, id],
    );
    await tx.query("UPDATE accounts SET paid_until=$2 WHERE id=$1", [
      account.id,
      end,
    ]);
  });
}
export function webhook(db: Database) {
  return async (req: Request, res: Response) => {
    if (!billingConfig().configured)
      throw new HttpError(503, "Pasarela no configurada");
    const id = String(req.query["data.id"] || "");
    if (!/^\d+$/.test(id)) throw new HttpError(400, "Identificador inválido");
    try {
      WebhookSignatureValidator.validate({
        xSignature: req.get("x-signature") || "",
        xRequestId: req.get("x-request-id") || "",
        dataId: id,
        secret: process.env.MP_WEBHOOK_SECRET!,
      });
    } catch {
      throw new HttpError(401, "Firma inválida");
    }
    const payment = await provider("/v1/payments/" + id);
    if (String(payment.id) !== id) throw new HttpError(400, "Pago inválido");
    await applyProviderPayment(db, payment);
    res.sendStatus(200);
  };
}
