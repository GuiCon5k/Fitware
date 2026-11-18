import React from "react";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { connectDatabase, migrate, type Database } from "../../api/src/db.js";
import { seed } from "../../api/src/seed.js";
import { createApp } from "../../api/src/app.js";
import { createBackupService } from "../../api/src/backups.js";
const dom = new Window({ url: "http://localhost:5173" });
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "Node",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FormData",
  "File",
  "Blob",
  "location",
  "history",
])
  Object.defineProperty(globalThis, key, {
    value: key === "window" ? dom : (dom as any)[key],
    configurable: true,
    writable: true,
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { render, screen, within, waitFor, cleanup, fireEvent, act } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { App, Auth } = await import("../src/app.js");
const { ImportMembers, Recovery } = await import("../src/workspace-tools.js");
const realFetch = globalThis.fetch;
let db: Database,
  server: Server,
  base = "",
  cookie = "",
  gym = "",
  temp = "";
let mockImport = false;
const requests: string[] = [];
async function req(path: string, method = "GET", data?: unknown) {
  const r = await realFetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-fitware-client": "web",
      cookie,
      ...(gym ? { "x-gym-id": gym } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  assert.ok(r.ok, await r.clone().text());
  return r.json();
}
before(async () => {
  process.env.ADMIN_EMAIL = "ui-owner@test.com";
  process.env.ADMIN_PASSWORD = "PruebasReact2026!";
  process.env.RECEPTION_EMAIL = "ui-reception@test.com";
  process.env.RECEPTION_PASSWORD = "PruebasReact2026!";
  process.env.SEED_DEMO = "false";
  process.env.REQUIRE_SUBSCRIPTION = "false";

  db = await connectDatabase(undefined, true);
  await migrate(db);
  await seed(db);
  temp = await mkdtemp(join(tmpdir(), "fitware-ui-"));
  server = createApp(db, {
    backups: createBackupService(db, temp),
    resetSender: async () => {},
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;

  const login = await realFetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fitware-client": "web" },
    body: JSON.stringify({
      email: "ui-owner@test.com",
      password: "PruebasReact2026!",
    }),
  });
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  gym = (await req("/gyms"))[0].id;

  await req("/plans", "POST", {
    name: "Mensual",
    activity: "Musculación",
    price_cents: 150000,
  });
  await req("/products", "POST", {
    name: "Agua",
    category: "Bebidas",
    price_cents: 1000,
    cost_cents: 400,
    stock: 4,
    low_stock_threshold: 5,
  });

  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    if (mockImport && url.endsWith("/members/import/preview"))
      return new Response(
        JSON.stringify({
          id: "preview-test",
          valid: 1,
          duplicates: 1,
          errors: 1,
          rows: [
            {
              row: 2,
              name: "Válido",
              document: "40000001",
              status: "valid",
              errors: [],
            },
            {
              row: 3,
              name: "Repetido",
              document: "40000002",
              status: "duplicate",
              errors: [],
            },
            {
              row: 4,
              name: "Inválido",
              document: "x",
              status: "error",
              errors: ["DNI inválido"],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    if (mockImport && url.endsWith("/members/import/commit"))
      return new Response(JSON.stringify({ imported: 1, skipped: 2 }), {
        headers: { "content-type": "application/json" },
      });
    const r = await realFetch(
      url.startsWith("/api") ? base + url.slice(4) : url,
      {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init?.headers)), cookie },
      },
    );
    const next = r.headers.get("set-cookie");
    if (next) cookie = next.split(";")[0];
    return r;
  }) as typeof fetch;
});
afterEach(async () => {
  cleanup();
  mockImport = false;
  await new Promise((r) => setTimeout(r, 30));
});
test("registro compara contraseñas antes de enviar y permite mostrarlas sin borrar datos", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(<Auth initialError="" onLogin={() => {}} />);
  await user.click(
    screen.getByRole("button", { name: "¿Tenés un gimnasio? Creá tu cuenta" }),
  );
  await user.type(
    screen.getByLabelText("Tu nombre y apellido"),
    "Guille prueba",
  );
  await user.type(
    screen.getByLabelText("Nombre de tu organización"),
    "Organización",
  );
  await user.type(
    screen.getByLabelText("Nombre de tu primer gimnasio"),
    "Gimnasio",
  );
  await user.type(
    screen.getByLabelText("Email", { exact: true }),
    "confirm-ui@test.com",
  );
  const password = screen.getByLabelText("Contraseña", {
    exact: true,
  }) as HTMLInputElement;
  const confirm = screen.getByLabelText("Repetí la contraseña", {
    exact: true,
  }) as HTMLInputElement;
  await user.type(password, "ClaveDePrueba2026!");
  await user.type(confirm, "OtraClaveDePrueba!");
  const count = requests.filter((p) => p.endsWith("/auth/register")).length;
  await user.click(
    screen.getByRole("button", { name: "Crear cuenta", exact: true }),
  );
  const feedback = screen.getByRole("alert");
  assert.match(feedback.textContent || "", /no coinciden/);
  assert.ok(dom.document.activeElement === confirm);
  assert.equal(confirm.getAttribute("aria-invalid"), "true");
  assert.ok(
    confirm.getAttribute("aria-describedby")?.split(" ").includes(feedback.id),
  );

  assert.equal(
    requests.filter((p) => p.endsWith("/auth/register")).length,
    count,
  );
  assert.equal(password.value, "ClaveDePrueba2026!");
  assert.equal(
    (screen.getByLabelText("Tu nombre y apellido") as HTMLInputElement).value,
    "Guille prueba",
  );
  assert.equal(password.type, "password");
  await user.click(
    screen.getByRole("button", { name: "Mostrar contraseña", exact: true }),
  );
  assert.equal(password.type, "text");
  assert.equal(confirm.type, "password");
  await user.click(
    screen.getByRole("button", { name: "Ocultar contraseña", exact: true }),
  );
  assert.equal(password.type, "password");
  assert.equal(password.value, "ClaveDePrueba2026!");
  await user.clear(password);
  await user.type(password, confirm.value);
  assert.equal(confirm.hasAttribute("aria-invalid"), false);
  assert.equal(screen.queryByRole("alert"), null);
});
after(async () => {
  globalThis.fetch = realFetch;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  await db.close();
  await rm(temp, { recursive: true, force: true });
  await dom.happyDOM.close();
});
for (const width of [1440, 390])
  test(`flujo integrado React + Express: alta/cobro, búsqueda, renovación, anulación y navegación (${width}px, DOM)`, async () => {
    dom.happyDOM.setWindowSize({ width, height: 900 });
    const user = userEvent.setup({ document: dom.document as any });
    render(<App />);
    await screen.findByRole("heading", { name: "Tu gimnasio, al día." });
    await screen.findByText("Stock por reponer");
    await user.click(
      screen.getByRole("button", { name: "Socios", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "Nuevo socio" }));
    let dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Nombre y apellido"),
      "Socio interfaz " + width,
    );
    await user.type(
      within(dialog).getByLabelText("Documento"),
      width === 1440 ? "76144001" : "76390001",
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /Musculación/ }),
    );
    const firstPayment = within(dialog).getByLabelText("Primer cobro");
    await user.selectOptions(firstPayment, "now");
    await within(dialog).findByText("Calculando primer cobro…");
    await user.selectOptions(firstPayment, "later");
    assert.equal(
      (
        within(dialog).getByRole("button", {
          name: "Guardar",
          exact: true,
        }) as HTMLButtonElement
      ).disabled,
      false,
    );
    await user.selectOptions(firstPayment, "now");
    await waitFor(() =>
      assert.equal(
        (
          within(dialog).getByRole("button", {
            name: "Crear socio y confirmar cobro",
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Crear socio y confirmar cobro",
      }),
    );
    await screen.findByRole("heading", { name: "Socio interfaz " + width });
    dialog = screen.getByRole("dialog");
    assert.ok(within(dialog).getByText("Activo"));
    assert.ok(within(dialog).getByText("Próximo vencimiento"));
    assert.equal(
      (
        within(dialog).getByText("Datos de contacto y emergencia")
          .parentElement as HTMLDetailsElement
      ).open,
      false,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Renovar igual" }),
    );
    await screen.findByRole("heading", { name: "Registrar cobro" });
    dialog = screen.getByRole("dialog");
    await waitFor(() =>
      assert.equal(
        (
          within(dialog).getByRole("button", {
            name: "Confirmar cobro",
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    assert.ok(within(dialog).getByText("Total a cobrar"));
    await user.click(
      within(dialog).getByRole("button", { name: "Confirmar cobro" }),
    );
    await waitFor(() => assert.equal(!!screen.queryByRole("dialog"), false));
    // Search is available away from the members page and opens with the keyboard.
    await user.click(
      screen.getByRole("button", { name: "Planes y actividades", exact: true }),
    );
    const search = screen.getByRole("combobox", {
      name: "Buscar socio en todo el gimnasio",
    });
    await user.type(search, width === 1440 ? "76144001" : "76390001");
    await screen.findByRole("option", {
      name: new RegExp("Socio interfaz " + width),
    });
    await user.keyboard("{ArrowDown}{Enter}");
    await screen.findByRole("heading", { name: "Socio interfaz " + width });
    await user.keyboard("{Escape}");
    await waitFor(() => assert.equal(!!screen.queryByRole("dialog"), false));
    await user.click(
      screen.getByRole("button", {
        name: "Pagos y suscripciones",
        exact: true,
      }),
    );
    const buttons = await screen.findAllByRole("button", {
      name: "Anular",
      exact: true,
    });
    await user.click(buttons[0]);
    dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Motivo de la anulación"),
      "Renovación duplicada " + width,
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirmar anulación" }),
    );
    await waitFor(() => assert.equal(!!screen.queryByRole("dialog"), false));
    await screen.findByText("Anulado · Renovación duplicada " + width);
    await user.click(
      screen.getByRole("button", { name: "Caja y movimientos", exact: true }),
    );
    await screen.findByText("Libro de movimientos del día");
    await user.click(
      screen.getByRole("button", { name: "Resumen y balances", exact: true }),
    );
    await screen.findByText("Comparación de actividades");
    await user.click(
      screen.getByRole("button", { name: "Configuración", exact: true }),
    );
    await screen.findByText("Funciones de tu gimnasio");
    await screen.findByRole("button", { name: "Crear respaldo ahora" });
    await user.click(
      screen.getByRole("button", { name: "Crear respaldo ahora" }),
    );
    await screen.findByText("Respaldo creado");
    await user.click(screen.getByRole("button", { name: /Equipo y permisos/ }));
    await screen.findByText("Empleados y accesos");
    await user.click(
      screen.getByRole("button", { name: "Mi perfil", exact: true }),
    );
    await screen.findByRole("heading", { name: "Mi perfil" });
    const members = await req("/members");
    const saved = members.find(
      (m: any) => m.name === "Socio interfaz " + width,
    );
    assert.equal(saved.subscriptions.length, 1);
  });
test("importación UI exige revisar filas antes de confirmar y muestra omitidos", async () => {
  mockImport = true;
  requests.length = 0;
  const user = userEvent.setup({ document: dom.document as any });
  let message = "";
  render(
    <ImportMembers
      onClose={() => {}}
      onSaved={async (value) => {
        message = value;
      }}
    />,
  );
  assert.equal(
    screen.queryByRole("button", { name: /Confirmar importación/ }),
    null,
  );
  const file = new dom.File(["Nombre;DNI\nVálido;40000001"], "socios.csv", {
    type: "text/csv",
  });
  await user.upload(screen.getByLabelText("Archivo de socios"), file as any);
  await screen.findByText(/1 válidos · 1 duplicados · 1 con errores/);
  assert.ok(screen.getByText("DNI inválido"));
  assert.ok(!requests.some((r) => r.endsWith("/members/import/commit")));
  await user.click(
    screen.getByRole("button", { name: "Confirmar importación de 1 socios" }),
  );
  await screen.findByText(
    /Importación terminada: 1 socios agregados, 2 omitidos/,
  );
  assert.equal(message, "1 socios importados");
});
test("login muestra errores junto a los campos y enfoca el primero al enviar con Enter", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(
    <Auth onLogin={() => assert.fail("Ingreso inválido")} initialError="" />,
  );
  const email = screen.getByLabelText("Email") as HTMLInputElement;
  const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
  let nativeErrors = 0;
  email.form!.addEventListener("invalid", () => nativeErrors++, true);
  const before = requests.filter((path) => path.endsWith("/auth/login")).length;
  await user.type(email, "email-invalido{Enter}");
  assert.equal(nativeErrors, 0);
  assert.ok(dom.document.activeElement === email);

  assert.match(screen.getByRole("alert").textContent || "", /2 campos/);
  assert.match(
    dom.document.getElementById(email.getAttribute("aria-describedby")!)
      ?.textContent || "",
    /email válido/,
  );
  assert.equal(password.getAttribute("aria-invalid"), "true");
  assert.equal(
    requests.filter((path) => path.endsWith("/auth/login")).length,
    before,
  );
  await user.clear(email);
  await user.type(email, "dueno@test.com");
  assert.equal(email.hasAttribute("aria-invalid"), false);
  assert.equal(password.getAttribute("aria-invalid"), "true");
  assert.equal(email.value, "dueno@test.com");
});

test("el editor muestra junto al campo el error devuelto por Express y conserva lo ingresado", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(<App />);
  await screen.findByRole("heading", { name: "Tu gimnasio, al día." });
  await user.click(screen.getByRole("button", { name: "Socios", exact: true }));
  await user.click(
    screen.getByRole("button", { name: "Nuevo socio", exact: true }),
  );
  const dialog = within(screen.getByRole("dialog"));
  const phone = dialog.getByLabelText("Teléfono", {
    exact: true,
  }) as HTMLInputElement;
  await user.type(
    dialog.getByLabelText("Nombre y apellido"),
    "Validación de socio",
  );
  await user.type(dialog.getByLabelText("Documento"), "75176305");
  await user.type(phone, "1".repeat(41));
  await user.click(
    dialog.getByRole("button", { name: "Guardar", exact: true }),
  );
  const error = await dialog.findByRole("alert");
  assert.match(error.textContent || "", /Teléfono.*hasta 40/);
  assert.equal(phone.getAttribute("aria-describedby"), error.id);
  assert.ok(
    dom.document.activeElement === phone,
    "el error de la API debe enfocar el teléfono",
  );

  assert.equal(phone.value, "1".repeat(41));
  assert.equal(
    (dialog.getByLabelText("Documento") as HTMLInputElement).value,
    "75176305",
  );
  await user.keyboard("{Backspace}");
  assert.equal(dialog.queryByRole("alert"), null);
  assert.equal(phone.hasAttribute("aria-invalid"), false);
});

test("recuperación compara las contraseñas sin intentar usar el enlace", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(<Recovery token="enlace-de-prueba" onBack={() => {}} />);
  const password = screen.getByLabelText(
    "Nueva contraseña",
  ) as HTMLInputElement;
  const confirmation = screen.getByLabelText(
    "Repetir contraseña",
  ) as HTMLInputElement;
  const before = requests.filter((path) =>
    path.endsWith("/auth/reset-password"),
  ).length;
  await user.type(password, "ClaveRecuperacion123!");
  await user.type(confirmation, "OtraClaveDePrueba123!");
  await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));
  assert.match(screen.getByRole("alert").textContent || "", /no coinciden/);
  assert.ok(dom.document.activeElement === confirmation);

  assert.equal(
    requests.filter((path) => path.endsWith("/auth/reset-password")).length,
    before,
  );
  assert.equal(password.value, "ClaveRecuperacion123!");
});

test("recuperación UI solicita email y no revela si la cuenta existe", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(<Recovery onBack={() => {}} />);
  await user.type(
    screen.getByLabelText("Email de tu cuenta"),
    "nobody-ui@test.com",
  );
  await user.click(screen.getByRole("button", { name: "Enviar enlace" }));
  await screen.findByRole("status");
  assert.match(
    screen.getByRole("status").textContent || "",
    /Si el email está registrado/,
  );
});
test("el dueño puede desactivar módulos y desaparecen de la navegación", async () => {
  const user = userEvent.setup({ document: dom.document as any });
  render(<App />);
  await screen.findByRole("heading", { name: "Tu gimnasio, al día." });
  await screen.findByText("Stock por reponer");
  await user.click(
    screen.getByRole("button", { name: "Configuración", exact: true }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: "Consumibles y control de stock" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Guardar configuración" }),
  );
  await screen.findByText("Configuración guardada");
  assert.equal(
    !!screen.queryByRole("button", { name: "Consumibles", exact: true }),
    false,
  );
  await act(async () => {
    assert.equal((await req("/settings")).modules.products, false);
  });
  cleanup();
  await req("/settings", "PUT", {
    modules: { products: true, promotions: true, multi_gym: true },
  });
});
test("un entrenador ve únicamente las funciones autorizadas y puede consultar la ficha", async () => {
  const ownerCookie = cookie;
  await req("/staff", "POST", {
    name: "Entrenador UI",
    email: "trainer-ui@test.com",
    password: "PruebasReact2026!",
    role: "trainer",
    gym_ids: [gym],
    permissions: ["members.read", "plans.read"],
  });
  const r = await realFetch(base + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fitware-client": "web" },
    body: JSON.stringify({
      email: "trainer-ui@test.com",
      password: "PruebasReact2026!",
    }),
  });
  assert.ok(r.ok);
  cookie = r.headers.get("set-cookie")!.split(";")[0];
  try {
    const user = userEvent.setup({ document: dom.document as any });
    render(<App />);
    await screen.findByRole("heading", { name: "Tu gimnasio, al día." });
    assert.equal(
      !!screen.queryByRole("button", { name: "Configuración", exact: true }),
      false,
    );
    assert.equal(
      !!screen.queryByRole("button", { name: "Consumibles", exact: true }),
      false,
    );
    assert.equal(
      !!screen.queryByRole("button", {
        name: "Caja y movimientos",
        exact: true,
      }),
      false,
    );
    await user.click(
      screen.getByRole("button", { name: "Socios", exact: true }),
    );
    assert.equal(
      !!screen.queryByRole("button", { name: "Nuevo socio" }),
      false,
    );
    const buttons = await screen.findAllByRole("button", { name: "Ver ficha" });
    await user.click(buttons[0]);
    assert.equal(
      !!screen.queryByRole("button", { name: "Renovar igual" }),
      false,
    );
    assert.equal(
      !!screen.queryByRole("button", { name: "Editar datos" }),
      false,
    );
    assert.equal(!!screen.queryByText("Último pago"), false);
  } finally {
    cleanup();
    cookie = ownerCookie;
  }
});
test("recepción y conciliación: pendiente no activa, revisión habilita y el ingreso se registra por área", async () => {
  const { Reconciliation, AccessDesk } = await import("../src/gym-tools.js");
  const { setGym } = await import("../src/api.js");
  setGym(gym);
  const plans = await req("/plans"),
    plan = plans[0];
  const member = await req("/members", "POST", {
    name: "Socio acreditación",
    document: "99887766",
    plan_ids: [plan.id],
  });
  await req("/pending-payments", "POST", {
    member_id: member.id,
    plan_ids: [plan.id],
    method: "transfer",
    request_key: crypto.randomUUID(),
    reference: "Op 777",
  });
  const owner = await req("/auth/me");
  const user = userEvent.setup({ document: dom.document as any });
  render(<Reconciliation user={owner} onChanged={async () => {}} />);
  await screen.findByText("Socio acreditación");
  assert.equal(
    (await req("/members")).find((m: any) => m.id === member.id).subscriptions
      .length,
    0,
  );
  await user.click(
    screen.getByRole("button", { name: "Revisar", exact: true }),
  );
  const confirm = await screen.findByRole("button", {
    name: "Confirmar manualmente",
  });
  const reason = screen.getByLabelText("Constancia de la revisión");
  await waitFor(() =>
    assert.equal((confirm as HTMLButtonElement).disabled, false),
  );
  const reviews = () =>
    requests.filter((path) => /\/pending-payments\/[^/]+\/review$/.test(path))
      .length;
  const before = reviews();
  await user.click(confirm);
  assert.equal(reason.getAttribute("aria-invalid"), "true");
  assert.ok(dom.document.activeElement === reason);

  assert.equal(reviews(), before);
  await user.type(reason, "Acreditado, operación 777{Enter}");
  assert.equal(reviews(), before);
  await user.click(confirm);
  await screen.findByText("Cobro confirmado y pases habilitados.");
  assert.equal(
    (await req("/members")).find((m: any) => m.id === member.id).subscriptions
      .length,
    1,
  );
  cleanup();
  render(
    <AccessDesk members={await req("/members")} plans={plans} gymId={gym} />,
  );
  await user.type(screen.getByLabelText("DNI o credencial QR"), "99887766");
  await user.click(screen.getByRole("button", { name: "Buscar", exact: true }));
  await screen.findByText("Pase vigente");
  await user.click(
    screen.getByRole("button", { name: "Registrar ingreso", exact: true }),
  );
  await screen.findByText("Ingreso registrado.");
  await screen.findByText("Permitido", { exact: true });
  assert.equal(
    (await req("/access/checkins")).find((c: any) => c.document === "99887766")
      .allowed,
    true,
  );
});
