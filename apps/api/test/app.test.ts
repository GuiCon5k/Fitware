import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import {
  connectDatabase,
  migrate,
  migrateV1,
  migrateV2,
  type Database,
} from "../src/db.js";
import { createApp } from "../src/app.js";
import { seed } from "../src/seed.js";
import { hashPassword } from "../src/security.js";
import { nextMonth, today, addDays, dateText } from "../src/dates.js";
import { applyProviderPayment, checkout } from "../src/billing.js";
let db: Database,
  server: Server,
  base: string,
  ownerCookie = "",
  gymId = "",
  otherCookie = "",
  otherGym = "",
  secondGym = "",
  staffCookie = "",
  trainerCookie = "",
  memberId = "",
  partnerId = "",
  planId = "",
  secondPlan = "",
  promoId = "",
  productId = "";
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = ownerCookie,
  gym = gymId,
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-fitware-client": "web",
      ...(cookie ? { cookie } : {}),
      ...(gym ? { "x-gym-id": gym } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}
async function login(email: string, password = "SeguraLocal2026!") {
  const r = await request("/auth/login", "POST", { email, password }, "");
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  return r.response.headers.get("set-cookie")!.split(";")[0];
}
const order = (extra: Record<string, unknown> = {}) => ({
  member_id: memberId,
  plan_ids: [planId],
  method: "cash",
  request_key: randomUUID(),
  ...extra,
});
before(async () => {
  delete process.env.DATABASE_URL;
  process.env.ADMIN_EMAIL = "owner@test.com";
  process.env.ADMIN_PASSWORD = "SeguraLocal2026!";
  process.env.RECEPTION_EMAIL = "reception@test.com";
  process.env.RECEPTION_PASSWORD = "SeguraLocal2026!";
  process.env.SEED_DEMO = "false";
  process.env.REQUIRE_SUBSCRIPTION = "false";
  db = await connectDatabase(undefined, true);
  await migrate(db);
  await seed(db);
  server = createApp(db).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  ownerCookie = await login("owner@test.com");
  gymId = (await request("/gyms")).data[0].id;
});
after(async () => {
  server?.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
});
test("mes calendario mantiene el ancla, años bisiestos y diciembre", () => {
  assert.equal(nextMonth("2026-01-01"), "2026-02-01");
  assert.equal(nextMonth("2026-01-31", 31), "2026-02-28");
  assert.equal(nextMonth("2026-02-28", 31), "2026-03-31");
  assert.equal(nextMonth("2028-01-31", 31), "2028-02-29");
  assert.equal(nextMonth("2026-12-31", 31), "2027-01-31");
});
test("migración conserva usuarios, socios, pagos y días personalizados de v1", async () => {
  const old = await connectDatabase(undefined, true);
  try {
    await migrateV1(old);
    await old.query("INSERT INTO users VALUES($1,$2,$3,$4,$5)", [
      "u",
      "Dueño",
      "old@test.com",
      hashPassword("SeguraLocal2026!"),
      "owner",
    ]);
    await old.query(
      "INSERT INTO members(id,name,document) VALUES('m','Socio previo','12345678')",
    );
    await old.query(
      "INSERT INTO plans VALUES('p','Semanal','Gym',100000,7,true)",
    );
    await old.query(
      "INSERT INTO subscriptions VALUES('s','m','p','2026-01-01','2026-01-08')",
    );
    await old.query(
      "INSERT INTO payments(id,member_id,subscription_id,amount_cents,discount_cents,method,created_by,request_key) VALUES('pay','m','s',100000,0,'cash','u','old-request')",
    );
    await migrate(old);
    await migrate(old);
    assert.equal(
      (await old.query("SELECT * FROM members WHERE id='m'")).rows[0].gym_id,
      "legacy-gym",
    );
    assert.equal(
      (await old.query("SELECT * FROM plans WHERE id='p'")).rows[0]
        .duration_unit,
      "days",
    );
    assert.equal(
      (await old.query("SELECT * FROM payments WHERE id='pay'")).rows[0]
        .amount_cents,
      100000,
    );
    assert.equal(
      dateText(
        (await old.query("SELECT * FROM subscriptions WHERE id='s'")).rows[0]
          .ends_on,
      ),
      "2026-01-08",
    );
  } finally {
    await old.close();
  }
});
test("autenticación, CSRF y registro aislado por organización", async () => {
  assert.equal(
    (await request("/gyms", "GET", undefined, "")).response.status,
    401,
  );
  const r = await fetch(base + "/gyms", {
    method: "POST",
    headers: {
      origin: "https://otro.example",
      "x-fitware-client": "web",
      "content-type": "application/json",
      cookie: ownerCookie,
    },
    body: "{}",
  });
  assert.equal(r.status, 403);
  const reg = await request(
    "/auth/register",
    "POST",
    {
      name: "Otra dueña",
      email: "other@test.com",
      password: "SeguraLocal2026!",
      business_name: "Otra organización",
      gym_name: "Otra sede",
    },
    "",
  );
  assert.equal(reg.response.status, 201, JSON.stringify(reg.data));
  otherCookie = reg.response.headers.get("set-cookie")!.split(";")[0];
  otherGym = (await request("/gyms", "GET", undefined, otherCookie)).data[0].id;
  assert.notEqual(otherGym, gymId);
  assert.equal(
    (await request("/members", "GET", undefined, otherCookie, gymId)).response
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "/auth/register",
        "POST",
        {
          name: "Duplicado",
          email: "other@test.com",
          password: "SeguraLocal2026!",
          business_name: "Empresa",
          gym_name: "Gym",
        },
        "",
      )
    ).response.status,
    409,
  );
});
test("planes mensuales por defecto y alta de socios con múltiples actividades y emergencia", async () => {
  const p = await request("/plans", "POST", {
    name: "Mensual",
    activity: "Musculación",
    price_cents: 3500000,
  });
  assert.equal(p.response.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.duration_unit, "month");
  planId = p.data.id;
  secondPlan = (
    await request("/plans", "POST", {
      name: "Pilates",
      activity: "Pilates",
      price_cents: 4500000,
    })
  ).data.id;
  const m = await request("/members", "POST", {
    name: "Persona Uno",
    document: "40001234",
    address: "Dirección ficticia",
    emergency_name: "Contacto ficticio",
    emergency_phone: "1111111111",
    plan_ids: [planId, secondPlan],
  });
  assert.equal(m.response.status, 201, JSON.stringify(m.data));
  memberId = m.data.id;
  partnerId = (
    await request("/members", "POST", {
      name: "Persona Dos",
      document: "40001235",
    })
  ).data.id;
  const member = (await request("/members")).data.find(
    (v: any) => v.id === memberId,
  );
  assert.equal(member.plan_ids.length, 2);
  assert.equal(member.address, "Dirección ficticia");
  assert.equal(member.emergency_name, "Contacto ficticio");
  assert.equal(member.subscriptions.length, 0);
  assert.equal(
    (await request("/members", "POST", { name: "Dup", document: "40001234" }))
      .response.status,
    409,
  );
});
test("multi gimnasio: mismo documento permitido, cobros cruzados rechazados", async () => {
  secondGym = (await request("/gyms", "POST", { name: "Segunda sede" })).data
    .id;
  assert.equal((await request("/gyms")).data.length, 2);
  assert.equal(
    (await request("/members", "GET", undefined, ownerCookie, secondGym)).data
      .length,
    0,
  );
  assert.equal(
    (
      await request(
        "/members",
        "POST",
        { name: "Mismo DNI en otra sede", document: "40001234" },
        ownerCookie,
        secondGym,
      )
    ).response.status,
    201,
  );
  assert.equal(
    (await request("/payments", "POST", order(), ownerCookie, secondGym))
      .response.status,
    404,
  );
  assert.equal(
    (
      await request(
        "/members",
        "PUT",
        { name: "Intruso", document: "40001234" },
        ownerCookie,
        otherGym,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        "/members/" + memberId,
        "PUT",
        { name: "Intruso", document: "40001234" },
        ownerCookie,
        secondGym,
      )
    ).response.status,
    404,
  );
});
test("empleados: entrenador limitado, permisos personalizables y sedes asignadas", async () => {
  const r = await request("/staff", "POST", {
    name: "Entrenador",
    email: "trainer@test.com",
    role: "trainer",
    password: "SeguraLocal2026!",
    gym_ids: [gymId],
    permissions: ["members.read", "plans.read"],
  });
  assert.equal(r.response.status, 201, JSON.stringify(r.data));
  trainerCookie = await login("trainer@test.com");
  assert.equal(
    (await request("/members", "GET", undefined, trainerCookie)).response
      .status,
    200,
  );
  assert.equal(
    (await request("/payments", "POST", order(), trainerCookie)).response
      .status,
    403,
  );
  assert.equal(
    (await request("/reports", "GET", undefined, trainerCookie)).response
      .status,
    403,
  );
  assert.equal(
    (await request("/members", "GET", undefined, trainerCookie, secondGym))
      .response.status,
    403,
  );
  const staff = await request("/staff", "POST", {
    name: "Recepción personalizada",
    email: "staff@test.com",
    role: "receptionist",
    password: "SeguraLocal2026!",
    gym_ids: [gymId],
    permissions: [
      "members.write",
      "payments.write",
      "payments.read",
      "sales.write",
    ],
  });
  assert.equal(staff.response.status, 201);
  staffCookie = await login("staff@test.com");
  assert.equal(
    (await request("/plans", "GET", undefined, staffCookie)).response.status,
    200,
  );
  assert.equal(
    (await request("/staff", "GET", undefined, staffCookie)).response.status,
    403,
  );
  assert.equal(
    (
      await request(
        "/plans",
        "POST",
        { name: "No", activity: "Gym", price_cents: 100000 },
        staffCookie,
      )
    ).response.status,
    403,
  );
});
test("cobro mensual, validación de total, idempotencia y renovación anticipada", async () => {
  const b = order();
  const q = await request("/payments/quote", "POST", b);
  assert.equal(q.data.total_cents, 3500000);
  const changed = await request("/payments", "POST", {
    ...b,
    expected_total_cents: 1,
  });
  assert.equal(changed.response.status, 409);
  assert.equal((await db.query("SELECT * FROM subscriptions")).rows.length, 0);
  const p = await request("/payments", "POST", b);
  assert.equal(p.response.status, 201, JSON.stringify(p.data));
  assert.equal(p.data.amount_cents, 3500000);
  assert.equal((await request("/payments", "POST", b)).data.id, p.data.id);
  assert.equal(
    (await request("/payments", "POST", { ...b, method: "transfer" })).response
      .status,
    409,
  );
  const first = (
    await db.query("SELECT * FROM subscriptions WHERE member_id=$1", [memberId])
  ).rows[0];
  assert.equal(dateText(first.ends_on), nextMonth(today()));
  await request("/payments", "POST", order());
  const subs = (
    await db.query(
      "SELECT * FROM subscriptions WHERE member_id=$1 ORDER BY starts_on",
      [memberId],
    )
  ).rows;
  assert.equal(subs.length, 2);
  assert.equal(dateText(subs[1].starts_on), dateText(first.ends_on));
  assert.equal(
    dateText(subs[1].ends_on),
    nextMonth(dateText(first.ends_on), first.anchor_day),
  );
});
test("promoción 2x1 asocia dos socios, reparte centavos y evita cobros entre sedes", async () => {
  promoId = (
    await request("/promotions", "POST", {
      name: "Venís con alguien",
      kind: "two_for_one",
      discount_type: "percent",
      value: 0,
      plan_ids: [planId],
    })
  ).data.id;
  const b = order({ promotion_id: promoId, partner_id: partnerId });
  const q = await request("/payments/quote", "POST", b);
  assert.equal(q.data.total_cents, 3500000);
  assert.equal(q.data.lines.length, 2);
  const p = await request("/payments", "POST", b);
  assert.equal(p.response.status, 201);
  const rows = (
    await db.query("SELECT * FROM payments WHERE order_id=$1", [p.data.id])
  ).rows;
  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((s, p) => s + p.amount_cents, 0),
    3500000,
  );
  assert.equal(
    rows.reduce((s, p) => s + p.discount_cents, 0),
    3500000,
  );
  assert.equal(
    (
      await request(
        "/payments",
        "POST",
        order({ promotion_id: promoId, partner_id: memberId }),
      )
    ).response.status,
    400,
  );
  const other = (
    await request("/members", "GET", undefined, ownerCookie, secondGym)
  ).data[0];
  assert.equal(
    (
      await request(
        "/payments",
        "POST",
        order({ promotion_id: promoId, partner_id: other.id }),
      )
    ).response.status,
    400,
  );
});
test("combo configurable aplica descuento exacto y una promoción no válida revierte todo", async () => {
  const promo = (
    await request("/promotions", "POST", {
      name: "Gym + Pilates",
      kind: "combo",
      discount_type: "percent",
      value: 25,
      plan_ids: [planId, secondPlan],
    })
  ).data.id;
  const q = await request(
    "/payments/quote",
    "POST",
    order({ plan_ids: [planId, secondPlan], promotion_id: promo }),
  );
  assert.equal(q.data.total_cents, 6000000);
  assert.equal(
    (
      await request(
        "/payments",
        "POST",
        order({ plan_ids: [planId, secondPlan], promotion_id: promo }),
      )
    ).response.status,
    201,
  );
  const before = (await db.query("SELECT * FROM subscriptions")).rows.length;
  assert.equal(
    (await request("/payments", "POST", order({ promotion_id: promo })))
      .response.status,
    400,
  );
  assert.equal(
    (await db.query("SELECT * FROM subscriptions")).rows.length,
    before,
  );
  assert.equal(
    (
      await request(
        "/payments",
        "POST",
        order({ discount_cents: 1 }),
        staffCookie,
      )
    ).response.status,
    403,
  );
  assert.equal(
    (await request("/payments", "POST", order({ discount_cents: 999999999 })))
      .response.status,
    400,
  );
});
test("consumibles: reposición, costo congelado, venta atómica y stock insuficiente", async () => {
  productId = (
    await request("/products", "POST", {
      name: "Agua",
      category: "Bebidas",
      price_cents: 200000,
      cost_cents: 100000,
    })
  ).data.id;
  assert.equal(
    (
      await request("/products/" + productId + "/restock", "POST", {
        quantity: 5,
        unit_cost_cents: 100000,
        method: "cash",
        record_expense: true,
        request_key: randomUUID(),
      })
    ).response.status,
    204,
  );
  const b = {
    product_id: productId,
    quantity: 2,
    method: "cash",
    request_key: randomUUID(),
  };
  const sale = await request("/sales", "POST", b, staffCookie);
  assert.equal(sale.response.status, 201, JSON.stringify(sale.data));
  assert.equal(sale.data.amount_cents, 400000);
  assert.equal(sale.data.cost_cents, undefined);
  assert.equal(
    (await db.query("SELECT cost_cents FROM sales WHERE id=$1", [sale.data.id]))
      .rows[0].cost_cents,
    200000,
  );
  assert.equal(
    (await request("/sales", "POST", b, staffCookie)).data.id,
    sale.data.id,
  );
  assert.equal((await request("/products")).data[0].stock, 3);
  assert.equal(
    (
      await request(
        "/sales",
        "POST",
        { ...b, quantity: 4, request_key: randomUUID() },
        staffCookie,
      )
    ).response.status,
    400,
  );
  assert.equal((await request("/products")).data[0].stock, 3);
  assert.equal(
    (await request("/products", "GET", undefined, staffCookie)).data[0]
      .cost_cents,
    undefined,
  );
  assert.equal(
    (
      await request(
        "/sales",
        "POST",
        { ...b, request_key: randomUUID() },
        ownerCookie,
        secondGym,
      )
    ).response.status,
    404,
  );
});
test("reportes cuadran con cuotas, ventas, egresos y consolidado sin mezclar cuentas", async () => {
  await request("/expenses", "POST", {
    description: "Limpieza",
    category: "Operativos",
    amount_cents: 100000,
    method: "cash",
  });
  const r = await request("/reports");
  assert.equal(r.response.status, 200, JSON.stringify(r.data));
  const sum = (
    await db.query(
      "SELECT COALESCE(sum(amount_cents),0) total FROM payments WHERE gym_id=$1",
      [gymId],
    )
  ).rows[0].total;
  assert.equal(r.data.income_cents, Number(sum) + 400000);
  assert.equal(r.data.expense_cents, 600000);
  assert.equal(r.data.balance_cents, r.data.income_cents - 600000);
  assert.equal(r.data.cost_of_sales_cents, 200000);
  assert.equal(
    r.data.rows.reduce((s: number, g: any) => s + g.income_cents, 0),
    r.data.income_cents,
  );
  assert.equal(
    r.data.rows.find((g: any) => g.name === "Musculación").active_members,
    2,
  );
  const all = await request("/reports?scope=all");
  assert.equal(all.data.income_cents, r.data.income_cents);
  assert.equal(
    (await request("/reports?scope=all", "GET", undefined, staffCookie))
      .response.status,
    403,
  );
  assert.equal(
    (await request("/reports", "GET", undefined, otherCookie, otherGym)).data
      .income_cents,
    0,
  );
  assert.equal(
    (await request("/reports?from=2026-12-10&to=2026-01-01")).response.status,
    400,
  );
});
test("perfil personal y bloqueo por suscripción vencida con renovación todavía accesible", async () => {
  assert.equal(
    (
      await request(
        "/profile",
        "PUT",
        { name: "Nombre nuevo", phone: "1111", address: "Dirección" },
        trainerCookie,
      )
    ).response.status,
    200,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, trainerCookie)).data.name,
    "Nombre nuevo",
  );
  await db.query(
    "UPDATE accounts SET trial_until='2020-01-01',paid_until=NULL WHERE id='legacy-account'",
  );
  process.env.REQUIRE_SUBSCRIPTION = "true";
  assert.equal((await request("/members")).response.status, 402);
  assert.equal((await request("/billing")).response.status, 200);
  assert.equal(
    (await request("/profile", "PUT", { name: "Administrador" })).response
      .status,
    200,
  );
  assert.equal(
    (await request("/billing/checkout", "POST", { quote_id: randomUUID() }))
      .response.status,
    503,
  );
  assert.equal(
    (await request("/billing/webhook?data.id=1", "POST", {})).response.status,
    503,
  );
  process.env.REQUIRE_SUBSCRIPTION = "false";
});
test("habilitación del servicio exige importe y receptor, no se duplica y reacciona a reembolso", async () => {
  process.env.MP_COLLECTOR_ID = "123";
  const account = "legacy-account",
    id = randomUUID();
  await db.query(
    "INSERT INTO billing_orders(id,account_id,amount_cents) VALUES($1,$2,1000000)",
    [id, account],
  );
  const payment = {
    id: 888,
    external_reference: id,
    transaction_amount: 10000,
    currency_id: "ARS",
    collector_id: 123,
    status: "approved",
    live_mode: true,
  };
  await assert.rejects(() =>
    applyProviderPayment(db, { ...payment, transaction_amount: 1 }),
  );
  await assert.rejects(() =>
    applyProviderPayment(db, { ...payment, collector_id: 999 }),
  );
  assert.equal(
    (await db.query("SELECT * FROM billing_receipts")).rows.length,
    0,
  );
  await applyProviderPayment(db, payment);
  await applyProviderPayment(db, payment);
  assert.equal(
    (await db.query("SELECT * FROM billing_receipts")).rows.length,
    1,
  );
  assert.equal((await request("/billing")).data.active, true);
  await applyProviderPayment(db, { ...payment, status: "refunded" });
  assert.equal((await request("/billing")).data.active, false);
});

test("reposiciones idempotentes y costo promedio ponderado conservan el stock", async () => {
  const p = (
    await request("/products", "POST", {
      name: "Snack de prueba",
      category: "Snacks",
      price_cents: 30000,
      cost_cents: 10000,
    })
  ).data.id;
  const first = {
    quantity: 2,
    unit_cost_cents: 10000,
    method: "cash",
    record_expense: false,
    request_key: randomUUID(),
  };
  assert.equal(
    (await request("/products/" + p + "/restock", "POST", first)).response
      .status,
    204,
  );
  assert.equal(
    (await request("/products/" + p + "/restock", "POST", first)).response
      .status,
    204,
  );
  const second = {
    ...first,
    quantity: 2,
    unit_cost_cents: 20000,
    request_key: randomUUID(),
  };
  await request("/products/" + p + "/restock", "POST", second);
  const product = (await request("/products")).data.find(
    (x: any) => x.id === p,
  );
  assert.equal(product.stock, 4);
  assert.equal(product.cost_cents, 15000);
  const sold = await request("/sales", "POST", {
    product_id: p,
    quantity: 3,
    method: "cash",
    request_key: randomUUID(),
  });
  assert.equal(sold.data.cost_cents, 45000);
  assert.equal(
    (
      await request("/products/" + p + "/restock", "POST", {
        ...first,
        quantity: 3,
      })
    ).response.status,
    409,
  );
});

test("dos ventas concurrentes no pueden agotar más stock del disponible", async () => {
  const p = (
    await request("/products", "POST", {
      name: "Última bebida",
      category: "Bebidas",
      price_cents: 10000,
      cost_cents: 5000,
    })
  ).data.id;
  await request("/products/" + p + "/restock", "POST", {
    quantity: 2,
    unit_cost_cents: 5000,
    method: "cash",
    record_expense: false,
    request_key: randomUUID(),
  });
  const sale = () =>
    request("/sales", "POST", {
      product_id: p,
      quantity: 2,
      method: "cash",
      request_key: randomUUID(),
    });
  const result = await Promise.all([sale(), sale()]);
  assert.deepEqual(result.map((r) => r.response.status).sort(), [201, 400]);
  assert.equal(
    (await request("/products")).data.find((x: any) => x.id === p).stock,
    0,
  );
});

test("deshabilitar un empleado revoca su sesión y no permite cambiar al dueño", async () => {
  const staff = (await request("/staff")).data.find(
    (s: any) => s.email === "staff@test.com",
  );
  const r = await request("/staff/" + staff.id, "PUT", {
    ...staff,
    active: false,
  });
  assert.equal(r.response.status, 200);
  assert.equal(
    (await request("/auth/me", "GET", undefined, staffCookie)).response.status,
    401,
  );
  const own = (await request("/auth/me")).data.id;
  assert.equal(
    (await request("/staff/" + own, "PUT", { ...staff, active: true })).response
      .status,
    404,
  );
});

test("cambiar mi contraseña conserva la sesión actual y cierra las demás", async () => {
  const second = await login("trainer@test.com");
  assert.equal(
    (
      await request(
        "/profile/password",
        "POST",
        {
          current_password: "SeguraLocal2026!",
          new_password: "NuevaClaveSegura2026!",
        },
        trainerCookie,
      )
    ).response.status,
    204,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, trainerCookie)).response
      .status,
    200,
  );
  assert.equal(
    (await request("/auth/me", "GET", undefined, second)).response.status,
    401,
  );
  assert.equal(
    (
      await request(
        "/auth/login",
        "POST",
        { email: "trainer@test.com", password: "SeguraLocal2026!" },
        "",
      )
    ).response.status,
    401,
  );
  assert.equal(
    (
      await request(
        "/auth/login",
        "POST",
        { email: "trainer@test.com", password: "NuevaClaveSegura2026!" },
        "",
      )
    ).response.status,
    200,
  );
});

test("webhook configurado rechaza firma ausente antes de consultar al proveedor", async () => {
  process.env.MP_ACCESS_TOKEN = "token-de-prueba-no-real";
  process.env.MP_WEBHOOK_SECRET = "firma-de-prueba";
  process.env.SERVICE_MONTHLY_CENTS = "1000000";
  process.env.PUBLIC_URL = "https://fitware.example";
  assert.equal(
    (await request("/billing/webhook?data.id=123", "POST", {})).response.status,
    401,
  );
  delete process.env.MP_ACCESS_TOKEN;
  delete process.env.MP_WEBHOOK_SECRET;
  delete process.env.PUBLIC_URL;
  delete process.env.SERVICE_MONTHLY_CENTS;
});

test("un reembolso del período actual no habilita el servicio por un recibo de un mes futuro", async () => {
  const account = randomUUID();
  await db.query("INSERT INTO accounts(id,name,trial_until) VALUES($1,$2,$3)", [
    account,
    "Cuenta de prueba",
    "2020-01-01",
  ]);
  const first = randomUUID(),
    second = randomUUID();
  await db.query(
    "INSERT INTO billing_orders(id,account_id,amount_cents) VALUES($1,$2,1000000)",
    [first, account],
  );
  await db.query(
    "INSERT INTO billing_orders(id,account_id,amount_cents) VALUES($1,$2,1000000)",
    [second, account],
  );
  const payment = {
    id: "9001",
    external_reference: first,
    transaction_amount: 10000,
    currency_id: "ARS",
    collector_id: 123,
    status: "approved",
    live_mode: true,
  };
  await Promise.all([
    applyProviderPayment(db, payment),
    applyProviderPayment(db, { ...payment, id: "9002" }),
  ]);
  assert.equal(
    (
      await db.query("SELECT * FROM billing_receipts WHERE account_id=$1", [
        account,
      ])
    ).rows.length,
    1,
  );
  await applyProviderPayment(db, {
    ...payment,
    id: "9003",
    external_reference: second,
  });
  const before = (
    await db.query("SELECT * FROM billing_receipts WHERE account_id=$1", [
      account,
    ])
  ).rows;
  assert.equal(before.length, 2);
  await applyProviderPayment(db, { ...payment, status: "refunded" });
  const { billingStatus } = await import("../src/billing.js");
  assert.equal((await billingStatus(db, account)).active, false);
});

afterEach(() => {
  process.env.REQUIRE_SUBSCRIPTION = "false";
});

test("2x1 específico guarda dos socios y una actividad; no se puede aplicar a otros", async () => {
  const b = {
    name: "2x1 de socios concretos",
    kind: "two_for_one",
    discount_type: "percent",
    value: 0,
    plan_ids: [planId],
    member_ids: [memberId, partnerId],
  };
  const saved = await request("/promotions", "POST", b);
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  const stored = (await request("/promotions")).data.find(
    (p: any) => p.id === saved.data.id,
  );
  assert.equal(stored.beneficiaries.length, 2);
  assert.deepEqual(stored.member_ids, [memberId, partnerId]);
  assert.equal(
    (
      await request(
        "/payments/quote",
        "POST",
        order({ promotion_id: saved.data.id, partner_id: partnerId }),
      )
    ).data.total_cents,
    3500000,
  );
  const third = (
    await request("/members", "POST", {
      name: "Tercer socio",
      document: "48888888",
    })
  ).data.id;
  assert.equal(
    (
      await request(
        "/payments/quote",
        "POST",
        order({ promotion_id: saved.data.id, partner_id: third }),
      )
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request("/promotions", "POST", {
        ...b,
        member_ids: [memberId, memberId],
      })
    ).response.status,
    400,
  );
  assert.equal(
    (await request("/promotions", "POST", { ...b, plan_ids: [] })).response
      .status,
    400,
  );
});

test("combo específico requiere un socio y varias actividades diferentes", async () => {
  const saved = await request("/promotions", "POST", {
    name: "Combo personal",
    kind: "combo",
    discount_type: "percent",
    value: 20,
    plan_ids: [planId, secondPlan],
    member_ids: [memberId],
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.data));
  assert.equal(
    (
      await request(
        "/payments/quote",
        "POST",
        order({ promotion_id: saved.data.id, plan_ids: [planId, secondPlan] }),
      )
    ).data.total_cents,
    6400000,
  );
  assert.equal(
    (
      await request(
        "/payments/quote",
        "POST",
        order({
          member_id: partnerId,
          promotion_id: saved.data.id,
          plan_ids: [planId, secondPlan],
        }),
      )
    ).response.status,
    400,
  );
  const sameActivity = (
    await request("/plans", "POST", {
      name: "Otro pase de musculación",
      activity: "Musculación",
      price_cents: 100000,
    })
  ).data.id;
  assert.equal(
    (
      await request("/promotions", "POST", {
        name: "Combo inválido",
        kind: "combo",
        discount_type: "percent",
        value: 10,
        plan_ids: [planId, sameActivity],
        member_ids: [memberId],
      })
    ).response.status,
    400,
  );
});

test("stock inicial y ajustes conservan un historial sin duplicar egresos", async () => {
  const b = {
    name: "Producto con stock",
    category: "Snacks",
    price_cents: 20000,
    cost_cents: 10000,
    stock: 7,
    record_stock_expense: true,
    method: "cash",
    request_key: randomUUID(),
  };
  const first = await request("/products", "POST", b);
  assert.equal(first.response.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.stock, 7);
  assert.equal((await request("/products", "POST", b)).data.id, first.data.id);
  assert.equal(
    (
      await db.query("SELECT * FROM inventory_movements WHERE product_id=$1", [
        first.data.id,
      ])
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query("SELECT * FROM expenses WHERE description=$1", [
        "Compra inicial de stock: Producto con stock × 7",
      ])
    ).rows.length,
    1,
  );
  const edit = {
    ...b,
    record_stock_expense: false,
    stock: 5,
    expected_stock: 7,
    stock_reason: "Recuento: faltan dos unidades",
    request_key: randomUUID(),
  };
  assert.equal(
    (await request("/products/" + first.data.id, "PUT", edit)).data.stock,
    5,
  );
  assert.equal(
    (await request("/products/" + first.data.id, "PUT", edit)).data.stock,
    5,
  );
  assert.equal(
    (
      await db.query("SELECT * FROM inventory_movements WHERE product_id=$1", [
        first.data.id,
      ])
    ).rows.length,
    2,
  );
  assert.equal(
    (
      await request("/products/" + first.data.id, "PUT", {
        ...edit,
        stock: 99,
        request_key: randomUUID(),
      })
    ).response.status,
    409,
  );
  assert.equal(
    (
      await request("/products/" + first.data.id, "PUT", {
        ...edit,
        stock: 4,
        expected_stock: 5,
        stock_reason: "",
        request_key: randomUUID(),
      })
    ).response.status,
    400,
  );
  assert.equal(
    (
      await request("/products", "POST", {
        ...b,
        stock: -1,
        request_key: randomUUID(),
      })
    ).response.status,
    400,
  );
});

test("conversión USD 15 valida antigüedad, redondea a centavos y no usa un valor fijo en ARS", async () => {
  const { parseRate } = await import("../src/exchange.js");
  const now = Date.now(),
    body = {
      moneda: "USD",
      casa: "oficial",
      venta: 1000.005,
      fechaActualizacion: new Date(now).toISOString(),
    };
  assert.equal(parseRate(body, now).usd_cents, 1500);
  assert.equal(parseRate(body, now).ars_cents, 1500008);
  assert.equal(parseRate({ ...body, venta: 1200 }, now).ars_cents, 1800000);
  assert.throws(() => parseRate({ ...body, venta: 0 }, now));
  assert.throws(() =>
    parseRate(
      {
        ...body,
        fechaActualizacion: new Date(now - 97 * 3600000).toISOString(),
      },
      now,
    ),
  );
  assert.throws(() =>
    parseRate(
      { ...body, fechaActualizacion: new Date(now + 10 * 60000).toISOString() },
      now,
    ),
  );
});

test("cotizaciones guardadas mantienen cuenta, importe y fecha; la falta de fuente no genera una", async () => {
  const { createServiceQuote } = await import("../src/exchange.js");
  const fake = async () =>
    new Response(
      JSON.stringify({
        moneda: "USD",
        casa: "oficial",
        venta: 1200,
        fechaActualizacion: new Date().toISOString(),
      }),
      { status: 200 },
    );
  const quote = await createServiceQuote(db, "legacy-account", fake);
  assert.equal(quote.ars_cents, 1800000);
  assert.equal(quote.recipient.alias, "Guicon");
  assert.equal(quote.recipient.cvu, "0000003100084706675067");
  const stored = (
    await db.query("SELECT * FROM service_quotes WHERE id=$1", [quote.id])
  ).rows[0];
  assert.equal(stored.account_id, "legacy-account");
  assert.equal(stored.ars_cents, 1800000);
  assert.equal(stored.usd_cents, 1500);
  const count = (await db.query("SELECT * FROM service_quotes")).rows.length;
  await assert.rejects(() =>
    createServiceQuote(
      db,
      "legacy-account",
      async () => new Response("{}", { status: 503 }),
    ),
  );
  assert.equal(
    (await db.query("SELECT * FROM service_quotes")).rows.length,
    count,
  );
});

test("checkout usa el total convertido del servidor, rechaza otra cuenta y una cotización vencida", async (t) => {
  const { createServiceQuote } = await import("../src/exchange.js");
  const originalFetch = globalThis.fetch;
  process.env.MP_ACCESS_TOKEN = "token-de-prueba-no-real";
  process.env.MP_WEBHOOK_SECRET = "secreto-de-prueba";
  process.env.MP_COLLECTOR_ID = "123";
  process.env.PUBLIC_URL = "https://fitware.example";
  let sent: any = null,
    calls = 0;
  globalThis.fetch = (async (input: any, options?: RequestInit) => {
    if (String(input).startsWith("https://api.mercadopago.com/")) {
      calls++;
      sent = JSON.parse(String(options?.body));
      return new Response(
        JSON.stringify({
          id: "preference-test",
          init_point: "https://www.mercadopago.com.ar/checkout/test-only",
        }),
        { status: 200 },
      );
    }
    return originalFetch(input, options);
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MP_ACCESS_TOKEN;
    delete process.env.MP_WEBHOOK_SECRET;
    delete process.env.PUBLIC_URL;
  });
  const quote = await createServiceQuote(
    db,
    "legacy-account",
    async () =>
      new Response(
        JSON.stringify({
          moneda: "USD",
          casa: "oficial",
          venta: 1200,
          fechaActualizacion: new Date().toISOString(),
        }),
      ),
  );
  assert.equal(
    (
      await request(
        "/billing/checkout",
        "POST",
        { quote_id: quote.id },
        otherCookie,
        otherGym,
      )
    ).response.status,
    404,
  );
  const result = await request("/billing/checkout", "POST", {
    quote_id: quote.id,
    amount_cents: 1,
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.amount_cents, 1800000);
  assert.equal(sent.items[0].unit_price, 18000);
  assert.equal(sent.items[0].currency_id, "ARS");
  assert.equal(
    (await request("/billing/checkout", "POST", { quote_id: quote.id }))
      .response.status,
    200,
  );
  assert.equal(calls, 1);
  const order = (
    await db.query("SELECT * FROM billing_orders WHERE quote_id=$1", [quote.id])
  ).rows[0];
  assert.equal(order.recipient_alias, "Guicon");
  assert.equal(order.recipient_cvu, "0000003100084706675067");
  assert.equal(order.usd_cents, 1500);
  await db.query(
    "UPDATE service_quotes SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [quote.id],
  );
  assert.equal(
    (await request("/billing/checkout", "POST", { quote_id: quote.id }))
      .response.status,
    409,
  );
  assert.equal(calls, 1);
});

test("migración v2 a v2.1 conserva stock, ofertas y órdenes existentes", async () => {
  const old = await connectDatabase(undefined, true);
  try {
    await migrateV2(old);
    await old.query(
      "INSERT INTO products(id,gym_id,name,category,price_cents,cost_cents,stock) VALUES('old-product','legacy-gym','Agua','Bebidas',20000,10000,5)",
    );
    await old.query(
      "INSERT INTO promotions(id,gym_id,name,kind,discount_type,value) VALUES('old-promo','legacy-gym','Oferta anterior','discount','percent',10)",
    );
    await old.query(
      "INSERT INTO billing_orders(id,account_id,amount_cents) VALUES('old-order','legacy-account',2000000)",
    );
    await migrate(old);
    await migrate(old);
    assert.equal(
      (await old.query("SELECT * FROM products WHERE id='old-product'")).rows[0]
        .stock,
      5,
    );
    assert.deepEqual(
      (await old.query("SELECT * FROM promotions WHERE id='old-promo'")).rows[0]
        .member_ids,
      [],
    );
    assert.equal(
      (await old.query("SELECT * FROM billing_orders WHERE id='old-order'"))
        .rows[0].amount_cents,
      2000000,
    );
    assert.equal(
      (await old.query("SELECT version FROM schema_versions WHERE version=3"))
        .rows.length,
      1,
    );
  } finally {
    await old.close();
  }
});
