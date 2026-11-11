import { z } from "zod";
import type { Database } from "./db.js";
import { HttpError } from "./domain.js";
import { plainString } from "./input-safety.js";
export const paymentFields = {
  method_detail: plainString.pipe(z.string().max(180)).optional(),
  reference: plainString.pipe(z.string().max(180)).default(""),
};
export async function methods(db: Database, gymId: string) {
  for (const [key, name, method] of [
    ["cash", "Efectivo", "cash"],
    ["bank", "Transferencia bancaria", "transfer"],
    ["mp", "Mercado Pago", "transfer"],
    ["debit", "Tarjeta de débito", "transfer"],
    ["credit", "Tarjeta de crédito", "transfer"],
    ["qr", "QR / billetera", "transfer"],
  ])
    await db.query(
      "INSERT INTO payment_methods(id,gym_id,name,method) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [`${gymId}:${key}`, gymId, name, method],
    );
  return (
    await db.query(
      "SELECT * FROM payment_methods WHERE gym_id=$1 ORDER BY method,name",
      [gymId],
    )
  ).rows;
}
export async function resolveMethod(
  db: Database,
  gymId: string,
  b: { method: string; method_detail?: string; reference?: string },
) {
  if (!b.method_detail)
    return {
      name: b.method === "cash" ? "Efectivo" : "Transferencia",
      reference: b.reference || "",
    };
  const m = (
    await db.query(
      "SELECT * FROM payment_methods WHERE id=$1 AND gym_id=$2 AND active",
      [b.method_detail, gymId],
    )
  ).rows[0];
  if (!m || m.method !== b.method)
    throw new HttpError(
      400,
      "El medio de pago ya no está disponible o no corresponde a ese tipo de caja. Volvé a seleccionarlo.",
    );
  return { name: m.name as string, reference: b.reference || "" };
}
