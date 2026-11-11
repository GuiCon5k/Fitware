import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import sharp from "sharp";
import ExcelJS from "exceljs";
import { connectDatabase, migrate, type Database } from "../src/db.js";
import { createApp } from "../src/app.js";
import { today, addDays } from "../src/dates.js";
import { createBackupService, restoreAccount } from "../src/backups.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let db: Database,
  server: Server,
  base: string,
  cookie: string,
  gym: string,
  otherCookie: string,
  otherGym: string,
  plan: string,
  yoga: string,
  bank: string,
  account: string,
  receptionCookie: string,
  temp: string;
const originalFetch = globalThis.fetch;
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  auth = cookie,
  site = gym,
  mime = "application/json",
) {
  const r = await originalFetch(base + path, {
    method,
    headers: {
      "Content-Type": mime,
      "X-Fitware-Client": "web",
      Cookie: auth || "",
      "X-Gym-Id": site || "",
    },
    body:
      body === undefined
        ? undefined
        : Buffer.isBuffer(body)
          ? new Uint8Array(body)
          : JSON.stringify(body),
  });
  const data =
    r.status === 204
      ? null
      : r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer());
  return { status: r.status, data, headers: r.headers };
}
function ok(r: Awaited<ReturnType<typeof req>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function member(doc: string) {
  return ok(
    await req("/members", "POST", {
      name: "Socio " + doc,
      document: doc,
      phone: "1155554444",
      plan_ids: [plan, yoga],
    }),
    201,
  ).id;
}
const order = (id: string, extra: any = {}) => ({
  member_id: id,
  plan_ids: [plan],
  method: "transfer",
  method_detail: bank,
  reference: "Ref banco",
  request_key: randomUUID(),
  ...extra,
});
async function prepare(id: string, extra: any = {}) {
  const b = order(id, extra);
  const q = ok(await req("/payments/quote", "POST", b));
  return {
    ...b,
    expected_total_cents: q.total_cents,
    expected_periods: q.lines.map((l: any) => ({
      member_id: l.member_id,
      plan_id: l.plan.id,
      starts_on: l.starts_on,
      ends_on: l.ends_on,
    })),
  };
}
async function reviewQuote(id: string) {
  const q = ok(await req(`/pending-payments/${id}/quote`));
  return {
    expected_total_cents: q.total_cents,
    expected_periods: q.lines.map((l: any) => ({
      member_id: l.member_id,
      plan_id: l.plan.id,
      starts_on: l.starts_on,
      ends_on: l.ends_on,
    })),
  };
}
before(async () => {
  process.env.REQUIRE_SUBSCRIPTION = "false";
  process.env.SEED_DEMO = "false";
  db = await connectDatabase(undefined, true);
  await migrate(db);
  temp = await mkdtemp(join(tmpdir(), "fitware-feedback-"));
  server = createApp(db, { backups: createBackupService(db, temp) }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const second of [false, true]) {
    const r = await req(
      "/auth/register",
      "POST",
      {
        name: "Dueño",
        business_name: "Gimnasio",
        gym_name: "Sede",
        email: second ? "feedback2@test.com" : "feedback1@test.com",
        password: "PruebaSegura2026!",
        confirm_password: "PruebaSegura2026!",
      },
      "",
      "",
    );
    ok(r, 201);
    const c = r.headers.get("set-cookie")!.split(";")[0],
      g = ok(await req("/gyms", "GET", undefined, c, ""))[0].id;
    if (second) {
      otherCookie = c;
      otherGym = g;
    } else {
      cookie = c;
      gym = g;
      account = r.data.account_id;
    }
  }
  await req("/settings", "PUT", {
    modules: { products: true, promotions: true, multi_gym: true },
  });
  plan = ok(
    await req("/plans", "POST", {
      name: "Pase gym",
      activity: "Musculación",
      price_cents: 500001,
    }),
    200,
  ).id;
  yoga = ok(
    await req("/plans", "POST", {
      name: "Yoga mensual",
      activity: "Yoga",
      price_cents: 200000,
    }),
    200,
  ).id;
  bank = ok(await req("/payment-methods")).find(
    (m: any) => m.name === "Transferencia bancaria",
  ).id;
  const staff = ok(
    await req("/staff", "POST", {
      name: "Recepción",
      email: "feedback-r@test.com",
      password: "PruebaSegura2026!",
      role: "receptionist",
      permissions: [
        "members.read",
        "payments.read",
        "payments.write",
        "plans.read",
        "access.checkin",
      ],
      gym_ids: [gym],
    }),
    201,
  );
  const login = await req(
    "/auth/login",
    "POST",
    { email: "feedback-r@test.com", password: "PruebaSegura2026!" },
    "",
    "",
  );
  ok(login);
  receptionCookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.ok(staff.id);
});
after(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.GYM_MP_ACCESS_TOKEN;
  delete process.env.GYM_MP_COLLECTOR_ID;
  delete process.env.GYM_MP_GYM_ID;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
  await rm(temp, { recursive: true, force: true });
});
test("medios específicos: mismo detalle en cuotas, ventas, reposiciones y egresos; conserva historia y aísla sedes", async () => {
  const m = ok(
    await req("/payment-methods", "POST", {
      name: "Banco Provincia",
      method: "transfer",
    }),
    201,
  );
  const id = await member("90000001"),
    b = order(id, { method_detail: m.id });
  ok(await req("/payments", "POST", b), 201);
  const p = ok(await req("/payments")).find((p: any) => p.member_id === id);
  assert.equal(p.method_name, "Banco Provincia");
  assert.equal(p.member_document, "90000001");
  assert.equal(p.member_phone, "1155554444");
  assert.equal(p.reference, "Ref banco");
  const product = ok(
    await req("/products", "POST", {
      name: "Bebida",
      category: "Bebidas",
      price_cents: 20000,
      cost_cents: 10000,
      stock: 4,
      record_stock_expense: true,
      method: "transfer",
      method_detail: m.id,
      reference: "Compra inicial",
      request_key: randomUUID(),
    }),
  );
  const sale = ok(
    await req("/sales", "POST", {
      product_id: product.id,
      quantity: 1,
      method: "transfer",
      method_detail: m.id,
      reference: "Posnet 123",
      request_key: randomUUID(),
    }),
    201,
  );
  assert.equal(sale.method_name, "Banco Provincia");
  ok(
    await req(`/products/${product.id}/restock`, "POST", {
      quantity: 2,
      unit_cost_cents: 11000,
      record_expense: true,
      method: "transfer",
      method_detail: m.id,
      reference: "Reposición",
      request_key: randomUUID(),
    }),
    204,
  );
  const e = {
    description: "Limpieza",
    category: "General",
    amount_cents: 100,
    method: "transfer",
    method_detail: m.id,
    reference: "Factura 9",
    request_key: randomUUID(),
  };
  const expense = ok(await req("/expenses", "POST", e), 201);
  assert.equal(ok(await req("/expenses", "POST", e), 201).id, expense.id);
  assert.ok(
    ok(await req("/expenses"))
      .filter(
        (e: any) =>
          e.reference === "Reposición" || e.reference === "Compra inicial",
      )
      .every((e: any) => e.method_name === "Banco Provincia"),
  );
  ok(
    await req(`/payment-methods/${encodeURIComponent(m.id)}`, "PUT", {
      active: false,
    }),
  );
  assert.equal(
    ok(await req("/payments")).find((row: any) => row.id === p.id).method_name,
    "Banco Provincia",
  );
  ok(await req("/payments", "POST", order(id, { method_detail: m.id })), 400);
  ok(
    await req(
      "/payments",
      "POST",
      order(id, { method_detail: `${otherGym}:bank` }),
    ),
    400,
  );
  ok(
    await req(
      "/payment-methods",
      "POST",
      { name: "Ajeno", method: "cash" },
      receptionCookie,
    ),
    403,
  );
  const report = ok(await req(`/reports?from=${today()}&to=${today()}`));
  assert.equal(
    report.movements.find((m: any) => m.id === sale.id).method_name,
    "Banco Provincia",
  );
});
test("transferencia pendiente no habilita ni ingresa; confirmación concurrente única, permisos y rechazo", async () => {
  const id = await member("90000002"),
    b = await prepare(id),
    p = ok(await req("/pending-payments", "POST", b), 201);
  assert.equal(ok(await req("/pending-payments", "POST", b), 201).id, p.id);
  assert.equal(
    (await db.query("SELECT id FROM subscriptions WHERE member_id=$1", [id]))
      .rows.length,
    0,
  );
  assert.equal(
    ok(await req("/payments")).filter((p: any) => p.member_id === id).length,
    0,
  );
  ok(await req("/payments", "POST", b), 409);
  ok(
    await req(
      `/pending-payments/${p.id}/quote`,
      "GET",
      undefined,
      otherCookie,
      otherGym,
    ),
    404,
  );
  const review = {
    action: "confirm",
    reason: "Revisado en cuenta bancaria",
    ...(await reviewQuote(p.id)),
  };
  ok(
    await req(
      `/pending-payments/${p.id}/review`,
      "POST",
      review,
      receptionCookie,
    ),
    403,
  );
  const both = await Promise.all([
    req(`/pending-payments/${p.id}/review`, "POST", review),
    req(`/pending-payments/${p.id}/review`, "POST", review),
  ]);
  assert.equal(ok(both[0]).id, ok(both[1]).id);
  assert.equal(
    (await db.query("SELECT id FROM subscriptions WHERE member_id=$1", [id]))
      .rows.length,
    1,
  );
  const next = ok(
    await req("/pending-payments", "POST", await prepare(id)),
    201,
  );
  ok(
    await req(`/pending-payments/${next.id}/review`, "POST", {
      action: "reject",
      reason: "No acreditado",
    }),
  );
  ok(await req(`/pending-payments/${next.id}/review`, "POST", review), 409);
  assert.equal(
    ok(await req("/pending-payments")).find((p: any) => p.id === next.id)
      .status,
    "rejected",
  );
  ok(await req("/pending-payments", "POST", b, otherCookie, otherGym), 409);
});
test("pendiente con precio cambiado no confirma sin cobrar la diferencia", async () => {
  const id = await member("90000003"),
    b = await prepare(id),
    p = ok(await req("/pending-payments", "POST", b), 201);
  await db.query("UPDATE plans SET price_cents=price_cents+1 WHERE id=$1", [
    plan,
  ]);
  const reviewed = await reviewQuote(p.id);
  ok(
    await req(`/pending-payments/${p.id}/review`, "POST", {
      action: "confirm",
      reason: "Revisado",
      ...reviewed,
    }),
    409,
  );
  assert.equal(
    (await db.query("SELECT id FROM subscriptions WHERE member_id=$1", [id]))
      .rows.length,
    0,
  );
  await db.query("UPDATE plans SET price_cents=price_cents-1 WHERE id=$1", [
    plan,
  ]);
});
test("verificación MP exige cuenta, moneda, estado, importe, fecha y operación única; no confunde suscripción FITWare", async () => {
  const id = await member("90000004"),
    p = ok(await req("/pending-payments", "POST", await prepare(id)), 201),
    q = await reviewQuote(p.id);
  const body = {
    action: "mercadopago",
    provider_payment_id: "1234567",
    reason: "Identidad y acreditación revisadas",
    ...q,
  };
  ok(await req(`/pending-payments/${p.id}/review`, "POST", body), 503);
  process.env.GYM_MP_ACCESS_TOKEN = "test-fixture-token";
  process.env.GYM_MP_COLLECTOR_ID = "9001";
  process.env.GYM_MP_GYM_ID = gym;
  let payment: any = {
    id: 1234567,
    status: "approved",
    currency_id: "ARS",
    collector_id: 9001,
    transaction_amount: 5000.01,
    transaction_amount_refunded: 0,
    date_approved: new Date().toISOString(),
    live_mode: true,
  };
  globalThis.fetch = (async (input: any, init: any) =>
    String(input).startsWith("https://api.mercadopago.com/v1/payments/")
      ? new Response(JSON.stringify(payment), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : originalFetch(input, init)) as typeof fetch;
  for (const [key, bad] of [
    ["status", "pending"],
    ["currency_id", "USD"],
    ["collector_id", 9002],
    ["transaction_amount", 5000],
    ["transaction_amount_refunded", 1],
    ["date_approved", "2000-01-01T00:00:00Z"],
  ]) {
    const old = payment[key as string];
    payment[key as string] = bad;
    ok(await req(`/pending-payments/${p.id}/review`, "POST", body), 409);
    payment[key as string] = old;
  }
  ok(await req(`/pending-payments/${p.id}/review`, "POST", body));
  assert.equal(
    ok(await req("/pending-payments")).find((x: any) => x.id === p.id)
      .verification,
    "mercadopago",
  );
  const another = await member("90000005"),
    p2 = ok(
      await req("/pending-payments", "POST", await prepare(another)),
      201,
    );
  ok(
    await req(`/pending-payments/${p2.id}/review`, "POST", {
      ...body,
      ...(await reviewQuote(p2.id)),
    }),
    409,
  );
  assert.equal(ok(await req("/billing")).receipts.length, 0);
  globalThis.fetch = originalFetch;
});
test("ingresos: DNI, foto privada, QR revocable, actividades vigentes, anulación y repetición", async () => {
  const id = await member("90000006"),
    credential = ok(
      await req(`/members/${id}/credential`, "POST"),
      201,
    ).credential;
  assert.ok(credential.startsWith("FW1-"));
  assert.equal(
    (
      await db.query(
        "SELECT token_hash FROM access_credentials WHERE member_id=$1",
        [id],
      )
    ).rows[0].token_hash.includes(credential),
    false,
  );
  const lookup = (identifier: string, activity = "") =>
    req("/access/lookup", "POST", { identifier, activity });
  assert.equal(ok(await lookup(credential)).allowed, false);
  const charge = ok(await req("/payments", "POST", order(id)), 201);
  assert.equal(ok(await lookup("90000006")).allowed, true);
  assert.equal(ok(await lookup(credential, "Yoga")).allowed, false);
  const attempts = {
    identifier: credential,
    activity: "Musculación",
    request_key: randomUUID(),
  };
  const one = ok(await req("/access/checkins", "POST", attempts), 201);
  assert.equal(one.allowed, true);
  assert.equal(
    ok(await req("/access/checkins", "POST", attempts), 201).id,
    one.id,
  );
  assert.equal(
    ok(
      await req("/access/checkins", "POST", {
        ...attempts,
        request_key: randomUUID(),
      }),
      201,
    ).duplicate,
    true,
  );
  const denied = ok(
    await req("/access/checkins", "POST", {
      identifier: credential,
      activity: "Yoga",
      request_key: randomUUID(),
    }),
    201,
  );
  assert.equal(denied.allowed, false);
  ok(
    await req(
      "/access/lookup",
      "POST",
      { identifier: credential },
      otherCookie,
      otherGym,
    ),
    404,
  );
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  ok(await req(`/members/${id}/photo`, "PUT", image, cookie, gym, "image/png"));
  const photo = await req(
    `/member-photos/${id}?gym_id=${gym}`,
    "GET",
    undefined,
    cookie,
    "",
  );
  ok(photo);
  assert.equal(photo.headers.get("content-type"), "image/jpeg");
  assert.equal((await sharp(photo.data).metadata()).format, "jpeg");
  ok(
    await req(`/member-photos/${id}?gym_id=${gym}`, "GET", undefined, "", ""),
    401,
  );
  ok(
    await req(`/member-photos/${id}`, "GET", undefined, otherCookie, otherGym),
    404,
  );
  ok(
    await req(
      `/members/${id}/photo`,
      "PUT",
      Buffer.from("<svg></svg>"),
      cookie,
      gym,
      "image/png",
    ),
    400,
  );
  const newCredential = ok(
    await req(`/members/${id}/credential`, "POST"),
    201,
  ).credential;
  ok(await lookup(credential), 404);
  assert.equal(ok(await lookup(newCredential)).allowed, true);
  const sub = (
    await db.query(
      "SELECT * FROM subscriptions WHERE member_id=$1 AND cancelled_at IS NULL",
      [id],
    )
  ).rows[0];
  await db.query(
    "UPDATE subscriptions SET starts_on=$2,ends_on=$3 WHERE id=$1",
    [sub.id, addDays(today(), -30), today()],
  );
  assert.equal(ok(await lookup(newCredential)).allowed, false);
  await db.query(
    "UPDATE subscriptions SET starts_on=$2,ends_on=$3 WHERE id=$1",
    [sub.id, sub.starts_on, sub.ends_on],
  );
  const payment = ok(await req("/payments")).find(
    (p: any) => p.order_id === charge.id,
  );
  ok(
    await req(`/movements/payment/${payment.id}/void`, "POST", {
      reason: "Cobro incorrecto",
    }),
  );
  assert.equal(ok(await lookup(newCredential)).allowed, false);
  const report = ok(await req(`/reports?from=${today()}&to=${today()}`));
  assert.equal(
    report.attendance.find((a: any) => a.activity === "Musculación").visits,
    1,
  );
  assert.equal(
    report.attendance.some((a: any) => a.activity === "Yoga"),
    false,
  );
  ok(await req(`/members/${id}/credential`, "DELETE"), 204);
  ok(await lookup(newCredential), 404);
  ok(
    await req(`/members/${id}`, "PUT", {
      name: "Socio corregido",
      document: "90000066",
      phone: "1155554444",
      plan_ids: [plan, yoga],
    }),
  );
  ok(await lookup("90000006"), 404);
  assert.equal(ok(await lookup("90000066")).member.id, id);
  assert.equal(
    (
      await db.query(
        "SELECT id FROM audit_logs WHERE action='member.document_changed' AND gym_id=$1",
        [gym],
      )
    ).rows.length,
    1,
  );
});
test("arqueo: saldo inicial, diferencias, concurrencia, cambios posteriores y revisiones inmutables", async () => {
  const day = addDays(today(), -10),
    snap = ok(await req(`/cash-counts?day=${day}`));
  const b = {
    day,
    opening_cents: 10000,
    movements_hash: snap.movements_hash,
    counts: snap.rows.map((r: any) => ({ key: r.key, counted_cents: 10000 })),
    reason: "",
    request_key: randomUUID(),
  };
  const r = ok(await req("/cash-counts", "POST", b), 201);
  assert.equal(r.rows[0].difference_cents, 0);
  assert.equal(ok(await req("/cash-counts", "POST", b), 201).id, r.id);
  ok(
    await req("/cash-counts", "POST", {
      ...b,
      request_key: randomUUID(),
      counts: b.counts.map((c: any) => ({ ...c, counted_cents: 9000 })),
    }),
    400,
  );
  const diff = ok(
    await req("/cash-counts", "POST", {
      ...b,
      request_key: randomUUID(),
      counts: b.counts.map((c: any) => ({ ...c, counted_cents: 9000 })),
      reason: "Faltan 10 pesos",
    }),
    201,
  );
  assert.equal(diff.rows[0].difference_cents, -1000);
  await db.query(
    "INSERT INTO expenses(id,gym_id,description,amount_cents,method,created_by,created_at) SELECT $1,$2,'Gasto posterior',10,'cash',id,$3::date + interval '12 hours' FROM users WHERE account_id=$4 AND role='owner' LIMIT 1",
    [randomUUID(), gym, day, account],
  );
  ok(
    await req("/cash-counts", "POST", { ...b, request_key: randomUUID() }),
    409,
  );
  const after = ok(await req(`/cash-counts?day=${day}`));
  assert.notEqual(after.movements_hash, r.movements_hash);
  assert.equal(after.history.length, 2);
  ok(await req("/cash-counts", "POST", b, receptionCookie), 403);
});
test("Excel conserva columnas, descuentos exactos, filtros y strings sin fórmulas; 500 pases mensuales", async () => {
  const id = await member("90000007"),
    promo = ok(
      await req("/promotions", "POST", {
        name: "Gym + Yoga",
        kind: "combo",
        discount_type: "fixed",
        value: 10000,
        plan_ids: [plan, yoga],
        member_ids: [id],
      }),
    );
  ok(
    await req(
      "/payments",
      "POST",
      order(id, { plan_ids: [plan, yoga], promotion_id: promo.id }),
    ),
    201,
  );
  ok(
    await req(`/members/${id}`, "PUT", {
      name: "=1+1",
      document: "90000007",
      phone: "1155554444",
      plan_ids: [plan, yoga],
    }),
  );
  // Generate a realistic monthly ledger without hundreds of redundant HTTP setups.
  await db.query(
    `INSERT INTO payments(id,member_id,subscription_id,amount_cents,discount_cents,method,created_by,gym_id,activity_snapshot,plan_snapshot,method_name,request_key) SELECT 'load-'||n,$1,s.id,100,0,'cash',u.id,$2,'Musculación','Pase gym','Efectivo','load-key-'||n FROM generate_series(1,500) n CROSS JOIN LATERAL (SELECT id FROM subscriptions WHERE member_id=$1 LIMIT 1) s CROSS JOIN LATERAL (SELECT id FROM users WHERE account_id=$3 AND role='owner' LIMIT 1) u`,
    [id, gym, account],
  );
  const x = await req(
    `/payments/export.xlsx?from=${today()}&to=${today()}&q=90000007`,
  );
  ok(x);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(x.data);
  const s = book.worksheets[0];
  assert.deepEqual((s.getRow(1).values as any[]).slice(1), [
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
  const page1 = ok(
      await req(
        `/payments/history?from=${today()}&to=${today()}&q=90000007&page=1`,
      ),
    ),
    page2 = ok(
      await req(
        `/payments/history?from=${today()}&to=${today()}&q=90000007&page=2`,
      ),
    );
  assert.equal(ok(await req("/payments?limit=100")).length, 100);
  assert.equal(ok(await req(`/payments?member_id=${id}`)).length, 502);
  assert.equal(page1.total, 502);
  assert.equal(page1.rows.length, 50);
  assert.equal(page2.rows.length, 50);
  assert.equal(
    new Set([...page1.rows, ...page2.rows].map((r: any) => r.id)).size,
    100,
  );
  assert.equal(s.rowCount, 503);
  assert.equal(s.getRow(2).getCell(3).type, ExcelJS.ValueType.String);
  assert.equal(s.getRow(2).getCell(2).type, ExcelJS.ValueType.String);
  assert.equal(s.getRow(2).getCell(2).value, "=1+1");
  const total = s
    .getColumn(6)
    .values.slice(2)
    .reduce((n: any, v: any) => n + (typeof v === "number" ? v : 0), 0);
  assert.ok(
    Math.abs(Number(total) - (500001 + 200000 - 10000 + 50000) / 100) <
      0.000001,
  );
  const filtered = await req(
    `/payments/export.xlsx?from=${today()}&to=${today()}&q=90000007&method_name=Efectivo`,
  );
  const b2 = new ExcelJS.Workbook();
  await b2.xlsx.load(ok(filtered));
  assert.equal(b2.worksheets[0].rowCount, 501);
});
test("respaldo v5 restaura fotos, medios, pendientes, ingresos y arqueos sin perder datos", async () => {
  const service = createBackupService(db, temp),
    run = await service.create(account),
    bytes = await service.download(account, run.id);
  const fresh = await connectDatabase(undefined, true);
  try {
    await restoreAccount(fresh, bytes);
    for (const t of [
      "payment_methods",
      "member_photos",
      "access_credentials",
      "pending_payments",
      "checkins",
      "cash_counts",
    ]) {
      const a = await db.query(`SELECT count(*) n FROM ${t} WHERE gym_id=$1`, [
          gym,
        ]),
        b = await fresh.query(`SELECT count(*) n FROM ${t} WHERE gym_id=$1`, [
          gym,
        ]);
      assert.equal(b.rows[0].n, a.rows[0].n);
    }
  } finally {
    await fresh.close();
  }
});
