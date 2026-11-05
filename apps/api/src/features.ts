import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { HttpError } from "./domain.js";
export type Modules = {
  products: boolean;
  promotions: boolean;
  multi_gym: boolean;
};
export async function getModules(
  db: Database,
  accountId: string,
): Promise<Modules> {
  await db.query(
    "INSERT INTO account_settings(account_id) VALUES($1) ON CONFLICT DO NOTHING",
    [accountId],
  );
  return (
    await db.query("SELECT modules FROM account_settings WHERE account_id=$1", [
      accountId,
    ])
  ).rows[0].modules;
}
export async function audit(
  db: Database,
  accountId: string,
  actorId: string,
  action: string,
  details: unknown,
  gymId: string | null = null,
) {
  await db.query(
    "INSERT INTO audit_logs(id,account_id,gym_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
    [randomUUID(), accountId, gymId, actorId, action, JSON.stringify(details)],
  );
}
export function checkModule(modules: Modules, key: keyof Modules) {
  if (!modules[key])
    throw new HttpError(
      403,
      "Este módulo está desactivado. El dueño puede habilitarlo en Configuración.",
    );
}
