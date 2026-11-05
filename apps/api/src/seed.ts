import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { hashPassword } from "./security.js";
export const permissionNames = [
  "members.read",
  "members.write",
  "payments.read",
  "payments.write",
  "plans.read",
  "plans.manage",
  "products.read",
  "products.manage",
  "sales.write",
  "reports.read",
  "expenses.write",
  "promos.manage",
  "movements.void",
] as const;
export const presets = {
  receptionist: [
    "members.read",
    "members.write",
    "payments.read",
    "payments.write",
    "plans.read",
    "products.read",
    "sales.write",
  ],
  trainer: ["members.read", "plans.read"],
};
export async function seed(db: Database) {
  if (!(await db.query("SELECT id FROM users LIMIT 1")).rows.length) {
    const password = process.env.ADMIN_PASSWORD;
    if (!password || password.length < 10)
      throw new Error("Definí ADMIN_PASSWORD (mínimo 10 caracteres) en .env.");
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,role,account_id) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        "Administrador",
        (process.env.ADMIN_EMAIL || "dueno@fitware.local").toLowerCase(),
        hashPassword(password),
        "owner",
        "legacy-account",
      ],
    );
    if (process.env.RECEPTION_PASSWORD) {
      if (process.env.RECEPTION_PASSWORD.length < 10)
        throw new Error("RECEPTION_PASSWORD debe tener al menos 10 caracteres");
      const id = randomUUID();
      await db.query(
        "INSERT INTO users(id,name,email,password_hash,role,account_id,permissions) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",
        [
          id,
          "Recepción",
          (
            process.env.RECEPTION_EMAIL || "recepcion@fitware.local"
          ).toLowerCase(),
          hashPassword(process.env.RECEPTION_PASSWORD),
          "receptionist",
          "legacy-account",
          JSON.stringify(presets.receptionist),
        ],
      );
      await db.query("INSERT INTO staff_gyms VALUES($1,$2)", [
        id,
        "legacy-gym",
      ]);
    }
  }
  if (
    process.env.SEED_DEMO === "true" &&
    !(await db.query("SELECT id FROM plans WHERE gym_id='legacy-gym' LIMIT 1"))
      .rows.length
  ) {
    for (const [name, activity, price] of [
      ["Pase libre", "Musculación", 3500000],
      ["Tres veces por semana", "Musculación", 2800000],
      ["Pilates mensual", "Pilates", 4200000],
      ["Cross training", "Crossfit", 3800000],
    ])
      await db.query(
        "INSERT INTO plans(id,name,activity,price_cents,duration_days,duration_unit,gym_id) VALUES($1,$2,$3,$4,30,'month','legacy-gym')",
        [randomUUID(), name, activity, price],
      );
    for (const [name, document] of [
      ["Martina López", "40000001"],
      ["Lucas Fernández", "40000002"],
      ["Valentina García", "40000003"],
    ])
      await db.query(
        "INSERT INTO members(id,name,document,gym_id) VALUES($1,$2,$3,'legacy-gym')",
        [randomUUID(), name, document],
      );
  }
}
