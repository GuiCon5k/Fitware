import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./db.js";
import { HttpError } from "./domain.js";
export const servicePriceUSDCents = 1500;
export const recipient = {
  alias: "Guicon",
  cvu: "0000003100084706675067",
  currency: "ARS",
  verification:
    "Datos informados por el prestador. Verificá el titular en Mercado Pago.",
};
export const rateSource = "DolarAPI · dólar oficial vendedor";
export const rateURL = "https://dolarapi.com/v1/dolares/oficial";
const maxAgeMs = 96 * 3600000; // Includes weekends and public holidays. Never silently accepts an older quote.
const payload = z.object({
  moneda: z.literal("USD"),
  casa: z.literal("oficial"),
  venta: z.number().finite().positive().max(1000000),
  fechaActualizacion: z.iso.datetime({ offset: true }),
});
export function parseRate(value: unknown, now = Date.now()) {
  const result = payload.safeParse(value);
  if (!result.success)
    throw new HttpError(
      503,
      "La fuente de cotización devolvió datos inválidos. No se puede cotizar el pago.",
    );
  const { venta, fechaActualizacion } = result.data,
    asOf = Date.parse(fechaActualizacion);
  if (asOf > now + 5 * 60000 || now - asOf > maxAgeMs)
    throw new HttpError(
      503,
      "La cotización no está actualizada. Intentá más tarde.",
    );
  const rateMicro = Math.round(venta * 1000000);
  if (!Number.isSafeInteger(rateMicro) || rateMicro <= 0)
    throw new HttpError(503, "Cotización inválida");
  // USD cents × ARS/USD produces ARS cents. Round only once to the closest cent.
  const arsCents = Number(
    (BigInt(servicePriceUSDCents) * BigInt(rateMicro) + 500000n) / 1000000n,
  );
  if (arsCents <= 0 || arsCents > 1000000000)
    throw new HttpError(503, "Importe fuera del rango permitido");
  return {
    usd_cents: servicePriceUSDCents,
    ars_cents: arsCents,
    rate_micro: rateMicro,
    rate: rateMicro / 1000000,
    source: rateSource,
    rate_as_of: fechaActualizacion,
  };
}
export async function createServiceQuote(
  db: Database,
  accountId: string,
  fetcher: typeof fetch = fetch,
) {
  let response: Response;
  try {
    response = await fetcher(rateURL, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(
      503,
      "No se pudo consultar la cotización. No se habilitó un cobro con un importe estimado.",
    );
  }
  if (!response.ok)
    throw new HttpError(
      503,
      "La cotización no está disponible. Intentá más tarde.",
    );
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HttpError(503, "No se pudo leer la cotización");
  }
  const data = parseRate(body),
    id = randomUUID(),
    expires = new Date(Date.now() + 15 * 60000).toISOString();
  await db.query(
    "INSERT INTO service_quotes(id,account_id,usd_cents,ars_cents,rate_micro,source,rate_as_of,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      id,
      accountId,
      data.usd_cents,
      data.ars_cents,
      data.rate_micro,
      data.source,
      data.rate_as_of,
      expires,
    ],
  );
  return { ...data, id, expires_at: expires, recipient };
}
