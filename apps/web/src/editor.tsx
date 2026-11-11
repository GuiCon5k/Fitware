import { MethodFields } from "./gym-tools";
import { PasswordInput } from "./password-input";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { X, ShieldCheck } from "lucide-react";
import { api, money, shortDate } from "./api";
import { Choices, Field } from "./components";
import type {
  User,
  Gym,
  Member,
  Plan,
  Product,
  Promotion,
  Staff,
  Quote,
  Modules,
} from "./types";
export type Editor = {
  kind:
    | "member"
    | "plan"
    | "payment"
    | "product"
    | "restock"
    | "sale"
    | "promotion"
    | "staff"
    | "gym"
    | "expense"
    | "profile"
    | "password";
  item?: any;
};
export const permissionLabels: Record<string, string> = {
  "payments.reconcile": "Confirmar acreditaciones pendientes",
  "cash.count": "Guardar arqueos de caja",
  "access.checkin": "Controlar y registrar ingresos",
  "access.manage": "Crear y revocar credenciales QR",
  "movements.void": "Anular cobros, ventas y egresos",
  "members.read": "Consultar socios",
  "members.write": "Crear y editar socios",
  "payments.read": "Ver cobros y ventas",
  "payments.write": "Cobrar cuotas",
  "plans.read": "Ver planes y promociones",
  "plans.manage": "Administrar planes",
  "products.read": "Ver consumibles",
  "products.manage": "Administrar stock y costos",
  "sales.write": "Vender consumibles",
  "reports.read": "Ver balances y egresos",
  "expenses.write": "Registrar egresos",
  "promos.manage": "Administrar promociones y descuentos",
};
const preset: Record<string, string[]> = {
  receptionist: [
    "members.read",
    "members.write",
    "payments.read",
    "payments.write",
    "plans.read",
    "products.read",
    "sales.write",
    "access.checkin",
  ],
  trainer: ["members.read", "plans.read"],
};
const names: Record<Editor["kind"], string> = {
  member: "Socio",
  plan: "Plan de actividad",
  payment: "Registrar cobro",
  product: "Consumible",
  restock: "Reponer stock",
  sale: "Registrar venta",
  promotion: "Promoción",
  staff: "Perfil de empleado",
  gym: "Nuevo gimnasio",
  expense: "Registrar egreso",
  profile: "Mi perfil",
  password: "Cambiar contraseña",
};
export function EditorModal({
  editor,
  user,
  gyms,
  members,
  plans,
  products,
  promotions,
  onClose,
  onSaved,
  modules = { products: true, promotions: true, multi_gym: true },
  onCreated,
}: {
  modules?: Modules;
  onCreated?: (id: string) => void;
  editor: Editor;
  user: User;
  gyms: Gym[];
  members: Member[];
  plans: Plan[];
  products: Product[];
  promotions: Promotion[];
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const item = editor.item || {};
  const [b, setB] = useState<any>(() => ({
    active: true,
    duration_unit: "month",
    duration_days: 30,
    method: "cash",
    discount: 0,
    kind: "discount",
    discount_type: "percent",
    value: 10,
    role: "receptionist",
    permissions: preset.receptionist,
    gym_ids: gyms.map((g) => g.id),
    plan_ids: [],
    record_expense: true,
    quantity: 1,
    ...item,
    price: item.price_cents === undefined ? "" : item.price_cents / 100,
    cost: item.cost_cents === undefined ? "" : item.cost_cents / 100,
    unit_cost: item.cost_cents === undefined ? "" : item.cost_cents / 100,
    member_id:
      editor.kind === "payment"
        ? item.member_id || item.id || ""
        : editor.kind === "promotion"
          ? item.member_ids?.[0] || ""
          : undefined,
    partner_id:
      item.partner_id ||
      (editor.kind === "promotion" ? item.member_ids?.[1] || "" : ""),
    general_offer:
      editor.kind === "promotion"
        ? item.id
          ? !item.member_ids?.length
          : false
        : false,
    charge_now: false,
    low_stock_threshold: item.low_stock_threshold ?? 5,
    stock: item.stock ?? 0,
    expected_stock: item.stock,
    stock_reason: "",
    record_stock_expense: false,
    product_id:
      editor.kind === "sale" || editor.kind === "restock"
        ? item.id || ""
        : undefined,
    starts_on: item.starts_on?.slice(0, 10) || "",
    ends_on: item.ends_on?.slice(0, 10) || "",
    ...(editor.kind === "profile" ? user : {}),
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [quote, setQuote] = useState<Quote | null>(null),
    [quoteBusy, setQuoteBusy] = useState(false);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [quoteRevision, setQuoteRevision] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const canDiscount =
    modules.promotions &&
    (user.role === "owner" || user.permissions.includes("promos.manage"));
  const update = (key: string, value: any) => {
    setB((previous: any) => {
      let next = { ...previous, [key]: value };
      if (key === "method" && value === "cash") next.pending = false;
      if (editor.kind === "payment" && key === "promotion_id") {
        const selected = promotions.find((p) => p.id === value);
        next = {
          ...next,
          plan_ids: selected?.plan_ids.length ? [...selected.plan_ids] : [],
          member_id: selected?.member_ids?.[0] || previous.member_id || "",
          partner_id: selected?.member_ids?.[1] || "",
          discount: 0,
        };
      }
      if (editor.kind === "payment" && key === "member_id") {
        const selected = promotions.find((p) => p.id === previous.promotion_id);
        if (
          selected?.kind === "two_for_one" &&
          selected.member_ids?.length === 2
        )
          next.partner_id =
            selected.member_ids.find((id) => id !== value) || "";
        else if (value === previous.partner_id) next.partner_id = "";
      }
      if (editor.kind === "promotion" && key === "kind")
        next = { ...next, plan_ids: [], partner_id: "" };
      if (
        editor.kind === "promotion" &&
        key === "member_id" &&
        value === previous.partner_id
      )
        next.partner_id = "";
      return next;
    });
    setError("");
  };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const dialog = ref.current;
    const selectors =
      "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)";
    const nodes = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(selectors) || []);
    nodes()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab") {
        const list = nodes();
        if (e.shiftKey && document.activeElement === list[0]) {
          e.preventDefault();
          list.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
          e.preventDefault();
          list[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, [busy, onClose]);
  const paymentBody = () => ({
    member_id: b.member_id,
    plan_ids: b.plan_ids,
    method: b.method,
    method_detail: b.method_detail || undefined,
    reference: b.reference || "",
    discount_cents: Math.round(Number(b.discount || 0) * 100),
    ...(b.promotion_id ? { promotion_id: b.promotion_id } : {}),
    ...(b.partner_id ? { partner_id: b.partner_id } : {}),
    request_key: requestKey,
  });
  const firstPayment = editor.kind === "member" && !item.id && b.charge_now;
  const memberBody = () => ({ ...b, plan_ids: b.plan_ids || [] });
  const confirmedQuote = () => ({
    expected_total_cents: quote!.total_cents,
    expected_periods: quote!.lines
      .filter((l) => l.starts_on && l.ends_on)
      .map((l) => ({
        member_id: l.member_id,
        plan_id: l.plan.id,
        starts_on: l.starts_on,
        ends_on: l.ends_on,
      })),
  });
  const registrationBody = () => ({
    member: memberBody(),
    payment: paymentBody(),
    request_key: requestKey,
  });
  useEffect(() => {
    if (editor.kind !== "payment" && !firstPayment) return;
    let ignore = false;
    setQuote(null);
    setQuoteBusy(false);
    const selected = promotions.find((p) => p.id === b.promotion_id);
    if (
      (!firstPayment && !b.member_id) ||
      (firstPayment &&
        (!b.name?.trim() || !/^[0-9]{6,12}$/.test(b.document || ""))) ||
      !b.plan_ids.length ||
      (selected?.kind === "two_for_one" && !b.partner_id)
    )
      return;
    setQuoteBusy(true);
    const timer = setTimeout(() => {
      api<Quote>(
        firstPayment ? "/members/registration-quote" : "/payments/quote",
        {
          method: "POST",
          body: JSON.stringify(
            firstPayment ? registrationBody() : paymentBody(),
          ),
        },
      )
        .then((q) => {
          if (!ignore) {
            setQuote(q);
            setError("");
          }
        })
        .catch((e) => {
          if (!ignore) setError(e.message);
        })
        .finally(() => {
          if (!ignore) setQuoteBusy(false);
        });
    }, 200);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [
    quoteRevision,
    firstPayment,
    b.name,
    b.document,
    b.email,
    b.phone,
    b.address,
    b.emergency_name,
    b.emergency_phone,
    b.notes,
    b.member_id,
    JSON.stringify(b.plan_ids),
    b.method,
    b.method_detail,
    b.reference,
    b.discount,
    b.promotion_id,
    b.partner_id,
  ]);
  const input = (label: string, key: string, type = "text", extra: any = {}) =>
    type === "password" ? (
      <PasswordInput
        label={label}
        name={key}
        value={b[key] ?? ""}
        onChange={(e) => update(key, e.target.value)}
        maxLength={200}
        {...extra}
      />
    ) : (
      <Field label={label}>
        <input
          name={key}
          type={type}
          value={b[key] ?? ""}
          onChange={(e) => update(key, e.target.value)}
          {...extra}
        />
      </Field>
    );
  const select = (
    label: string,
    key: string,
    options: { value: string; label: string }[],
    required = true,
  ) => (
    <Field label={label}>
      <select
        name={key}
        value={b[key] ?? ""}
        onChange={(e) => update(key, e.target.value)}
        required={required}
      >
        <option value="">Seleccioná una opción</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const choice = (
    label: string,
    key: string,
    items: { id: string; name: string }[],
  ) => (
    <Choices
      label={label}
      items={items}
      value={b[key] || []}
      onChange={(v) => update(key, v)}
    />
  );
  const check = (label: string, key: string) => (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={!!b[key]}
        onChange={(e) => update(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const methods = <MethodFields value={b} onChange={update} />;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let path = "",
        method = "POST",
        body: any = b;
      switch (editor.kind) {
        case "member":
          path = "/members" + (item.id ? "/" + item.id : "");
          method = item.id ? "PUT" : "POST";
          if (firstPayment) {
            if (!quote || quoteBusy)
              throw new Error(
                "Revisá los datos y esperá el cálculo del primer cobro",
              );
            path = "/members/register-and-charge";
            body = {
              ...registrationBody(),
              payment: {
                ...paymentBody(),
                ...confirmedQuote(),
              },
            };
          }
          break;
        case "plan":
          path = "/plans" + (item.id ? "/" + item.id : "");
          method = item.id ? "PUT" : "POST";
          body = {
            ...b,
            price_cents: Math.round(Number(b.price) * 100),
            duration_days: Number(b.duration_days),
          };
          break;
        case "payment":
          if (!quote)
            throw new Error("Revisá los datos para calcular el cobro");
          path = b.pending ? "/pending-payments" : "/payments";
          body = { ...paymentBody(), ...confirmedQuote() };
          break;
        case "product":
          path = "/products" + (item.id ? "/" + item.id : "");
          method = item.id ? "PUT" : "POST";
          body = {
            ...b,
            price_cents: Math.round(Number(b.price) * 100),
            cost_cents: Math.round(Number(b.cost || 0) * 100),
            stock: Number(b.stock),
            low_stock_threshold: Number(b.low_stock_threshold),
            ...(item.id ? { expected_stock: item.stock } : {}),
            record_stock_expense:
              !item.id && Number(b.stock) > 0 && b.record_stock_expense,
            request_key: requestKey,
          };
          break;
        case "restock":
          path = "/products/" + item.id + "/restock";
          body = {
            quantity: Number(b.quantity),
            unit_cost_cents: Math.round(Number(b.unit_cost) * 100),
            method: b.method,
            method_detail: b.method_detail || undefined,
            reference: b.reference || "",
            record_expense: b.record_expense,
            request_key: requestKey,
          };
          break;
        case "sale":
          path = "/sales";
          body = {
            product_id: b.product_id,
            quantity: Number(b.quantity),
            method: b.method,
            method_detail: b.method_detail || undefined,
            reference: b.reference || "",
            request_key: requestKey,
          };
          break;
        case "promotion":
          path = "/promotions" + (item.id ? "/" + item.id : "");
          method = item.id ? "PUT" : "POST";
          body = {
            ...b,
            value:
              b.kind === "two_for_one"
                ? 0
                : b.discount_type === "fixed"
                  ? Math.round(Number(b.value) * 100)
                  : Number(b.value),
            starts_on: b.starts_on || null,
            ends_on: b.ends_on || null,
            member_ids: b.general_offer
              ? []
              : b.kind === "two_for_one"
                ? [b.member_id, b.partner_id]
                : [b.member_id],
          };
          break;
        case "staff":
          path = "/staff" + (item.id ? "/" + item.id : "");
          method = item.id ? "PUT" : "POST";
          body = { ...b, ...(b.password ? { password: b.password } : {}) };
          if (!b.password) delete body.password;
          break;
        case "gym":
          path = "/gyms";
          break;
        case "expense":
          path = "/expenses";
          body = {
            ...b,
            request_key: requestKey,
            amount_cents: Math.round(Number(b.amount) * 100),
          };
          break;
        case "profile":
          path = "/profile";
          method = "PUT";
          break;
        case "password":
          path = "/profile/password";
          if (b.new_password !== b.confirm_password)
            throw new Error("Las contraseñas no coinciden");
          break;
      }
      const result = await api<{ id?: string }>(path, {
        method,
        body: JSON.stringify(body),
      });
      await onSaved(
        editor.kind === "payment"
          ? b.pending
            ? "Pago informado. Quedó pendiente de acreditación; todavía no habilita el pase."
            : "Cobro registrado y suscripciones renovadas"
          : editor.kind === "member"
            ? firstPayment
              ? "Socio creado y primer cobro registrado"
              : "Socio guardado. Las actividades quedan pendientes de cobro."
            : "Cambios guardados",
      );
      onClose();
      if (editor.kind === "member" && !item.id && result.id)
        onCreated?.(result.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  let fields: ReactNode;
  switch (editor.kind) {
    case "member":
      fields = (
        <>
          {input("Nombre y apellido", "name", "text", {
            required: true,
            maxLength: 180,
          })}
          {input("Documento", "document", "text", {
            required: true,
            pattern: "[0-9]{6,12}",
            inputMode: "numeric",
          })}
          <div className="form-row">
            {input("Email", "email", "email")}
            {input("Teléfono", "phone", "tel")}
          </div>
          {input("Dirección", "address")}
          <div className="form-row">
            {input("Contacto de emergencia", "emergency_name")}
            {input("Teléfono de emergencia", "emergency_phone", "tel")}
          </div>
          {choice(
            "Actividades / planes elegidos",
            "plan_ids",
            plans
              .filter((p) => p.active)
              .map((p) => ({
                id: p.id,
                name:
                  p.activity + " · " + p.name + " · " + money(p.price_cents),
              })),
          )}
          {!item.id &&
            (user.role === "owner" ||
              user.permissions.includes("payments.write")) && (
              <div className="first-payment">
                <Field label="Primer cobro">
                  <select
                    value={b.charge_now ? "now" : "later"}
                    onChange={(e) =>
                      update("charge_now", e.target.value === "now")
                    }
                  >
                    <option value="later">Guardar socio sin cobrar</option>
                    <option value="now">Crear socio y cobrar ahora</option>
                  </select>
                </Field>
                {b.charge_now && (
                  <>
                    {methods}
                    <div className="quote-box">
                      {quoteBusy ? (
                        <p>Calculando primer cobro…</p>
                      ) : quote ? (
                        <>
                          <div className="quote-total">
                            Total a cobrar <b>{money(quote.total_cents)}</b>
                          </div>
                          {quote.lines.map((l, i) => (
                            <small key={i}>
                              {l.plan.activity}: {money(l.amount_cents)} ·{" "}
                              {l.starts_on && shortDate(l.starts_on)} →{" "}
                              {l.ends_on && shortDate(l.ends_on)}
                            </small>
                          ))}
                        </>
                      ) : (
                        <p>
                          Completá nombre, DNI y actividades para calcular el
                          total.
                        </p>
                      )}
                    </div>
                    <button
                      className="link"
                      type="button"
                      disabled={busy || quoteBusy}
                      onClick={() => setQuoteRevision((n) => n + 1)}
                    >
                      Actualizar total y fechas
                    </button>
                    <p className="fine-print">
                      Confirmá que recibiste el dinero. El socio y el primer
                      cobro se guardan juntos.
                    </p>
                  </>
                )}
              </div>
            )}
          {!b.charge_now && (
            <p className="fine-print">
              Las actividades quedan pendientes de cobro. Podés renovar desde la
              ficha del socio.
            </p>
          )}
          <Field label="Observaciones">
            <textarea
              value={b.notes || ""}
              onChange={(e) => update("notes", e.target.value)}
              maxLength={2000}
            />
          </Field>
        </>
      );
      break;
    case "plan":
      fields = (
        <>
          {input("Nombre del plan", "name", "text", { required: true })}
          {input("Actividad", "activity", "text", { required: true })}
          {input("Precio (ARS)", "price", "number", {
            required: true,
            min: 0.01,
            step: 0.01,
            max: 10000000,
          })}
          {select("Duración", "duration_unit", [
            { value: "month", label: "Mes calendario · mismo día del mes" },
            { value: "days", label: "Cantidad personalizada de días" },
          ])}
          {b.duration_unit === "days" &&
            input("Cantidad de días", "duration_days", "number", {
              required: true,
              min: 1,
              max: 730,
            })}
          <p className="fine-print">
            Un mes calendario conserva el día de pago. Para el 29, 30 o 31 se
            usa el último día disponible y se recupera el día original en el
            siguiente mes.
          </p>
          {check("Disponible para nuevos cobros", "active")}
        </>
      );
      break;
    case "payment": {
      const promotion = promotions.find((p) => p.id === b.promotion_id);
      const isTwo = promotion?.kind === "two_for_one",
        isCombo = promotion?.kind === "combo";
      const eligible = promotion?.member_ids?.length
        ? members.filter((m) => promotion.member_ids.includes(m.id))
        : members;
      const applicable = plans.filter(
        (p) =>
          p.active &&
          (!promotion?.plan_ids.length || promotion.plan_ids.includes(p.id)),
      );
      fields = (
        <>
          {modules.promotions &&
            select(
              "Promoción (opcional)",
              "promotion_id",
              promotions
                .filter((p) => p.active)
                .map((p) => ({ value: p.id, label: p.name })),
              false,
            )}
          {isTwo && (
            <p className="flow-hint">
              2x1: seleccioná dos socios diferentes y una sola actividad.
            </p>
          )}
          {isCombo && (
            <p className="flow-hint">
              Combo: seleccioná un socio y dos o más actividades distintas.
            </p>
          )}
          {select(
            isTwo ? "Socio 1" : "Socio",
            "member_id",
            eligible.map((m) => ({
              value: m.id,
              label: m.name + " · " + m.document,
            })),
          )}
          {isTwo &&
            select(
              "Socio 2",
              "partner_id",
              eligible
                .filter((m) => m.id !== b.member_id)
                .map((m) => ({
                  value: m.id,
                  label: m.name + " · " + m.document,
                })),
            )}
          {isTwo ? (
            <Field label="Actividad para ambos socios">
              <select
                name="activity"
                required
                value={b.plan_ids[0] || ""}
                onChange={(e) => update("plan_ids", [e.target.value])}
              >
                <option value="">Seleccioná una actividad</option>
                {applicable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.activity} · {p.name} · {money(p.price_cents)}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            choice(
              isCombo
                ? "Actividades del socio (dos o más distintas)"
                : "Actividades / planes a cobrar",
              "plan_ids",
              applicable.map((p) => ({
                id: p.id,
                name:
                  p.activity + " · " + p.name + " · " + money(p.price_cents),
              })),
            )
          )}
          {canDiscount &&
            !b.promotion_id &&
            input("Descuento manual (ARS)", "discount", "number", {
              min: 0,
              step: 0.01,
            })}
          {methods}
          {b.method === "transfer" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={!!b.pending}
                onChange={(e) => update("pending", e.target.checked)}
              />
              Dejar pendiente hasta verificar la acreditación
            </label>
          )}
          <p className="fine-print">
            {b.method === "transfer" && b.pending
              ? "No se habilitarán actividades ni se sumará el importe a caja hasta confirmar la recepción del dinero."
              : "Al guardar confirmás que el dinero ya fue recibido. Para una transferencia sin verificar, usá la opción de pendiente."}
          </p>
          <div className="quote-box">
            {quoteBusy ? (
              <p>Calculando total…</p>
            ) : quote ? (
              <>
                <div>
                  Subtotal <b>{money(quote.gross_cents)}</b>
                </div>
                <div>
                  Descuento <b>−{money(quote.discount_cents)}</b>
                </div>
                <div className="quote-total">
                  Total a cobrar <b>{money(quote.total_cents)}</b>
                </div>
                {quote.lines.map((l, i) => (
                  <small key={i}>
                    {l.member_name} · {l.plan.activity}: {money(l.amount_cents)}
                    <br />
                    {l.starts_on && shortDate(l.starts_on)} →{" "}
                    {l.ends_on && shortDate(l.ends_on)}
                  </small>
                ))}
              </>
            ) : (
              <p>
                {isTwo
                  ? "Seleccioná los dos socios y la actividad."
                  : isCombo
                    ? "Seleccioná el socio y al menos dos actividades distintas."
                    : "Seleccioná un socio y al menos una actividad."}
              </p>
            )}
          </div>
          <button
            className="link"
            type="button"
            disabled={busy || quoteBusy}
            onClick={() => setQuoteRevision((n) => n + 1)}
          >
            Actualizar total y fechas
          </button>
          <p className="fine-print">
            Confirmá que recibiste el dinero antes de cobrar. El pago y todas
            las renovaciones se guardan juntos. Guardar una oferta no registra
            un pago.
          </p>
        </>
      );
      break;
    }
    case "product":
      fields = (
        <>
          {input("Nombre", "name", "text", { required: true })}
          {input(
            "Avisar con stock igual o menor a",
            "low_stock_threshold",
            "number",
            { required: true, min: 0, max: 100000000 },
          )}
          {select(
            "Categoría",
            "category",
            ["Bebidas", "Snacks", "Suplementos", "Otros"].map((x) => ({
              value: x,
              label: x,
            })),
          )}
          <div className="form-row">
            {input("Precio de venta (ARS)", "price", "number", {
              required: true,
              min: 0.01,
              step: 0.01,
              max: 1000000,
            })}
            {input("Costo unitario (ARS)", "cost", "number", {
              required: true,
              min: 0,
              step: 0.01,
              max: 1000000,
            })}
          </div>
          {input(
            item.id
              ? "Stock actual (unidades contadas)"
              : "Stock inicial (unidades)",
            "stock",
            "number",
            { required: true, min: 0, max: 100000000, step: 1 },
          )}
          {item.id &&
            Number(b.stock) !== item.stock &&
            input("Motivo del ajuste de stock", "stock_reason", "text", {
              required: true,
              maxLength: 300,
              placeholder: "Ej.: recuento de inventario",
            })}
          {!item.id && Number(b.stock) > 0 && (
            <>
              {check(
                "Registrar la compra del stock inicial como egreso",
                "record_stock_expense",
              )}
              {b.record_stock_expense && methods}
            </>
          )}
          {check("Disponible para venta", "active")}
          <p className="fine-print">
            Podés cargar o corregir las unidades desde este formulario. Los
            ajustes quedan registrados y no se consideran ventas. Para compras
            posteriores usá “Reponer”, que permite registrar el egreso y
            actualiza el costo promedio.
          </p>
        </>
      );
      break;
    case "restock":
      fields = (
        <>
          <p>
            {item.name} · stock actual: {item.stock}
          </p>
          {input("Unidades a ingresar", "quantity", "number", {
            required: true,
            min: 1,
            max: 10000,
          })}
          {input("Costo por unidad (ARS)", "unit_cost", "number", {
            required: true,
            min: 0,
            step: 0.01,
            max: 1000000,
          })}
          {methods}
          {check("Registrar la compra como egreso de caja", "record_expense")}
          <p className="fine-print">
            Desmarcá solo si es stock inicial o una compra que ya registraste,
            para evitar contar dos veces el mismo gasto.
          </p>
        </>
      );
      break;
    case "sale": {
      const p = products.find((p) => p.id === b.product_id);
      fields = (
        <>
          {select(
            "Consumible",
            "product_id",
            products
              .filter((p) => p.active)
              .map((p) => ({
                value: p.id,
                label: p.name + " · " + p.stock + " disponibles",
              })),
          )}
          {input("Unidades", "quantity", "number", {
            required: true,
            min: 1,
            max: p?.stock || 1,
          })}
          {methods}
          <div className="quote-box">
            <div>
              Total{" "}
              <b>{money((p?.price_cents || 0) * Number(b.quantity || 0))}</b>
            </div>
          </div>
        </>
      );
      break;
    }
    case "promotion": {
      const isTwo = b.kind === "two_for_one",
        isCombo = b.kind === "combo";
      fields = (
        <>
          {input("Nombre de la promoción", "name", "text", { required: true })}
          {select("Tipo de promoción", "kind", [
            { value: "two_for_one", label: "2x1 · dos socios y una actividad" },
            { value: "combo", label: "Un socio y dos o más actividades" },
            { value: "discount", label: "Descuento general" },
          ])}
          {check(
            "Guardar como oferta general, sin socios fijos",
            "general_offer",
          )}
          {!b.general_offer && (
            <>
              {select(
                isTwo ? "Socio 1" : "Socio",
                "member_id",
                members.map((m) => ({
                  value: m.id,
                  label: m.name + " · " + m.document,
                })),
              )}
              {isTwo &&
                select(
                  "Socio 2",
                  "partner_id",
                  members
                    .filter((m) => m.id !== b.member_id)
                    .map((m) => ({
                      value: m.id,
                      label: m.name + " · " + m.document,
                    })),
                )}
            </>
          )}
          {isTwo ? (
            <Field label="Actividad del 2x1">
              <select
                name="promotion_activity"
                required={!b.general_offer}
                value={b.plan_ids[0] || ""}
                onChange={(e) =>
                  update("plan_ids", e.target.value ? [e.target.value] : [])
                }
              >
                <option value="">
                  {b.general_offer
                    ? "Elegir al aplicar la oferta"
                    : "Seleccioná una actividad"}
                </option>
                {plans
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.activity} · {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          ) : (
            choice(
              isCombo
                ? "Actividades del combo (dos o más distintas)"
                : "Actividades con descuento",
              "plan_ids",
              plans
                .filter((p) => p.active)
                .map((p) => ({ id: p.id, name: p.activity + " · " + p.name })),
            )
          )}
          {!isTwo && (
            <div className="form-row">
              {select("Tipo de descuento", "discount_type", [
                { value: "percent", label: "Porcentaje (%)" },
                { value: "fixed", label: "Importe fijo (ARS)" },
              ])}
              {input(
                b.discount_type === "percent" ? "Porcentaje" : "Importe (ARS)",
                "value",
                "number",
                {
                  required: true,
                  min: 0,
                  max: b.discount_type === "percent" ? 100 : 10000000,
                  step: b.discount_type === "percent" ? 1 : 0.01,
                },
              )}
            </div>
          )}
          <div className="form-row">
            {input("Desde (opcional)", "starts_on", "date")}
            {input("Hasta (opcional)", "ends_on", "date")}
          </div>
          {check("Promoción activa", "active")}
          <p className="fine-print">
            {b.general_offer
              ? "La oferta queda disponible para seleccionar socios al aplicarla."
              : "La oferta queda asociada a estos socios y actividades."}{" "}
            Guardarla no cobra ni renueva cuotas. Después usá “Aplicar y cobrar
            promoción”.
          </p>
        </>
      );
      break;
    }
    case "staff":
      fields = (
        <>
          {input("Nombre y apellido", "name", "text", { required: true })}
          {input("Email de acceso", "email", "email", { required: true })}
          <div className="form-row">
            {input("Teléfono", "phone", "tel")}
            {input("Dirección", "address")}
          </div>
          <Field label="Rol">
            <select
              value={b.role}
              onChange={(e) =>
                setB((p: any) => ({
                  ...p,
                  role: e.target.value,
                  permissions: preset[e.target.value],
                }))
              }
            >
              <option value="receptionist">Recepcionista</option>
              <option value="trainer">Entrenador</option>
            </select>
          </Field>
          {choice("Gimnasios asignados", "gym_ids", gyms)}
          {choice(
            "Permisos (podés ajustar los del rol)",
            "permissions",
            Object.entries(permissionLabels).map(([id, name]) => ({
              id,
              name,
            })),
          )}
          {input(
            item.id ? "Nueva contraseña (opcional)" : "Contraseña inicial",
            "password",
            "password",
            { required: !item.id, minLength: 10, autoComplete: "new-password" },
          )}
          {check("Empleado habilitado", "active")}
          <p className="fine-print">
            Guardá y entregá la contraseña al empleado por un canal seguro.
            Puede cambiarla desde su perfil. Actualizar el perfil cierra sus
            sesiones abiertas.
          </p>
        </>
      );
      break;
    case "gym":
      fields = (
        <>
          {input("Nombre del gimnasio / sede", "name", "text", {
            required: true,
          })}
          {input("Dirección", "address")}
          <p className="fine-print">
            Cada sede tiene sus propios socios, planes, productos, promociones y
            movimientos. El dueño puede consultar el balance consolidado.
          </p>
        </>
      );
      break;
    case "expense":
      fields = (
        <>
          {input("Concepto", "description", "text", { required: true })}
          {input("Categoría", "category", "text", { required: true })}
          {input("Importe (ARS)", "amount", "number", {
            required: true,
            min: 0.01,
            step: 0.01,
            max: 10000000,
          })}
          {methods}
        </>
      );
      break;
    case "profile":
      fields = (
        <>
          {input("Nombre y apellido", "name", "text", { required: true })}
          <Field label="Email de acceso">
            <input value={user.email} disabled />
          </Field>
          {input("Teléfono", "phone", "tel")}
          {input("Dirección", "address")}
          <p className="fine-print">
            Tu rol y tus permisos los administra el dueño.
          </p>
        </>
      );
      break;
    case "password":
      fields = (
        <>
          {input("Contraseña actual", "current_password", "password", {
            required: true,
            autoComplete: "current-password",
          })}
          {input("Nueva contraseña", "new_password", "password", {
            required: true,
            minLength: 10,
            autoComplete: "new-password",
          })}
          {input("Repetí la nueva contraseña", "confirm_password", "password", {
            required: true,
            minLength: 10,
            autoComplete: "new-password",
          })}
        </>
      );
      break;
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">FITWARE · GESTIÓN</span>
            <h2 id="modal-title">
              {item.id &&
              ["member", "plan", "product", "promotion", "staff"].includes(
                editor.kind,
              )
                ? "Editar · "
                : ""}
              {names[editor.kind]}
            </h2>
          </div>
          <button
            className="icon-btn"
            disabled={busy}
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X />
          </button>
        </div>
        <form onSubmit={save}>
          {item.warnings?.length > 0 && (
            <div className="flow-hint" role="status">
              {item.warnings.map((w: string) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          )}
          {fields}
          {error && (
            <div role="alert" className="error">
              {error}
            </div>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              Cancelar
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                ((editor.kind === "payment" || firstPayment) &&
                  (!quote || quoteBusy))
              }
            >
              <ShieldCheck size={16} />
              {busy
                ? "Guardando…"
                : firstPayment
                  ? "Crear socio y confirmar cobro"
                  : editor.kind === "payment"
                    ? b.pending
                      ? "Informar pago pendiente"
                      : "Confirmar cobro"
                    : editor.kind === "sale"
                      ? "Confirmar venta"
                      : "Guardar"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
