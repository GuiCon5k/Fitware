import { useState } from "react";
import {
  Download,
  TrendingUp,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
} from "lucide-react";
import { money, shortDate, exportCSV } from "./api";
import { Stat, PanelHead } from "./components";
import type { Report } from "./types";
export function Reports({
  report,
  onVoid,
  from,
  to,
  scope,
  owner,
  onFilter,
}: {
  report: Report | null;
  onVoid?: (m: Report["movements"][number]) => void;
  from: string;
  to: string;
  scope: string;
  owner: boolean;
  onFilter: (from: string, to: string, scope: string) => void;
}) {
  const [metric, setMetric] = useState<"active_members" | "income_cents">(
    "active_members",
  );
  const activities = report?.rows.filter((r) => r.kind === "Actividad") || [];
  const max = Math.max(1, ...activities.map((r) => r[metric]));
  function download() {
    if (!report) return;
    exportCSV("FITWare-balance.csv", [
      [
        "Categoría",
        "Tipo",
        "Ingresos ARS",
        "Egresos ARS",
        "Balance ARS",
        "Costo mercadería vendida ARS",
        "Socios vigentes al cierre",
        "Operaciones / unidades",
      ],
      ...report.rows.map((r) => [
        r.name,
        r.kind,
        r.income_cents / 100,
        r.expense_cents / 100,
        r.balance_cents / 100,
        r.cost_of_sales_cents / 100,
        r.active_members,
        r.transactions,
      ]),
      [
        "TOTAL",
        "",
        report.income_cents / 100,
        report.expense_cents / 100,
        report.balance_cents / 100,
        report.cost_of_sales_cents / 100,
      ],
    ]);
  }
  return (
    <>
      <section className="panel report-filters">
        <label>
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) =>
              e.target.value && onFilter(e.target.value, to, scope)
            }
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) =>
              e.target.value && onFilter(from, e.target.value, scope)
            }
          />
        </label>
        {owner && (
          <label>
            Gimnasios
            <select
              value={scope}
              onChange={(e) => onFilter(from, to, e.target.value)}
            >
              <option value="gym">Sede seleccionada</option>
              <option value="all">Todas mis sedes</option>
            </select>
          </label>
        )}
        <button className="secondary" onClick={download} disabled={!report}>
          <Download size={15} />
          Exportar balance
        </button>
      </section>
      <div className="stats three">
        <Stat
          title="Ingresos cobrados"
          value={money(report?.income_cents || 0)}
          detail="Cuotas + ventas de consumibles"
          icon={<ArrowDownLeft />}
        />
        <Stat
          title="Egresos registrados"
          value={money(report?.expense_cents || 0)}
          detail="Incluye compras de stock registradas"
          icon={<ArrowUpRight />}
        />
        <Stat
          title="Balance de caja"
          value={money(report?.balance_cents || 0)}
          detail="Ingresos menos egresos del período"
          icon={<Wallet />}
        />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <PanelHead
            title="Comparación de actividades"
            subtitle="Elegí qué querés comparar"
          />
          <div className="chart-controls">
            <button
              className={
                metric === "active_members" ? "secondary chosen" : "secondary"
              }
              onClick={() => setMetric("active_members")}
            >
              Socios vigentes
            </button>
            <button
              className={
                metric === "income_cents" ? "secondary chosen" : "secondary"
              }
              onClick={() => setMetric("income_cents")}
            >
              Ingresos cobrados
            </button>
          </div>
          <div
            className="bar-chart"
            role="img"
            aria-label={
              metric === "active_members"
                ? "Socios vigentes por actividad"
                : "Ingresos cobrados por actividad"
            }
          >
            {activities.length ? (
              activities.map((a) => (
                <div key={a.name} className="chart-row">
                  <div>
                    <span>{a.name}</span>
                    <b>
                      {metric === "income_cents" ? money(a[metric]) : a[metric]}
                    </b>
                  </div>
                  <div className="chart-track">
                    <span style={{ width: `${(a[metric] / max) * 100}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="muted">Sin actividades en este período.</p>
            )}
          </div>
          <p className="chart-caption">{report?.activity_definition}</p>
        </section>
        <section className="panel">
          <PanelHead
            title="Ingresos y egresos por día"
            subtitle="Movimientos registrados en el período"
          />
          <CashChart report={report} />
        </section>
      </div>
      <section className="panel report-table">
        <PanelHead
          title="Resumen detallado"
          subtitle="Los mismos parámetros en una sola tabla"
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>CONCEPTO</th>
                <th>TIPO</th>
                <th>SOCIOS VIGENTES</th>
                <th>OPERACIONES / UNIDADES</th>
                <th>INGRESOS</th>
                <th>EGRESOS</th>
                <th>BALANCE CAJA</th>
                <th>COSTO VENDIDO*</th>
              </tr>
            </thead>
            <tbody>
              {report?.rows.map((r) => (
                <tr key={r.kind + r.name}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.kind}</td>
                  <td>{r.kind === "Actividad" ? r.active_members : "—"}</td>
                  <td>{r.transactions}</td>
                  <td>{money(r.income_cents)}</td>
                  <td>{money(r.expense_cents)}</td>
                  <td>{money(r.balance_cents)}</td>
                  <td>
                    {r.kind === "Consumibles"
                      ? money(r.cost_of_sales_cents)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>TOTAL</td>
                <td>{money(report?.income_cents || 0)}</td>
                <td>{money(report?.expense_cents || 0)}</td>
                <td>{money(report?.balance_cents || 0)}</td>
                <td>{money(report?.cost_of_sales_cents || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="chart-caption">
          * El costo de mercadería vendida es informativo y no se resta otra vez
          del balance. La compra de stock ya figura como egreso si la
          registraste. Es un balance de movimientos, no una ganancia contable
          neta ni un saldo bancario.
        </p>
      </section>
      <section className="panel report-table">
        <PanelHead
          title="Detalle de movimientos"
          subtitle="Cuotas, ventas y egresos que componen el balance"
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>FECHA</th>
                <th>CONCEPTO</th>
                <th>TIPO</th>
                <th>MEDIO</th>
                <th>IMPORTE</th>
                {onVoid && <th>ACCIÓN</th>}
              </tr>
            </thead>
            <tbody>
              {report?.movements.map((m) => (
                <tr
                  key={m.type + m.id}
                  className={m.voided_at ? "voided-row" : ""}
                >
                  <td>{shortDate(m.created_at)}</td>
                  <td>
                    <strong>{m.description}</strong>
                    {m.voided_at && (
                      <small className="amount-red">
                        Anulado · {m.void_reason}
                      </small>
                    )}
                  </td>
                  <td>{m.type}</td>
                  <td>{m.method === "cash" ? "Efectivo" : "Transferencia"}</td>
                  <td
                    className={
                      m.type === "Egreso" ? "amount-red" : "amount-green"
                    }
                  >
                    {m.type === "Egreso" ? "−" : "+"}
                    {money(m.amount_cents)}
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
        {!report?.movements.length && (
          <p className="chart-caption">Sin movimientos en este período.</p>
        )}
      </section>
    </>
  );
}
function CashChart({ report }: { report: Report | null }) {
  const data = report?.daily || [];
  const max = Math.max(
    1,
    ...data.flatMap((d) => [d.income_cents, d.expense_cents]),
  );
  if (!data.length)
    return (
      <div className="empty">
        <TrendingUp />
        <p>Registrá movimientos para ver la evolución.</p>
      </div>
    );
  const width = 600,
    height = 200,
    pad = 20;
  const x = (i: number) =>
    pad +
    (data.length === 1
      ? (width - 2 * pad) / 2
      : (i * (width - 2 * pad)) / (data.length - 1));
  const y = (n: number) => height - pad - (n / max) * (height - 2 * pad);
  return (
    <div className="cash-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Evolución diaria de ingresos y egresos"
      >
        <title>Ingresos y egresos diarios en pesos argentinos</title>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad}
            x2={width - pad}
            y1={y(max * f)}
            y2={y(max * f)}
            stroke="#e8edde"
            strokeDasharray="4 4"
          />
        ))}
        {(["income_cents", "expense_cents"] as const).map((key, index) => (
          <g key={key}>
            <polyline
              fill="none"
              stroke={index ? "#c49b65" : "#63874d"}
              strokeWidth="3"
              points={data.map((d, i) => `${x(i)},${y(d[key])}`).join(" ")}
            />
            {data.map((d, i) => (
              <circle
                key={d.day}
                cx={x(i)}
                cy={y(d[key])}
                r={4}
                fill={index ? "#c49b65" : "#63874d"}
              >
                <title>
                  {d.day} · {index ? "Egresos" : "Ingresos"}: {money(d[key])}
                </title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="chart-legend">
        <span>● Ingresos</span>
        <span>● Egresos</span>
      </div>
      <div className="chart-range">
        <span>{shortDate(data[0].day)}</span>
        <span>Máximo: {money(max)}</span>
        <span>{shortDate(data.at(-1)!.day)}</span>
      </div>
      <p className="fine-print">
        Los días sin movimientos se omiten. El detalle exacto está en la tabla.
      </p>
    </div>
  );
}
