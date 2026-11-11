import { CashCount } from "./gym-tools";
import { useState } from "react";
import {
  Search,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Plus,
} from "lucide-react";
import { money, shortDate, exportCSV } from "./api";
import { Stat, PanelHead } from "./components";
import type { Report } from "./types";
export function Cash({
  report,
  canCount = false,
  onVoid,
  day,
  onDay,
  onPayment,
  onSale,
  onExpense,
}: {
  report: Report | null;
  canCount?: boolean;
  onVoid?: (m: Report["movements"][number]) => void;
  day: string;
  onDay: (d: string) => void;
  onPayment?: () => void;
  onSale?: () => void;
  onExpense?: () => void;
}) {
  const [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const movements = report?.movements || [];
  const net = (method: string) =>
    movements
      .filter((m) => m.method === method && !m.voided_at)
      .reduce(
        (sum, m) =>
          sum + (m.type === "Egreso" ? -m.amount_cents : m.amount_cents),
        0,
      );
  const visible = movements.filter(
    (m) =>
      (filter === "all" ||
        (filter === "income" ? m.type !== "Egreso" : m.type === "Egreso")) &&
      m.description.toLowerCase().includes(query.toLowerCase()),
  );
  function download() {
    exportCSV("FITWare-caja-" + day + ".csv", [
      ["Fecha", "Concepto", "Tipo", "Medio", "Ingreso ARS", "Egreso ARS"],
      ...visible
        .filter((m) => !m.voided_at)
        .map((m) => [
          shortDate(m.created_at),
          m.description,
          m.type,
          m.method_name || (m.method === "cash" ? "Efectivo" : "Transferencia"),
          m.type === "Egreso" ? 0 : m.amount_cents / 100,
          m.type === "Egreso" ? m.amount_cents / 100 : 0,
        ]),
    ]);
  }
  return (
    <>
      <section className="panel cash-toolbar">
        <label>
          Día de caja
          <input
            aria-label="Día de caja"
            type="date"
            value={day}
            onChange={(e) => e.target.value && onDay(e.target.value)}
          />
        </label>
        <div className="cash-actions">
          {onPayment && (
            <button className="secondary" onClick={onPayment}>
              <Plus size={15} />
              Cobrar cuota
            </button>
          )}
          {onSale && (
            <button className="secondary" onClick={onSale}>
              <Plus size={15} />
              Vender consumible
            </button>
          )}
          {onExpense && (
            <button className="secondary" onClick={onExpense}>
              <Plus size={15} />
              Registrar egreso
            </button>
          )}
        </div>
      </section>
      <div className="stats">
        <Stat
          title="Ingresos del día"
          value={money(report?.income_cents || 0)}
          detail="Cuotas y ventas cobradas"
          icon={<ArrowDownLeft />}
        />
        <Stat
          title="Egresos del día"
          value={money(report?.expense_cents || 0)}
          detail="Gastos y compras registrados"
          icon={<ArrowUpRight />}
        />
        <Stat
          title="Flujo de efectivo"
          value={money(net("cash"))}
          detail="Ingresos menos egresos en efectivo"
          icon={<Wallet />}
        />
        <Stat
          title="Flujo electrónico"
          value={money(net("transfer"))}
          detail="Transferencias, tarjetas y billeteras"
          icon={<Wallet />}
        />
      </div>
      <section className="panel">
        <PanelHead
          title="Libro de movimientos del día"
          subtitle={shortDate(day) + " · sede seleccionada"}
        />
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Buscar movimiento"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar concepto…"
            />
          </div>
          <select
            aria-label="Tipo de movimiento"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Todos los movimientos</option>
            <option value="income">Solo ingresos</option>
            <option value="expense">Solo egresos</option>
          </select>
          <button className="secondary" onClick={download}>
            <Download size={15} />
            Exportar caja
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>HORA</th>
                <th>CONCEPTO</th>
                <th>TIPO</th>
                <th>MEDIO</th>
                <th>INGRESO</th>
                <th>EGRESO</th>
                {onVoid && <th>ACCIÓN</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr
                  key={m.type + m.id}
                  className={m.voided_at ? "voided-row" : ""}
                >
                  <td>
                    {new Intl.DateTimeFormat("es-AR", {
                      timeZone: "America/Argentina/Buenos_Aires",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(m.created_at))}
                  </td>
                  <td>
                    <strong>{m.description}</strong>
                    {m.voided_at && (
                      <small className="amount-red">
                        Anulado · {m.void_reason}
                      </small>
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        "badge " + (m.type === "Egreso" ? "amber" : "green")
                      }
                    >
                      {m.type}
                    </span>
                  </td>
                  <td>
                    {m.method_name ||
                      (m.method === "cash" ? "Efectivo" : "Transferencia")}
                  </td>
                  <td className="amount-green">
                    {m.type === "Egreso" ? "—" : money(m.amount_cents)}
                  </td>
                  <td className="amount-red">
                    {m.type === "Egreso" ? money(m.amount_cents) : "—"}
                  </td>
                  {onVoid && (
                    <td>
                      {!m.voided_at && (
                        <button className="link" onClick={() => onVoid(m)}>
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
        {!visible.length && (
          <p className="chart-caption">
            No hay movimientos que coincidan con estos filtros.
          </p>
        )}
      </section>
      <CashCount
        day={day}
        canCount={canCount}
        revision={JSON.stringify(movements.map((m) => [m.id, m.voided_at]))}
      />
      <p className="fine-print">
        Caja muestra las operaciones de un día y el flujo por medio de pago.
        Para comparar períodos, actividades o sedes, usá “Resumen y balances”.
        El flujo de efectivo no incluye un saldo inicial ni representa un arqueo
        de caja.
      </p>
    </>
  );
}
