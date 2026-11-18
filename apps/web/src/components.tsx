import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { useFieldFeedback } from "./form-guidance";
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
  hint,
  error,
  action,
  checkbox = false,
  className,
}: {
  label: string;
  children: ReactElement<{
    id?: string;
    type?: string;
    placeholder?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling";
    "data-validation-field"?: string;
  }>;
  hint?: string;
  error?: string;
  action?: ReactNode;
  checkbox?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const id = children.props.id || generatedId;
  const feedback = useFieldFeedback(id);
  const message = error || feedback.message;
  const describedBy =
    [
      children.props["aria-describedby"],
      hint && id + "-hint",
      message && id + "-error",
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  const floating =
    children.type === "textarea" ||
    (children.type === "input" &&
      ![
        "date",
        "datetime-local",
        "time",
        "month",
        "week",
        "file",
        "checkbox",
        "radio",
        "color",
        "range",
      ].includes(children.props.type || "text"));
  const control = cloneElement(children, {
    id,
    "data-validation-field": "",
    "aria-describedby": describedBy,
    "aria-invalid": message ? true : children.props["aria-invalid"],
    ...(floating ? { placeholder: children.props.placeholder || " " } : {}),
  });
  const caption = (
    <label className="field-label" htmlFor={id}>
      {label}
    </label>
  );
  return (
    <div
      className={["field", checkbox && "field-checkbox", className]
        .filter(Boolean)
        .join(" ")}
    >
      {!floating && !checkbox && caption}
      <div
        className={action ? "field-control password-control" : "field-control"}
      >
        {control}
        {(floating || checkbox) && caption}
        {action}
      </div>
      {hint && (
        <small id={id + "-hint"} className="muted">
          {hint}
        </small>
      )}
      {message && (
        <small
          className="field-error"
          id={id + "-error"}
          role={error || feedback.announce ? "alert" : undefined}
        >
          {message}
        </small>
      )}
    </div>
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
  icon: ReactNode;
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
  icon: ReactNode;
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
            <th>FECHA</th>
            <th>SOCIO</th>
            <th>DNI</th>
            <th>TELÉFONO</th>
            <th>PASE</th>
            <th>PROMOCIÓN</th>
            <th>MEDIO</th>
            <th>PRECIO FINAL</th>
            {onVoid && <th>ACCIÓN</th>}
          </tr>
        </thead>
        <tbody>
          {payments.map((p) => (
            <tr key={p.id} className={p.voided_at ? "voided-row" : ""}>
              <td>{shortDate(p.created_at)}</td>
              <td>
                <div className="person">
                  <span className="member-avatar">
                    {initials(p.member_name)}
                  </span>
                  <div>
                    <strong>{p.member_name}</strong>

                    {p.voided_at && (
                      <small className="amount-red">
                        Anulado · {p.void_reason}
                      </small>
                    )}
                  </div>
                </div>
              </td>
              <td>{p.member_document || "—"}</td>
              <td>{p.member_phone || "—"}</td>
              <td>{p.plan_name}</td>
              <td>{p.promotion_name || "—"}</td>
              <td>
                {p.method_name ||
                  (p.method === "cash" ? "Efectivo" : "Transferencia")}
                <small>{p.reference}</small>
              </td>
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
  name,
  items,
  value,
  onChange,
}: {
  label: string;
  name?: string;
  items: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const id = useId();
  const { message, announce } = useFieldFeedback(id);
  return (
    <fieldset
      className="choices"
      id={id}
      name={name}
      tabIndex={-1}
      data-validation-field
      aria-invalid={message ? true : undefined}
      aria-describedby={message ? id + "-error" : undefined}
    >
      <legend>{label}</legend>
      {items.length ? (
        items.map((item) => (
          <label className="checkbox" key={item.id}>
            <input
              type="checkbox"
              value={item.id}
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
      {message && (
        <small
          className="field-error"
          id={id + "-error"}
          role={announce ? "alert" : undefined}
        >
          {message}
        </small>
      )}
    </fieldset>
  );
}
