import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createBackupService } from "../src/backups.js";
import { addDays, today } from "../src/dates.js";
import { connectDatabase, migrate } from "../src/db.js";
import { demoAccountId, demoGymId, seedDemo } from "../src/demo.js";
import { tokenHash } from "../src/security.js";

test("panel privado, estado de clientes, activación de un solo uso y demo aislado", async () => {
  const db = await connectDatabase(undefined, true);
  const temp = await mkdtemp(join(tmpdir(), "fitware-platform-"));
  const server = createApp(db, {
    backups: createBackupService(db, temp),
  }).listen(0, "127.0.0.1");
  await new Promise<void>((done) => server.once("listening", done));
  const address = server.address();
  assert.ok(typeof address === "object" && address);
  const root = `http://127.0.0.1:${address.port}/api`;
  const previousInvite = process.env.PLATFORM_ADMIN_INVITE;
  delete process.env.PLATFORM_ADMIN_INVITE;

  const request = (
    path: string,
    body?: object,
    headers: Record<string, string> = {},
  ) =>
    fetch(root + path, {
      method: body ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        "x-fitware-client": "web",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const cookie = (response: Response) =>
    response.headers.get("set-cookie")!.split(";")[0];
  try {
    await migrate(db);
    await seedDemo(db);
    assert.deepEqual(await seedDemo(db), {
      socios: 10,
      actividades: 10,
      pagos: 30,
      egresos: 5,
    });
    assert.deepEqual(await (await request("/platform/me")).json(), {
      authenticated: false,
      setup: false,
    });
    assert.equal((await request("/platform/clients")).status, 401);
    const registered = await request("/auth/register", {
      name: "Dueña de prueba",
      email: "gimnasio@example.test",
      password: "ClaveGimnasio2026!",
      confirm_password: "ClaveGimnasio2026!",
      business_name: "Equipo de prueba",
      gym_name: "Sede Norte",
    });
    assert.equal(registered.status, 201);
    const normal = cookie(registered);
    const owner = await registered.json();
    await db.query(
      "UPDATE users SET phone='1100000000',address='Dirección ficticia' WHERE id=$1",
      [owner.id],
    );
    await db.query(
      "INSERT INTO gyms(id,account_id,name) VALUES('platform-test-south',$1,'Sede Sur')",
      [owner.account_id],
    );
    assert.equal(
      (
        await request("/platform/clients/" + owner.account_id, undefined, {
          cookie: normal,
        })
      ).status,
      401,
    );
    assert.equal(
      (await request("/platform/demo", {}, { cookie: normal })).status,
      401,
    );

    const token = randomBytes(32).toString("hex");
    const email = "operador@example.test";
    const password = "ClavePrivadaDePrueba!2026";
    const invite = (validFor: number) =>
      JSON.stringify({
        email,
        hash: tokenHash(token),
        expires: new Date(Date.now() + validFor).toISOString(),
      });
    const setup = { email, token, password, confirm_password: password };
    process.env.PLATFORM_ADMIN_INVITE = invite(-60000);
    assert.equal((await request("/platform/setup", setup)).status, 403);
    process.env.PLATFORM_ADMIN_INVITE = invite(60000);
    assert.deepEqual(await (await request("/platform/me")).json(), {
      authenticated: false,
      setup: true,
    });
    assert.equal(
      (await request("/platform/setup", { ...setup, token: "inválido" }))
        .status,
      403,
    );
    assert.equal(
      (await request("/platform/setup", { ...setup, email: owner.email }))
        .status,
      403,
    );
    const activation = await request("/platform/setup", setup);
    assert.equal(activation.status, 201);
    assert.match(
      activation.headers.get("set-cookie") || "",
      /Path=\/api\/platform.*HttpOnly.*SameSite=Strict/,
    );
    const admin = cookie(activation);
    assert.equal((await request("/platform/setup", setup)).status, 409);
    assert.deepEqual(await (await request("/platform/me")).json(), {
      authenticated: false,
      setup: false,
    });
    assert.equal(
      (await request("/auth/login", { email, password })).status,
      401,
    );
    assert.equal(
      (await request("/auth/me", undefined, { cookie: admin })).status,
      401,
    );
    const login = await request("/platform/login", { email, password });
    assert.equal(login.status, 200);

    const listing = await request(
      "/platform/clients?q=Sede%20Sur&status=active",
      undefined,
      { cookie: admin },
    );
    assert.equal(listing.status, 200);
    assert.equal(listing.headers.get("cache-control"), "no-store");
    const directory = await listing.json();
    assert.deepEqual(directory.summary, { clients: 1, active: 1, gyms: 2 });
    assert.equal(directory.demo, true);
    assert.equal(directory.clients[0].status, "trial");
    assert.equal(directory.clients[0].email, undefined);
    assert.equal(directory.clients[0].phone, undefined);
    const client = await (
      await request("/platform/clients/" + owner.account_id, undefined, {
        cookie: admin,
      })
    ).json();
    assert.equal(client.phone, "1100000000");
    assert.equal(client.address, "Dirección ficticia");
    assert.equal(client.email, owner.email);
    assert.equal(client.password_hash, undefined);
    assert.deepEqual(
      client.gyms.map((g: { name: string; status: string }) => [
        g.name,
        g.status,
      ]),
      [
        ["Sede Norte", "trial"],
        ["Sede Sur", "trial"],
      ],
    );
    assert.equal(
      (
        await request("/platform/clients/" + demoAccountId, undefined, {
          cookie: admin,
        })
      ).status,
      404,
    );
    await db.query("UPDATE accounts SET trial_until=$2 WHERE id=$1", [
      owner.account_id,
      addDays(today(), -1),
    ]);
    const inactive = await (
      await request("/platform/clients?status=inactive", undefined, {
        cookie: admin,
      })
    ).json();
    assert.equal(inactive.clients[0].status, "inactive");
    await db.query(
      "INSERT INTO billing_orders(id,account_id,amount_cents,status) VALUES('test-platform-order',$1,1500000,'approved')",
      [owner.account_id],
    );
    await db.query(
      "INSERT INTO billing_receipts(payment_id,account_id,order_id,starts_on,ends_on,anchor_day) VALUES('test-platform-receipt',$1,'test-platform-order',$2,$3,1)",
      [owner.account_id, addDays(today(), -1), addDays(today(), 29)],
    );
    const paid = await (
      await request("/platform/clients?status=active", undefined, {
        cookie: admin,
      })
    ).json();
    assert.equal(paid.clients[0].status, "paid");

    const entry = await request("/platform/demo", {}, { cookie: admin });
    assert.equal(entry.status, 204);
    const demo = cookie(entry);
    const combined = { cookie: normal + "; " + demo + "; " + admin };
    const demoHeaders = {
      ...combined,
      "x-fitware-demo": "1",
      "x-gym-id": demoGymId,
    };
    assert.equal(
      (await (await request("/auth/me", undefined, combined)).json()).id,
      owner.id,
    );
    assert.equal(
      (await (await request("/auth/me", undefined, demoHeaders)).json())
        .account_id,
      demoAccountId,
    );
    assert.equal(
      (await request("/auth/me", undefined, { cookie: demo })).status,
      401,
    );
    assert.equal(
      (
        await request("/members", undefined, {
          cookie: normal,
          "x-gym-id": demoGymId,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/members", undefined, {
          ...demoHeaders,
          "x-gym-id": "platform-test-south",
        })
      ).status,
      403,
    );
    assert.equal(
      (await request("/billing/quote", {}, demoHeaders)).status,
      403,
    );
    assert.equal(
      (await request("/billing/checkout", {}, demoHeaders)).status,
      403,
    );
    assert.equal(
      (await (await request("/members", undefined, demoHeaders)).json()).length,
      10,
    );
    const plans = await (
      await request("/plans", undefined, demoHeaders)
    ).json();
    assert.equal(
      new Set(plans.map((p: { activity: string }) => p.activity)).size,
      10,
    );
    for (const [table, total] of [
      ["orders", 30],
      ["payments", 30],
      ["expenses", 5],
    ]) {
      const count = await db.query(
        `SELECT count(*) n FROM ${table} WHERE gym_id=$1`,
        [demoGymId],
      );
      assert.equal(Number(count.rows[0].n), total);
    }
    assert.equal((await request("/platform/logout", {}, combined)).status, 204);
    assert.equal(
      (await request("/platform/clients", undefined, { cookie: admin })).status,
      401,
    );
    assert.equal(
      (await request("/auth/me", undefined, demoHeaders)).status,
      401,
    );
    assert.equal(
      (await request("/auth/me", undefined, { cookie: normal })).status,
      200,
    );
  } finally {
    if (previousInvite === undefined) delete process.env.PLATFORM_ADMIN_INVITE;
    else process.env.PLATFORM_ADMIN_INVITE = previousInvite;
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await db.close();
    await rm(temp, { recursive: true, force: true });
  }
});
