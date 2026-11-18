import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import { addDays, today } from "./dates.js";
import { hashPassword } from "./security.js";

export const demoAccountId = "fitware-demo";
export const demoGymId = "fitware-demo-gym";
export const demoOwnerId = "fitware-demo-owner";

const activities = [
  "Musculación",
  "Pilates",
  "Boxeo",
  "Yoga",
  "Entrenamiento funcional",
  "Spinning",
  "Movilidad",
  "Cross training",
  "Danza urbana",
  "Calistenia",
];
const members = [
  "Martina Lago",
  "Lucas Prado",
  "Valentina Pino",
  "Mateo Olmo",
  "Abril Sierra",
  "Nicolás Río",
  "Emma Solís",
  "Julián Valle",
  "Sofía Arroyo",
  "Bruno Castaño",
];
const expenses = [
  {
    description: "Artículos de limpieza",
    category: "Higiene",
    amount: 2750000,
  },
  {
    description: "Reposición de colchonetas",
    category: "Equipamiento",
    amount: 8400000,
  },
  {
    description: "Mantenimiento de bicicletas",
    category: "Mantenimiento",
    amount: 5250000,
  },
  {
    description: "Servicio de internet",
    category: "Servicios",
    amount: 1990000,
  },
  {
    description: "Material de recepción",
    category: "Insumos",
    amount: 1825000,
  },
];

export async function seedDemo(db: Database) {
  const day = today();
  await db.transaction(async (tx) => {
    const created = await tx.query(
      "INSERT INTO accounts(id,name,trial_until,is_demo) VALUES($1,'FITWare · Gimnasio demo',$2,true) ON CONFLICT(id) DO NOTHING RETURNING id",
      [demoAccountId, day],
    );
    if (!created.rows.length) return;
    await tx.query(
      "INSERT INTO gyms(id,account_id,name) VALUES($1,$2,'Gimnasio demo')",
      [demoGymId, demoAccountId],
    );
    await tx.query(
      "INSERT INTO users(id,account_id,name,email,password_hash,role) VALUES($1,$2,'Administrador demo',$3,$4,'owner')",
      [
        demoOwnerId,
        demoAccountId,
        randomUUID() + "@example.invalid",
        hashPassword(randomBytes(32).toString("hex")),
      ],
    );
    await tx.query(
      'INSERT INTO account_settings(account_id,modules) VALUES($1,\'{"products":true,"promotions":true,"multi_gym":false}\'::jsonb)',
      [demoAccountId],
    );
    for (const [index, activity] of activities.entries()) {
      const planId = randomUUID(),
        memberId = randomUUID();
      const plan = "Pase de " + activity;
      const price = 2700000 + index * 225000;
      await tx.query(
        "INSERT INTO plans(id,name,activity,price_cents,duration_days,duration_unit,gym_id) VALUES($1,$2,$3,$4,30,'days',$5)",
        [planId, plan, activity, price, demoGymId],
      );
      await tx.query(
        "INSERT INTO members(id,name,document,email,notes,gym_id) VALUES($1,$2,$3,$4,'Ficha ficticia del gimnasio demo.',$5)",
        [
          memberId,
          members[index],
          String(99000001 + index),
          `socio-${index + 1}@example.invalid`,
          demoGymId,
        ],
      );
      await tx.query("INSERT INTO member_activities VALUES($1,$2)", [
        memberId,
        planId,
      ]);

      // Los tres cobros de un socio cubren períodos consecutivos de 30 días.
      for (let period = 0; period < 3; period++) {
        const start = addDays(day, -64 - index * 4 + period * 30);
        const end = addDays(start, 30);
        const paidAt = start + "T10:00:00-03:00";
        const orderId = randomUUID(),
          subscriptionId = randomUUID();
        const cash = (index + period) % 2 === 0;
        const reference = `DEMO-${String(index * 3 + period + 1).padStart(3, "0")}`;
        await tx.query(
          "INSERT INTO orders(id,gym_id,request_key,fingerprint,amount_cents,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [orderId, demoGymId, randomUUID(), reference, price, paidAt],
        );
        await tx.query(
          "INSERT INTO subscriptions(id,member_id,plan_id,starts_on,ends_on,gym_id,anchor_day) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            subscriptionId,
            memberId,
            planId,
            start,
            end,
            demoGymId,
            Number(start.slice(8)),
          ],
        );
        await tx.query(
          `INSERT INTO payments(id,member_id,subscription_id,amount_cents,discount_cents,method,created_by,request_key,gym_id,order_id,activity_snapshot,plan_snapshot,method_name,reference,created_at)
           VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            randomUUID(),
            memberId,
            subscriptionId,
            price,
            cash ? "cash" : "transfer",
            demoOwnerId,
            randomUUID(),
            demoGymId,
            orderId,
            activity,
            plan,
            cash ? "Efectivo" : "Transferencia",
            reference,
            paidAt,
          ],
        );
      }
    }
    for (const [index, expense] of expenses.entries()) {
      const cash = index % 2 === 0;
      await tx.query(
        `INSERT INTO expenses(id,description,category,amount_cents,method,created_by,gym_id,method_name,reference,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          expense.description,
          expense.category,
          expense.amount,
          cash ? "cash" : "transfer",
          demoOwnerId,
          demoGymId,
          cash ? "Efectivo" : "Transferencia",
          `DEMO-E-${index + 1}`,
          addDays(day, -index * 6) + "T09:00:00-03:00",
        ],
      );
    }
  });
}
