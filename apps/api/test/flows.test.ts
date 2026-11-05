import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Server } from "node:http";
import ExcelJS from "exceljs";
import {
  connectDatabase,
  migrate,
  migrateV3,
  type Database,
} from "../src/db.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { createBackupService, restoreAccount } from "../src/backups.js";
import { today, addDays, dateText } from "../src/dates.js";
import { tokenHash } from "../src/security.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { ResetMail } from "../src/recovery.js";
let db: Database,
  server: Server,
  base: string,
  cookie = "",
  gym = "",
  account = "",
  plan = "",
  otherPlan = "",
  temp = "",
  otherCookie = "",
  otherGym = "",
  receptionCookie = "";
let backups: ReturnType<typeof createBackupService>;
const mails: ResetMail[] = [];
const password = "UnaClaveSegura2026!";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  auth = cookie,
  gymId = gym,
  mime = "application/json",
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": mime,
      "x-fitware-client": "web",
      ...(auth ? { cookie: auth } : {}),
      ...(gymId ? { "x-gym-id": gymId } : {}),
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? new Uint8Array(body)
          : JSON.stringify(body),
  });
  const data =
    response.status === 204
      ? null
      : response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer());
  return { response, data };
}
function ok(r: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(r.response.status, status, JSON.stringify(r.data));
  return r.data;
}
async function member(name: string, doc: string) {
  return ok(
    await request("/members", "POST", {
      name,
      document: doc,
      plan_ids: [plan],
    }),
    201,
  ).id;
}
const order = (id: string, extra: any = {}) => ({
  member_id: id,
  plan_ids: [plan],
  method: "cash",
  request_key: randomUUID(),
  ...extra,
});
before(async () => {
  process.env.ADMIN_EMAIL = "flows-owner@test.com";
  process.env.ADMIN_PASSWORD = password;
  process.env.RECEPTION_EMAIL = "flows-reception@test.com";
  process.env.RECEPTION_PASSWORD = password;
  process.env.SEED_DEMO = "false";
  process.env.REQUIRE_SUBSCRIPTION = "false";
  db = await connectDatabase(undefined, true);
  await migrate(db);
  await seed(db);
  temp = await mkdtemp(join(tmpdir(), "fitware-flows-"));
  backups = createBackupService(db, temp);
  server = createApp(db, {
    backups,
    resetSender: async (mail) => {
      mails.push(mail);
    },
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  let r = await request(
    "/auth/login",
    "POST",
    { email: "flows-owner@test.com", password },
    "",
  );
  ok(r);
  cookie = r.response.headers.get("set-cookie")!.split(";")[0];
  account = r.data.account_id;
  gym = ok(await request("/gyms"))[0].id;
  r = await request(
    "/auth/login",
    "POST",
    { email: "flows-reception@test.com", password },
    "",
  );
  ok(r);
  receptionCookie = r.response.headers.get("set-cookie")!.split(";")[0];
  plan = ok(
    await request("/plans", "POST", {
      name: "Mensual",
      activity: "Musculación",
      price_cents: 150001,
    }),
  ).id;
  otherPlan = ok(
    await request("/plans", "POST", {
      name: "Yoga",
      activity: "Yoga",
      price_cents: 90000,
    }),
  ).id;
  r = await request(
    "/auth/register",
    "POST",
    {
      name: "Otra cuenta",
      email: "flows-other@test.com",
      password,
      business_name: "Otro negocio",
      gym_name: "Otra sede",
    },
    "",
  );
  ok(r, 201);
  otherCookie = r.response.headers.get("set-cookie")!.split(";")[0];
  otherGym = ok(await request("/gyms", "GET", undefined, otherCookie, ""))[0]
    .id;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
  await rm(temp, { recursive: true, force: true });
});
test("configuración: valores simples en cuentas nuevas, módulos restringidos en API y permisos", async () => {
  assert.deepEqual(
    ok(await request("/settings", "GET", undefined, otherCookie, otherGym))
      .modules,
    { products: false, promotions: false, multi_gym: false },
  );
  assert.equal(
    (await request("/products", "GET", undefined, otherCookie, otherGym))
      .response.status,
    403,
  );
  assert.equal(
    (
      await request(
        "/gyms",
        "POST",
        { name: "Sede nueva" },
        otherCookie,
        otherGym,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        "/settings",
        "PUT",
        { modules: { products: false, promotions: false, multi_gym: false } },
        receptionCookie,
      )
    ).response.status,
    403,
  );
  ok(
    await request(
      "/settings",
      "PUT",
      { modules: { products: true, promotions: true, multi_gym: true } },
      otherCookie,
      otherGym,
    ),
  );
  ok(
    await request(
      "/gyms",
      "POST",
      { name: "Segunda sede" },
      otherCookie,
      otherGym,
    ),
    201,
  );
  assert.equal(
    (
      await request(
        "/settings",
        "PUT",
        { modules: { products: false, promotions: false, multi_gym: false } },
        otherCookie,
        otherGym,
      )
    ).response.status,
    409,
  );
});
test("alta y primer cobro son atómicos, cotizados e idempotentes; precio cambiado no deja socio huérfano", async () => {
  const b = {
    member: {
      name: "Alta integrada",
      document: "75000001",
      plan_ids: [plan, otherPlan],
    },
    payment: {
      plan_ids: [plan, otherPlan],
      method: "transfer",
      request_key: randomUUID(),
    },
    request_key: randomUUID(),
  };
  const q = ok(await request("/members/registration-quote", "POST", b));
  assert.equal(q.total_cents, 240001);
  assert.equal(q.lines.length, 2);
  assert.ok(q.lines[0].starts_on);
  assert.ok(q.lines[0].ends_on);
  const bad = { ...b, payment: { ...b.payment, expected_total_cents: 1 } };
  assert.equal(
    (await request("/members/register-and-charge", "POST", bad)).response
      .status,
    409,
  );
  assert.equal(
    (await db.query("SELECT id FROM members WHERE document='75000001'")).rows
      .length,
    0,
  );
  const correct = {
    ...b,
    payment: { ...b.payment, expected_total_cents: q.total_cents },
  };
  const a = ok(
    await request("/members/register-and-charge", "POST", correct),
    201,
  );
  const again = ok(
    await request("/members/register-and-charge", "POST", correct),
    201,
  );
  assert.equal(a.id, again.id);
  assert.equal(
    (await db.query("SELECT id FROM payments WHERE member_id=$1", [a.id])).rows
      .length,
    2,
  );
  assert.equal(
    (
      await request("/members/register-and-charge", "POST", {
        ...correct,
        member: { ...b.member, name: "Otro nombre" },
      })
    ).response.status,
    409,
  );
  const unauthorized = {
    ...b,
    member: { ...b.member, document: "75000002" },
    request_key: randomUUID(),
    payment: { ...b.payment, request_key: randomUUID() },
  };
  assert.equal(
    (
      await request(
        "/members/register-and-charge",
        "POST",
        unauthorized,
        otherCookie,
        otherGym,
      )
    ).response.status,
    400,
  );
  assert.equal(
    (await db.query("SELECT id FROM members WHERE document='75000002'")).rows
      .length,
    0,
  );
});
test("renovar igual recupera planes, medio y 2x1 sin cobrar; cotiza con precio actual y advierte promociones vencidas", async () => {
  const a = await member("Renovación A", "75000003"),
    b = await member("Renovación B", "75000004");
  const promo = ok(
    await request("/promotions", "POST", {
      name: "Pareja",
      kind: "two_for_one",
      discount_type: "fixed",
      plan_ids: [plan],
      member_ids: [a, b],
      value: 0,
    }),
  ).id;
  ok(
    await request(
      "/payments",
      "POST",
      order(a, { partner_id: b, promotion_id: promo }),
    ),
    201,
  );
  const template = ok(await request("/members/" + b + "/renewal"));
  assert.equal(template.partner_id, a);
  assert.equal(template.promotion_id, promo);
  assert.deepEqual(template.plan_ids, [plan]);
  await db.query("UPDATE plans SET price_cents=160001 WHERE id=$1", [plan]);
  const q = ok(await request("/payments/quote", "POST", order(b, template)));
  assert.equal(q.total_cents, 160001);
  await db.query("UPDATE promotions SET ends_on=$2 WHERE id=$1", [
    promo,
    addDays(today(), -1),
  ]);
  const expired = ok(await request("/members/" + a + "/renewal"));
  assert.equal(expired.promotion_id, undefined);
  assert.equal(expired.partner_id, undefined);
  assert.ok(expired.warnings.length);
  assert.equal(
    (await db.query("SELECT id FROM payments WHERE member_id=$1", [a])).rows
      .length,
    1,
  );
});
test("anular un cobro 2x1 cancela todas sus suscripciones, conserva historial y ajusta balances", async () => {
  const a = await member("Anular A", "75000005"),
    b = await member("Anular B", "75000006");
  const promo = ok(
    await request("/promotions", "POST", {
      name: "2x1 anulable",
      kind: "two_for_one",
      discount_type: "fixed",
      plan_ids: [plan],
      member_ids: [a, b],
      value: 0,
    }),
  ).id;
  const input = order(a, { partner_id: b, promotion_id: promo });
  const charged = ok(await request("/payments", "POST", input), 201);
  const lines = (
    await db.query("SELECT * FROM payments WHERE order_id=$1", [charged.id])
  ).rows;
  const before = ok(await request("/reports"));
  assert.equal(
    (
      await request(
        "/movements/payment/" + lines[0].id + "/void",
        "POST",
        { reason: "Error de carga" },
        receptionCookie,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        "/movements/payment/" + lines[0].id + "/void",
        "POST",
        { reason: "Error" },
        otherCookie,
        otherGym,
      )
    ).response.status,
    404,
  );
  assert.equal(
    (
      await request("/movements/payment/" + lines[0].id + "/void", "POST", {
        reason: "x",
      })
    ).response.status,
    400,
  );
  ok(
    await request("/movements/payment/" + lines[0].id + "/void", "POST", {
      reason: "Error de carga",
    }),
  );
  assert.equal(
    (
      await db.query(
        "SELECT id FROM subscriptions WHERE id=ANY($1::text[]) AND cancelled_at IS NOT NULL",
        [lines.map((l) => l.subscription_id)],
      )
    ).rows.length,
    2,
  );
  const after = ok(await request("/reports"));
  assert.equal(before.income_cents - after.income_cents, charged.amount_cents);
  assert.ok(after.movements.find((m: any) => m.id === lines[0].id).voided_at);
  assert.equal(
    ok(await request("/members")).find((m: any) => m.id === a).subscriptions
      .length,
    0,
  );
  ok(
    await request("/movements/payment/" + lines[1].id + "/void", "POST", {
      reason: "Otra vez",
    }),
  );
  assert.equal(
    (
      await db.query("SELECT id FROM void_events WHERE target_id=$1", [
        charged.id,
      ])
    ).rows.length,
    1,
  );
  assert.equal(
    (await request("/payments", "POST", input)).response.status,
    409,
  );
});
test("anulaciones respetan el orden de renovaciones y luego restauran vigencia anterior", async () => {
  const id = await member("Renovaciones", "75000007");
  const first = ok(await request("/payments", "POST", order(id)), 201),
    second = ok(await request("/payments", "POST", order(id)), 201);
  const firstLine = (
      await db.query("SELECT id FROM payments WHERE order_id=$1", [first.id])
    ).rows[0],
    secondLine = (
      await db.query("SELECT id FROM payments WHERE order_id=$1", [second.id])
    ).rows[0];
  assert.equal(
    (
      await request("/movements/payment/" + firstLine.id + "/void", "POST", {
        reason: "Corregir cuota",
      })
    ).response.status,
    409,
  );
  ok(
    await request("/movements/payment/" + secondLine.id + "/void", "POST", {
      reason: "Corregir renovación",
    }),
  );
  assert.equal(
    ok(await request("/members")).find((m: any) => m.id === id).subscriptions
      .length,
    1,
  );
  ok(
    await request("/movements/payment/" + firstLine.id + "/void", "POST", {
      reason: "Corregir cuota inicial",
    }),
  );
});
test("anular una venta repone stock una sola vez y recalcula el costo ponderado; egresos conservan historial", async () => {
  const product = ok(
    await request("/products", "POST", {
      name: "Agua prueba",
      category: "Bebidas",
      price_cents: 1000,
      cost_cents: 300,
      stock: 10,
      low_stock_threshold: 9,
      request_key: randomUUID(),
    }),
  );
  const input = {
    product_id: product.id,
    quantity: 4,
    method: "cash",
    request_key: randomUUID(),
  };
  const sale = ok(await request("/sales", "POST", input), 201);
  ok(
    await request("/products/" + product.id + "/restock", "POST", {
      quantity: 4,
      unit_cost_cents: 800,
      method: "cash",
      record_expense: true,
      request_key: randomUUID(),
    }),
    204,
  );
  const before = ok(await request("/reports"));
  ok(
    await request("/movements/sale/" + sale.id + "/void", "POST", {
      reason: "Venta cargada por error",
    }),
  );
  ok(
    await request("/movements/sale/" + sale.id + "/void", "POST", {
      reason: "Reintento seguro",
    }),
  );
  const updated = ok(await request("/products")).find(
    (p: any) => p.id === product.id,
  );
  assert.equal(updated.stock, 14);
  assert.equal(updated.cost_cents, 443);
  assert.equal(
    before.income_cents - ok(await request("/reports")).income_cents,
    4000,
  );
  assert.equal((await request("/sales", "POST", input)).response.status, 409);
  const expense = ok(
    await request("/expenses", "POST", {
      description: "Servicio",
      category: "General",
      amount_cents: 2000,
      method: "transfer",
    }),
    201,
  );
  const beforeExpense = ok(await request("/reports"));
  ok(
    await request("/movements/expense/" + expense.id + "/void", "POST", {
      reason: "Gasto duplicado",
    }),
  );
  assert.equal(
    beforeExpense.expense_cents - ok(await request("/reports")).expense_cents,
    2000,
  );
});
test("alertas muestran último vencimiento por plan y stock mínimo configurable", async () => {
  const id = await member("Vence pronto", "75000008");
  ok(await request("/payments", "POST", order(id)), 201);
  await db.query("UPDATE subscriptions SET ends_on=$2 WHERE member_id=$1", [
    id,
    addDays(today(), 2),
  ]);
  const d = ok(await request("/dashboard"));
  assert.ok(d.upcoming.some((s: any) => s.member_id === id));
  const p = ok(
    await request("/products", "POST", {
      name: "Barra",
      category: "Snacks",
      price_cents: 500,
      cost_cents: 100,
      stock: 3,
      low_stock_threshold: 3,
      request_key: randomUUID(),
    }),
  );
  assert.ok(
    ok(await request("/dashboard")).low_stock.some(
      (item: any) => item.id === p.id,
    ),
  );
  ok(await request("/payments", "POST", order(id)), 201);
  assert.ok(
    !ok(await request("/dashboard")).upcoming.some(
      (s: any) => s.member_id === id,
    ),
  );
});
test("Excel: vista previa valida filas, fórmulas y actividades; confirma sin sobrescribir ni duplicar", async () => {
  const existing = await member("No sobrescribir", "75000009");
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Socios");
  sheet.addRow(["Nombre", "DNI", "Actividades"]);
  sheet.addRow(["Nombre cambiado", "75000009", "Mensual"]);
  sheet.addRow([
    "Importado",
    "75000010",
    "Musculación - Mensual | Yoga - Yoga",
  ]);
  sheet.addRow(["DNI repetido", "75000010", ""]);
  sheet.addRow(["Actividad inexistente", "75000011", "No existe"]);
  sheet.addRow([{ formula: "1+1" }, "75000012", ""]);
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  const preview = ok(
    await request(
      "/members/import/preview",
      "POST",
      bytes,
      cookie,
      gym,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
  );
  assert.equal(preview.valid, 1);
  assert.equal(preview.duplicates, 2);
  assert.equal(preview.errors, 2);
  assert.equal(
    (
      await request(
        "/members/import/commit",
        "POST",
        { batch_id: preview.id },
        otherCookie,
        otherGym,
      )
    ).response.status,
    404,
  );
  const done = ok(
    await request("/members/import/commit", "POST", { batch_id: preview.id }),
  );
  assert.equal(done.imported, 1);
  assert.equal(done.skipped, 4);
  assert.deepEqual(
    ok(
      await request("/members/import/commit", "POST", { batch_id: preview.id }),
    ),
    done,
  );
  const m = ok(await request("/members"));
  assert.equal(m.find((x: any) => x.id === existing).name, "No sobrescribir");
  assert.equal(
    m.find((x: any) => x.document === "75000010").plan_ids.length,
    2,
  );
  assert.equal(
    m.find((x: any) => x.document === "75000010").subscriptions.length,
    0,
  );
  const template = ok(await request("/members/import/template"));
  assert.ok(Buffer.isBuffer(template));
  assert.ok(template.length > 1000);
});
test("CSV conserva ceros iniciales y revalida duplicados y planes al confirmar", async () => {
  const csv = Buffer.from(
    "Nombre;DNI;Actividades\nCSV Uno;07500013;Mensual\nCSV Dos;07500014;Yoga\n",
  );
  const preview = ok(
    await request(
      "/members/import/preview",
      "POST",
      csv,
      cookie,
      gym,
      "text/csv",
    ),
  );
  assert.equal(preview.valid, 2);
  await member("Alta simultánea", "07500013");
  await db.query("UPDATE plans SET active=false WHERE id=$1", [otherPlan]);
  const done = ok(
    await request("/members/import/commit", "POST", { batch_id: preview.id }),
  );
  assert.equal(done.imported, 0);
  assert.equal(done.skipped, 2);
  await db.query("UPDATE plans SET active=true WHERE id=$1", [otherPlan]);
  assert.equal(
    (await request("/members/import/preview", "POST", {})).response.status,
    400,
  );
});
test("respaldos por organización: integridad, descarga autorizada, periodicidad y restauración en base nueva", async () => {
  const b = ok(await request("/backups", "POST"), 201);
  const bytes = ok(await request("/backups/" + b.id + "/download"));
  const data = JSON.parse(gunzipSync(bytes).toString());
  assert.equal(data.account_id, account);
  assert.equal(data.tables.accounts.length, 1);
  assert.ok(
    !data.tables.users.some((u: any) => u.email === "flows-other@test.com"),
  );
  assert.ok(!("sessions" in data.tables));
  assert.ok(!("password_resets" in data.tables));
  assert.equal(
    (
      await request(
        "/backups/" + b.id + "/download",
        "GET",
        undefined,
        otherCookie,
        otherGym,
      )
    ).response.status,
    404,
  );
  assert.equal(
    (await request("/backups", "GET", undefined, receptionCookie)).response
      .status,
    403,
  );
  await backups.due();
  const count = (await backups.list(account)).length;
  await backups.due();
  assert.equal((await backups.list(account)).length, count);
  const target = await connectDatabase(undefined, true);
  try {
    await restoreAccount(target, bytes);
    assert.equal(
      (await target.query("SELECT count(*) n FROM members")).rows[0].n,
      (await db.query("SELECT count(*) n FROM members WHERE gym_id=$1", [gym]))
        .rows[0].n,
    );
    assert.equal(
      (await target.query("SELECT count(*) n FROM sessions")).rows[0].n,
      0,
    );
    await assert.rejects(restoreAccount(target, bytes), /ya tiene usuarios/);
  } finally {
    await target.close();
  }
  const bad = {
    ...data,
    tables: {
      ...data.tables,
      gyms: data.tables.gyms.map((g: any) => ({ ...g, account_id: "other" })),
    },
  };
  const empty = await connectDatabase(undefined, true);
  try {
    await assert.rejects(
      restoreAccount(empty, gzipSync(JSON.stringify(bad))),
      /no coincide/,
    );
  } finally {
    await empty.close();
  }
});
test("recuperación: respuesta uniforme, token privado de un uso, vencimiento y revocación de sesiones", async () => {
  const a = ok(
      await request(
        "/auth/forgot-password",
        "POST",
        { email: "flows-reception@test.com" },
        "",
      ),
      202,
    ),
    b = ok(
      await request(
        "/auth/forgot-password",
        "POST",
        { email: "nobody@test.com" },
        "",
      ),
      202,
    );
  assert.deepEqual(a, b);
  assert.equal(mails.length, 1);
  assert.ok(!JSON.stringify(a).includes("reset="));
  const token = mails[0].text.match(/#reset=([a-f0-9]{64})/)![1];
  assert.ok(
    (await db.query("SELECT token_hash FROM password_resets")).rows.every(
      (r) => r.token_hash !== token,
    ),
  );
  await request(
    "/auth/forgot-password",
    "POST",
    { email: "flows-reception@test.com" },
    "",
  );
  assert.equal(mails.length, 1);
  ok(
    await request(
      "/auth/reset-password",
      "POST",
      { token, password: "NuevaClave2026Segura!" },
      "",
    ),
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, receptionCookie)).response
      .status,
    401,
  );
  assert.equal(
    (await request("/auth/reset-password", "POST", { token, password }, ""))
      .response.status,
    400,
  );
  ok(
    await request(
      "/auth/login",
      "POST",
      { email: "flows-reception@test.com", password: "NuevaClave2026Segura!" },
      "",
    ),
  );
  const expired = "a".repeat(64),
    user = (
      await db.query(
        "SELECT id FROM users WHERE email='flows-reception@test.com'",
      )
    ).rows[0];
  await db.query("INSERT INTO password_resets VALUES($1,$2,$3,NULL,now())", [
    tokenHash(expired),
    user.id,
    new Date(Date.now() - 1000),
  ]);
  assert.equal(
    (
      await request(
        "/auth/reset-password",
        "POST",
        { token: expired, password },
        "",
      )
    ).response.status,
    400,
  );
});
test("migración v2.1 conserva datos y habilita módulos existentes al migrar a v3", async () => {
  const old = await connectDatabase(undefined, true);
  try {
    await migrateV3(old);
    await old.query(
      "INSERT INTO members(id,gym_id,name,document) VALUES('old','legacy-gym','Anterior','12345678')",
    );
    await migrate(old);
    await migrate(old);
    assert.equal(
      (await old.query("SELECT name FROM members WHERE id='old'")).rows[0].name,
      "Anterior",
    );
    assert.deepEqual(
      (await old.query("SELECT modules FROM account_settings")).rows[0].modules,
      { products: true, promotions: true, multi_gym: true },
    );
  } finally {
    await old.close();
  }
});
test("el cobro rechaza vencimientos desactualizados si otra recepción renovó antes de confirmar", async () => {
  const id = await member("Cotización concurrente", "75000015");
  const q = ok(await request("/payments/quote", "POST", order(id)));
  const expected_periods = q.lines.map((l: any) => ({
    member_id: l.member_id,
    plan_id: l.plan.id,
    starts_on: l.starts_on,
    ends_on: l.ends_on,
  }));
  ok(await request("/payments", "POST", order(id)), 201);
  assert.equal(
    (
      await request(
        "/payments",
        "POST",
        order(id, { expected_total_cents: q.total_cents, expected_periods }),
      )
    ).response.status,
    409,
  );
  assert.equal(
    (await db.query("SELECT id FROM subscriptions WHERE member_id=$1", [id]))
      .rows.length,
    1,
  );
});
test("el comando npm de restauración recupera un respaldo sobre un directorio nuevo", async () => {
  const b = await backups.create(account),
    target = join(temp, "restauracion-cli");
  const { stdout } = await promisify(execFile)(
    "npm",
    ["run", "restore", "--", join(temp, account, b.file_name)],
    {
      cwd: resolve("../.."),
      env: { ...process.env, DATABASE_URL: "", DATA_DIRECTORY: target },
      timeout: 30000,
    },
  );
  assert.match(stdout, /Restauración completada/);
  const previous = process.env.DATA_DIRECTORY;
  process.env.DATA_DIRECTORY = target;
  let restored: Database | undefined;
  try {
    restored = await connectDatabase();
    assert.equal(
      (await restored.query("SELECT count(*) n FROM members")).rows[0].n,
      (await db.query("SELECT count(*) n FROM members WHERE gym_id=$1", [gym]))
        .rows[0].n,
    );
  } finally {
    await restored?.close();
    if (previous === undefined) delete process.env.DATA_DIRECTORY;
    else process.env.DATA_DIRECTORY = previous;
  }
});
