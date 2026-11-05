import type React from "react";
import { Dumbbell, ChevronRight, CreditCard } from "lucide-react";
import { money, shortDate } from "./api";
import type { Payment } from "./types";
export function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
}
export function Logo() {
  return (
    <div className="logo">
      <span>
        <Dumbbell size={23} />
      </span>
      FIT<span className="logo-light">Ware</span>
      <i />
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Stat({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="stat">
      <div>
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
export function PanelHead({
  title,
  subtitle,
  action,
  onClick,
}: {
  title: string;
  subtitle: string;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button className="link" onClick={onClick}>
          {action}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}
export function Empty({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}
export function PaymentTable({
  payments,
  onVoid,
}: {
  payments: Payment[];
  onVoid?: (p: Payment) => void;
}) {
  return payments.length ? (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SOCIO / PLAN</th>
            <th>FECHA</th>
            <th>PROMOCIÓN</th>
            <th>MEDIO</th>
            <th>IMPORTE</th>
            {onVoid && <th>ACCIÓN</th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className={p.voided_at ? "voided-row" : ""}>
              <td>
                <div className="person">
                  <span className="member-avatar">
                    {initials(p.member_name)}
                  </span>
                  <div>
                    <strong>{p.member_name}</strong>
                    <small>{p.plan_name}</small>
                    {p.voided_at && (
                      <small className="amount-red">
                        Anulado · {p.void_reason}
                      </small>
                    )}
                  </div>
                </div>
              </td>
              <td>{shortDate(p.created_at)}</td>
              <td>{p.promotion_name || "—"}</td>
              <td>{p.method === "cash" ? "Efectivo" : "Transferencia"}</td>
              <td>
                <strong>{money(p.amount_cents)}</strong>
                {p.discount_cents > 0 && (
                  <small>Descuento: {money(p.discount_cents)}</small>
                )}
              </td>
              {onVoid && (
                <td>
                  {!p.voided_at && (
                    <button className="link" onClick={() => onVoid(p)}>
                      Anular
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      icon={<CreditCard />}
      title="Todavía no hay pagos"
      text="Los cobros de cuotas aparecerán acá."
    />
  );
}
export function Choices({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="choices">
      <legend>{label}</legend>
      {items.length ? (
        items.map((item) => (
          <label className="checkbox" key={item.id}>
            <input
              type="checkbox"
              checked={value.includes(item.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, item.id]
                    : value.filter((v) => v !== item.id),
                )
              }
            />
            {item.name}
          </label>
        ))
      ) : (
        <p className="muted">No hay opciones disponibles.</p>
      )}
    </fieldset>
  );
}
