import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorModal } from "../src/editor.js";
import { Cash } from "../src/cash.js";
import { Reports } from "../src/reports.js";
import { BillingPanel } from "../src/billing-panel.js";
import type { User, Plan, Member, Promotion, Billing } from "../src/types.js";
const user: User = {
  id: "owner",
  name: "Dueño",
  email: "owner@test.com",
  role: "owner",
  account_id: "a",
  phone: "",
  address: "",
  permissions: [],
};
const plan: Plan = {
  id: "p1",
  name: "Pase libre",
  activity: "Musculación",
  price_cents: 3500000,
  duration_unit: "month",
  duration_days: 30,
  active: true,
};
const members = [
  {
    id: "m1",
    name: "Socio Uno",
    document: "40000001",
    plan_ids: [],
    subscriptions: [],
  },
  {
    id: "m2",
    name: "Socio Dos",
    document: "40000002",
    plan_ids: [],
    subscriptions: [],
  },
] as Member[];
const props = {
  user,
  gyms: [],
  members,
  plans: [plan, { ...plan, id: "p2", name: "Pilates", activity: "Pilates" }],
  products: [],
  promotions: [],
  onClose: () => {},
  onSaved: async () => {},
};
test("crear 2x1 muestra dos socios y un selector único de actividad", () => {
  const html = renderToStaticMarkup(
    <EditorModal
      {...props}
      editor={{ kind: "promotion", item: { kind: "two_for_one" } }}
    />,
  );
  assert.match(html, /Socio 1/);
  assert.match(html, /Socio 2/);
  assert.match(html, /Actividad del 2x1/);
  assert.match(html, /name="promotion_activity"/);
  assert.match(html, /no cobra ni renueva/);
});
test("crear combo muestra un socio y selección de varias actividades", () => {
  const html = renderToStaticMarkup(
    <EditorModal
      {...props}
      editor={{ kind: "promotion", item: { kind: "combo" } }}
    />,
  );
  assert.match(html, /Actividades del combo/);
  assert.match(html, /Musculación/);
  assert.match(html, /Pilates/);
  assert.doesNotMatch(html, />Socio 2</);
});
test("aplicar 2x1 conserva la promoción y los dos socios precargados", () => {
  const promotion = {
    id: "promo",
    name: "2x1",
    kind: "two_for_one",
    member_ids: ["m1", "m2"],
    plan_ids: ["p1"],
    active: true,
  } as Promotion;
  const html = renderToStaticMarkup(
    <EditorModal
      {...props}
      promotions={[promotion]}
      editor={{
        kind: "payment",
        item: {
          promotion_id: "promo",
          member_id: "m1",
          partner_id: "m2",
          plan_ids: ["p1"],
        },
      }}
    />,
  );
  assert.match(html, /Socio 1/);
  assert.match(html, /Socio 2/);
  assert.match(html, /Actividad para ambos socios/);
  assert.match(html, /value="m1" selected/);
  assert.match(html, /value="m2" selected/);
  assert.match(html, /value="p1" selected/);
});
test("consumibles permite cargar stock inicial y ver stock editable", () => {
  const initial = renderToStaticMarkup(
    <EditorModal {...props} editor={{ kind: "product" }} />,
  );
  assert.match(initial, /Stock inicial/);
  assert.match(initial, /name="stock"/);
  const edit = renderToStaticMarkup(
    <EditorModal
      {...props}
      editor={{ kind: "product", item: { id: "product", stock: 7 } }}
    />,
  );
  assert.match(edit, /Stock actual/);
  assert.match(edit, /name="stock"[^>]*value="7"/);
});
test("caja es un libro diario distinto del resumen con gráficos", () => {
  const cash = renderToStaticMarkup(
    <Cash report={null} day="2026-10-21" onDay={() => {}} />,
  );
  const report = renderToStaticMarkup(
    <Reports
      report={null}
      from="2026-10-01"
      to="2026-10-21"
      scope="gym"
      owner
      onFilter={() => {}}
    />,
  );
  assert.match(cash, /Libro de movimientos del día/);
  assert.match(cash, /Flujo de efectivo/);
  assert.doesNotMatch(cash, /Comparación de actividades/);
  assert.doesNotMatch(cash, /Resumen detallado/);
  assert.match(report, /Comparación de actividades/);
  assert.match(report, /Resumen detallado/);
  assert.doesNotMatch(report, /Libro de movimientos del día/);
});
test("suscripción muestra USD 15, alias y CVU sin afirmar que la cuenta fue verificada", () => {
  const billing = {
    enabled: false,
    configured: false,
    usd_cents: 1500,
    recipient: {
      alias: "Guicon",
      cvu: "0000003100084706675067",
      currency: "ARS",
      verification:
        "Datos informados por el prestador. Verificá el titular en Mercado Pago.",
    },
    active: true,
    until: "2026-11-01",
    paid: false,
    account_name: "Gimnasio",
    receipts: [],
  } as Billing;
  const html = renderToStaticMarkup(
    <BillingPanel billing={billing} onRefresh={async () => {}} />,
  );
  assert.match(html, /USD 15/);
  assert.match(html, /Guicon/);
  assert.match(html, /0000003100084706675067/);
  assert.match(html, /Verificá el titular/);
  assert.match(html, /no habilita automáticamente/);
});
