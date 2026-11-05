import { useEffect, useState } from "react";
import { ShieldCheck, Copy, RefreshCw } from "lucide-react";
import { api, money, shortDate } from "./api";
import type { Billing, ServiceQuote } from "./types";
export function BillingPanel({
  billing,
  onRefresh,
}: {
  billing: Billing | null;
  onRefresh: () => Promise<void>;
}) {
  const [quote, setQuote] = useState<ServiceQuote | null>(null),
    [busy, setBusy] = useState(false),
    [paying, setPaying] = useState(false),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(""),
    [now, setNow] = useState(Date.now());
  async function refreshQuote() {
    setBusy(true);
    setError("");
    setQuote(null);
    try {
      setQuote(await api<ServiceQuote>("/billing/quote", { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refreshQuote();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const expired = !!quote && Date.parse(quote.expires_at) <= now;
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label + " copiado");
    } catch {
      setCopied("Seleccioná y copiá el dato manualmente");
    }
  }
  return (
    <section className="panel billing-panel">
      <span className="eyebrow">SUSCRIPCIÓN DE TU ORGANIZACIÓN</span>
      <h2>Todo tu gimnasio. Y los que vengan.</h2>
      <p className="muted">{billing?.account_name} · todas tus sedes.</p>
      <div className="plan-price">
        USD 15<small> / mes calendario</small>
      </div>
      <div className="payee-card">
        <h3>Destinatario del servicio</h3>
        <div>
          <span>Alias de Mercado Pago</span>
          <strong>{billing?.recipient.alias || "Guicon"}</strong>
          <button
            className="icon-btn"
            aria-label="Copiar alias"
            onClick={() =>
              void copy(billing?.recipient.alias || "Guicon", "Alias")
            }
          >
            <Copy size={15} />
          </button>
        </div>
        <div>
          <span>CVU</span>
          <strong className="cvu">
            {billing?.recipient.cvu || "0000003100084706675067"}
          </strong>
          <button
            className="icon-btn"
            aria-label="Copiar CVU"
            onClick={() =>
              void copy(
                billing?.recipient.cvu || "0000003100084706675067",
                "CVU",
              )
            }
          >
            <Copy size={15} />
          </button>
        </div>
        <small>
          {billing?.recipient.verification ||
            "Datos informados por el prestador. Verificá el titular en Mercado Pago."}
        </small>
        {copied && (
          <p role="status" className="fine-print">
            {copied}
          </p>
        )}
      </div>
      <div className="service-quote">
        <h3>Pago en pesos argentinos</h3>
        {busy ? (
          <p>Cargando cotización…</p>
        ) : quote ? (
          <>
            <div>
              <span>Precio del servicio</span>
              <b>USD {(quote.usd_cents / 100).toFixed(2)}</b>
            </div>
            <div>
              <span>Conversión USD → ARS</span>
              <b>{money(quote.rate)} por USD</b>
            </div>
            <p className="fine-print">
              {quote.source}
              <br />
              Actualizada:{" "}
              {new Date(quote.rate_as_of).toLocaleString("es-AR", {
                timeZone: "America/Argentina/Buenos_Aires",
              })}
            </p>
            <div className="quote-total">
              <span>Total a pagar en Mercado Pago</span>
              <strong>{money(quote.ars_cents)}</strong>
            </div>
            <p className={expired ? "error" : "fine-print"}>
              {expired
                ? "Esta cotización venció. Actualizala antes de pagar."
                : `Importe válido hasta las ${new Date(quote.expires_at).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}. El próximo mes se vuelve a convertir USD 15.`}
            </p>
          </>
        ) : (
          <p className="muted">
            El importe en pesos aparecerá cuando pueda consultarse una
            cotización vigente.
          </p>
        )}
        <button
          className="secondary"
          onClick={() => void refreshQuote()}
          disabled={busy || paying}
        >
          <RefreshCw size={15} />
          Actualizar cotización
        </button>
      </div>
      {error && (
        <div role="alert" className="error">
          {error}
        </div>
      )}
      <div className="billing-state">
        <ShieldCheck />
        <div>
          <strong>
            {!billing?.enabled
              ? "Modo local"
              : billing.active
                ? billing.paid
                  ? "Servicio habilitado"
                  : "Prueba de 14 días"
                : "Renovación pendiente"}
          </strong>
          <p>
            {billing?.enabled
              ? `Hasta ${shortDate(billing.until)} · vencimiento exclusivo`
              : "El bloqueo por falta de pago todavía no está activado."}
          </p>
        </div>
      </div>
      <button
        className="primary"
        disabled={!billing?.configured || !quote || expired || busy || paying}
        onClick={async () => {
          if (!quote) return;
          setPaying(true);
          setError("");
          try {
            const result = await api<{ url: string }>("/billing/checkout", {
              method: "POST",
              body: JSON.stringify({ quote_id: quote.id }),
            });
            window.location.assign(result.url);
          } catch (e) {
            setError((e as Error).message);
            setPaying(false);
          }
        }}
      >
        {paying
          ? "Preparando pago…"
          : quote
            ? `Pagar ${money(quote.ars_cents)} con Mercado Pago`
            : "Pagar con Mercado Pago"}
      </button>
      <button
        className="secondary billing-refresh"
        onClick={() => void onRefresh().catch((e) => setError(e.message))}
      >
        Actualizar estado
      </button>
      <p className="fine-print">
        El alias y el CVU identifican el destino informado. Una transferencia
        directa a esos datos no habilita automáticamente el servicio: esa
        confirmación necesita la integración con la cuenta receptora. El botón
        de pago se habilita cuando se configuren las credenciales de esa cuenta
        y un despliegue HTTPS.
      </p>
      <p className="fine-print">
        Renovación mensual manual, sin débito automático. La conversión usa
        dólar oficial vendedor a través de DolarAPI. Si falta una cotización
        reciente, no se genera un cobro estimado.
      </p>
      <h3>Pagos del servicio</h3>
      {billing?.receipts.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PAGO</th>
                <th>PERÍODO</th>
                <th>ESTADO</th>
              </tr>
            </thead>
            <tbody>
              {billing.receipts.map((r) => (
                <tr key={r.payment_id}>
                  <td>{r.payment_id}</td>
                  <td>
                    {shortDate(r.starts_on)} → {shortDate(r.ends_on)}
                  </td>
                  <td>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Todavía no hay pagos del servicio.</p>
      )}
    </section>
  );
}
