import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import type { Database, Row } from "./db.js";
import { migrate } from "./db.js";
import { HttpError } from "./domain.js";
export const backupTables = [
  "accounts",
  "account_settings",
  "gyms",
  "payment_methods",
  "users",
  "staff_gyms",
  "members",
  "member_photos",
  "access_credentials",
  "checkins",
  "plans",
  "subscriptions",
  "member_activities",
  "promotions",
  "orders",
  "payments",
  "pending_payments",
  "cash_counts",
  "products",
  "sales",
  "inventory_movements",
  "expenses",
  "product_operations",
  "void_events",
  "member_registrations",
  "import_batches",
  "service_quotes",
  "billing_orders",
  "billing_receipts",
  "audit_logs",
] as const;
const gymTables = new Set([
  "payment_methods",
  "member_photos",
  "access_credentials",
  "checkins",
  "pending_payments",
  "cash_counts",
  "members",
  "plans",
  "subscriptions",
  "promotions",
  "orders",
  "payments",
  "products",
  "sales",
  "inventory_movements",
  "expenses",
  "product_operations",
  "void_events",
  "member_registrations",
  "import_batches",
]);
const accountTables = new Set([
  "account_settings",
  "users",
  "service_quotes",
  "billing_orders",
  "billing_receipts",
  "audit_logs",
]);
async function snapshot(db: Database, accountId: string) {
  return db.transaction(async (tx) => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const account = (
      await tx.query("SELECT * FROM accounts WHERE id=$1", [accountId])
    ).rows[0];
    if (!account) throw new HttpError(404, "Organización no encontrada");
    const tables: Record<string, Row[]> = {};
    for (const table of backupTables) {
      let sql: string;
      if (table === "accounts") sql = "SELECT * FROM accounts WHERE id=$1";
      else if (table === "gyms") sql = "SELECT * FROM gyms WHERE account_id=$1";
      else if (accountTables.has(table))
        sql = `SELECT * FROM ${table} WHERE account_id=$1`;
      else if (gymTables.has(table))
        sql = `SELECT * FROM ${table} WHERE gym_id IN (SELECT id FROM gyms WHERE account_id=$1)`;
      else if (table === "staff_gyms")
        sql =
          "SELECT * FROM staff_gyms WHERE user_id IN (SELECT id FROM users WHERE account_id=$1)";
      else
        sql =
          "SELECT * FROM member_activities WHERE member_id IN (SELECT m.id FROM members m JOIN gyms g ON g.id=m.gym_id WHERE g.account_id=$1)";
      tables[table] = (await tx.query(sql, [accountId])).rows;
    }
    return {
      format: "fitware-account-backup",
      schema_version: 5,
      account_id: accountId,
      created_at: new Date().toISOString(),
      tables,
    };
  });
}
export function createBackupService(
  db: Database,
  directory = resolve(process.env.BACKUP_DIRECTORY || ".backups"),
) {
  const running = new Map<string, Promise<Row>>();
  async function create(accountId: string): Promise<Row> {
    if (running.has(accountId)) return running.get(accountId)!;
    const task = (async () => {
      const data = await snapshot(db, accountId),
        id = randomUUID(),
        folder = resolve(directory, accountId);
      if (!/^[a-zA-Z0-9_-]+$/.test(accountId))
        throw new Error("Invalid account path");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const bytes = gzipSync(Buffer.from(JSON.stringify(data)));
      const fileName = id + ".json.gz",
        file = resolve(folder, fileName);
      await writeFile(file + ".tmp", bytes, { mode: 0o600, flag: "wx" });
      await rename(file + ".tmp", file);
      return (
        await db.query(
          "INSERT INTO backup_runs(id,account_id,file_name,sha256,size_bytes) VALUES($1,$2,$3,$4,$5) RETURNING id,file_name,sha256,size_bytes,created_at",
          [
            id,
            accountId,
            fileName,
            createHash("sha256").update(bytes).digest("hex"),
            bytes.length,
          ],
        )
      ).rows[0];
    })();
    running.set(accountId, task);
    try {
      return await task;
    } finally {
      running.delete(accountId);
    }
  }
  async function list(accountId: string) {
    return (
      await db.query(
        "SELECT id,file_name,sha256,size_bytes,created_at FROM backup_runs WHERE account_id=$1 ORDER BY created_at DESC",
        [accountId],
      )
    ).rows;
  }
  async function download(accountId: string, id: string) {
    const row = (
      await db.query(
        "SELECT * FROM backup_runs WHERE id=$1 AND account_id=$2",
        [id, accountId],
      )
    ).rows[0];
    if (!row || !/^[-a-f0-9]{36}\.json\.gz$/.test(row.file_name))
      throw new HttpError(404, "Respaldo no encontrado");
    const bytes = await readFile(resolve(directory, accountId, row.file_name));
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256)
      throw new HttpError(
        500,
        "El respaldo no superó la comprobación de integridad",
      );
    return bytes;
  }
  async function due() {
    for (const account of (await db.query("SELECT id FROM accounts")).rows) {
      const last = (await list(account.id))[0];
      if (
        !last ||
        Date.now() - new Date(last.created_at).getTime() >= 24 * 3600000
      )
        await create(account.id);
    }
  }
  function start() {
    void due().catch(() =>
      console.error("No se pudo completar un respaldo automático."),
    );
    const timer = setInterval(() => {
      void due().catch(() =>
        console.error("No se pudo completar un respaldo automático."),
      );
    }, 3600000);
    timer.unref();
    return () => clearInterval(timer);
  }
  return { create, list, download, due, start };
}
export type BackupService = ReturnType<typeof createBackupService>;
export async function restoreAccount(db: Database, bytes: Buffer) {
  let data: any;
  try {
    data = JSON.parse(
      gunzipSync(bytes, { maxOutputLength: 50 * 1024 * 1024 }).toString("utf8"),
    );
  } catch {
    throw new HttpError(400, "No se pudo leer el respaldo");
  }
  if (
    data.format !== "fitware-account-backup" ||
    ![4, 5].includes(data.schema_version) ||
    typeof data.account_id !== "string" ||
    !data.tables
  )
    throw new HttpError(400, "Formato de respaldo no compatible");
  const accountId = data.account_id;
  if (data.schema_version === 4)
    for (const t of [
      "payment_methods",
      "member_photos",
      "access_credentials",
      "checkins",
      "pending_payments",
      "cash_counts",
    ])
      data.tables[t] = [];
  for (const t of backupTables)
    if (!Array.isArray(data.tables[t]))
      throw new HttpError(400, "El respaldo está incompleto");
  if (
    data.tables.accounts.length !== 1 ||
    data.tables.accounts[0].id !== accountId ||
    data.tables.gyms.some((g: Row) => g.account_id !== accountId) ||
    data.tables.users.some((u: Row) => u.account_id !== accountId)
  )
    throw new HttpError(400, "La organización del respaldo no coincide");
  const gymIds = new Set(data.tables.gyms.map((g: Row) => g.id));
  for (const t of backupTables) {
    if (
      gymTables.has(t) &&
      data.tables[t].some((r: Row) => !gymIds.has(r.gym_id))
    )
      throw new HttpError(400, "El respaldo mezcla sedes");
    if (
      accountTables.has(t) &&
      data.tables[t].some((r: Row) => r.account_id !== accountId)
    )
      throw new HttpError(400, "El respaldo mezcla organizaciones");
  }
  await migrate(db);
  await db.transaction(async (tx) => {
    const existing = (await tx.query("SELECT count(*) n FROM users")).rows[0];
    if (Number(existing.n) > 0)
      throw new HttpError(
        409,
        "La organización ya tiene usuarios. Restaurá en una base nueva para no sobrescribir datos.",
      );
    for (const t of ["members", "plans", "products", "orders"])
      if (Number((await tx.query(`SELECT count(*) n FROM ${t}`)).rows[0].n) > 0)
        throw new HttpError(409, "La organización de destino no está vacía");
    for (const table of backupTables) {
      const columns = (
        await tx.query(
          "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [table],
        )
      ).rows;
      const types = new Map(columns.map((c) => [c.column_name, c.data_type]));
      for (const row of data.tables[table]) {
        const names = Object.keys(row);
        if (
          !names.length ||
          names.some((n) => !types.has(n) || !/^\w+$/.test(n))
        )
          throw new HttpError(400, "Columnas del respaldo no compatibles");
        const values = names.map((n) =>
          types.get(n) === "jsonb"
            ? JSON.stringify(row[n])
            : types.get(n) === "date" && row[n]
              ? String(row[n]).slice(0, 10)
              : row[n],
        );
        const conflict = ["accounts", "gyms", "account_settings"].includes(
          table,
        )
          ? ` ON CONFLICT (${table === "account_settings" ? "account_id" : "id"}) DO UPDATE SET ${names
              .filter(
                (n) =>
                  n !== (table === "account_settings" ? "account_id" : "id"),
              )
              .map((n) => `"${n}"=EXCLUDED."${n}"`)
              .join(",")}`
          : "";
        if (table === "gyms") {
          const present = (
            await tx.query("SELECT account_id FROM gyms WHERE id=$1", [row.id])
          ).rows[0];
          if (present && present.account_id !== accountId)
            throw new HttpError(
              409,
              "Una sede ya pertenece a otra organización",
            );
        }
        await tx.query(
          `INSERT INTO ${table}(${names.map((n) => '"' + n + '"').join(",")}) VALUES(${names.map((_, i) => "$" + (i + 1)).join(",")})${conflict}`,
          values,
        );
      }
    }
  });
  return { account_id: accountId };
}
