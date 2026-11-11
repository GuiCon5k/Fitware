import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { memberStatusFor } from "../src/member-status.js";
import { PaymentTable } from "../src/components.js";
import type { Member, Payment } from "../src/types.js";
test("estado del socio se calcula dentro del área seleccionada y respeta vencimiento exclusivo", () => {
  const m = {
    subscriptions: [
      {
        id: "1",
        plan_id: "gym",
        activity: "Musculación",
        starts_on: "2026-11-01",
        ends_on: "2026-12-01",
      },
      {
        id: "2",
        plan_id: "pilates",
        activity: "Pilates",
        starts_on: "2026-10-01",
        ends_on: "2026-11-11",
      },
      {
        id: "3",
        plan_id: "yoga",
        activity: "Yoga",
        starts_on: "2026-11-12",
        ends_on: "2026-12-12",
      },
    ],
  } as Member;
  assert.equal(memberStatusFor(m, "2026-11-11"), "Activo");
  assert.equal(memberStatusFor(m, "2026-11-11", "Pilates"), "Vencido");
  assert.equal(memberStatusFor(m, "2026-11-11", "Yoga"), "Programado");
  assert.equal(memberStatusFor(m, "2026-11-11", "Boxeo"), "Sin cuota");
});
test("tabla de cuotas presenta las columnas del gimnasio y el precio final con promoción y medio específico", () => {
  const p = {
    id: "1",
    member_name: "Persona <script>",
    member_document: "00123456",
    member_phone: "1144445555",
    plan_name: "Gym + Yoga",
    amount_cents: 300000,
    discount_cents: 100000,
    method: "transfer",
    method_name: "Banco Nación",
    reference: "Operación 123",
    created_at: "2026-11-11T12:00:00Z",
    promotion_name: "Combo",
    order_id: "o",
  } as Payment;
  const html = renderToStaticMarkup(<PaymentTable payments={[p]} />);
  for (const word of [
    "FECHA",
    "SOCIO",
    "DNI",
    "TELÉFONO",
    "PASE",
    "PRECIO FINAL",
    "00123456",
    "1144445555",
    "Banco Nación",
    "Operación 123",
    "Combo",
  ])
    assert.ok(html.includes(word), word);
  assert.equal(html.includes("<script>"), false);
});
