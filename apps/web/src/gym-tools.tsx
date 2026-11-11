import { useEffect, useRef, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, downloadApi, money, shortDate, localDay } from "./api";
import { Field, PaymentTable } from "./components";
import type { Member, Payment, Plan, User, Quote } from "./types";

export type PaymentMethod = {
  id: string;
  name: string;
  method: "cash" | "transfer";
  active: boolean;
};
export function MethodFields({
  value,
  onChange,
}: {
  value: any;
  onChange: (key: string, v: any) => void;
}) {
  const [list, setList] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    let active = true;
    api<PaymentMethod[]>("/payment-methods")
      .then((r) => {
        if (active) setList(r);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <Field label="Forma de pago">
        <select
          value={value.method_detail || value.method}
          onChange={(e) => {
            const m = list.find((m) => m.id === e.target.value);
            onChange("method_detail", m?.id || "");
            onChange("method", m?.method || e.target.value);
          }}
        >
          <option value="cash">Efectivo</option>
          <option value="transfer">Transferencia (sin especificar)</option>
          {list
            .filter((m) => m.active)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Referencia / número de operación (opcional)">
        <input
          maxLength={180}
          value={value.reference || ""}
          onChange={(e) => onChange("reference", e.target.value)}
          placeholder="Banco, comprobante o número de operación"
        />
      </Field>
    </>
  );
}
export function MethodSettings() {
  const [list, setList] = useState<PaymentMethod[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => api<PaymentMethod[]>("/payment-methods").then(setList);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await api("/payment-methods", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      await load();
      setNotice("Medio creado. Ya se puede usar en cuotas, ventas y egresos.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel tools-panel">
      <summary>Administrar formas de pago</summary>
      <p className="fine-print">
        Creá nombres específicos, por ejemplo Banco Nación o Posnet débito. Los
        medios electrónicos se agrupan fuera del efectivo en caja. El nombre
        queda guardado en cada cobro.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form className="toolbar" onSubmit={add}>
        <Field label="Nombre">
          <input
            name="name"
            maxLength={80}
            required
            placeholder="Ej. Transferencia Banco Nación"
          />
        </Field>
        <Field label="Grupo en caja">
          <select name="method">
            <option value="transfer">Electrónico / cuenta</option>
            <option value="cash">Efectivo</option>
          </select>
        </Field>
        <button className="primary" disabled={busy}>
          Agregar medio
        </button>
      </form>
      <div className="tools-list">
        {list.map((m) => (
          <div className="renewal-row" key={m.id}>
            <span>
              {m.name} · {m.method === "cash" ? "Efectivo" : "Electrónico"}
            </span>
            <button
              className="link"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api("/payment-methods/" + encodeURIComponent(m.id), {
                    method: "PUT",
                    body: JSON.stringify({ active: !m.active }),
                  });
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {m.active ? "Desactivar" : "Activar"}
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
type PaymentPage = {
  rows: Payment[];
  total: number;
  passes: number;
  charges: number;
  confirmed_cents: number;
  method_names: string[];
};
export function PaymentHistory({
  onVoid,
  revision = 0,
}: {
  payments?: Payment[];
  onVoid?: (p: Payment) => void;
  revision?: number;
}) {
  const [from, setFrom] = useState(localDay().slice(0, 7) + "-01"),
    [to, setTo] = useState(localDay()),
    [query, setQuery] = useState(""),
    [method, setMethod] = useState("all"),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [data, setData] = useState<PaymentPage | null>(null),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    let ignore = false;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api<PaymentPage>(
        `/payments/history?from=${from}&to=${to}&q=${encodeURIComponent(query)}&method_name=${encodeURIComponent(method)}&page=${page}`,
      )
        .then((r) => {
          if (!ignore) setData(r);
        })
        .catch((e) => {
          if (!ignore) setError(e.message);
        })
        .finally(() => {
          if (!ignore) setLoading(false);
        });
    }, 180);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [from, to, query, method, page, revision]);
  const changed = (fn: () => void) => {
    fn();
    setPage(1);
    setData(null);
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Historial de cuotas</h2>
          <p>
            {data?.charges || 0} cobros · {data?.passes || 0} pases ·{" "}
            {money(data?.confirmed_cents || 0)}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => {
            setError("");
            void downloadApi(
              `/payments/export.xlsx?from=${from}&to=${to}&q=${encodeURIComponent(query)}&method_name=${encodeURIComponent(method)}`,
              `FITWare-cuotas-${from}-${to}.xlsx`,
            ).catch((e) => setError(e.message));
          }}
        >
          Descargar Excel
        </button>
      </div>
      <p className="fine-print">
        Cada fila es un pase. Un combo o 2x1 comparte el mismo número de cobro;
        su descuento se reparte entre los pases. El importe es el precio final
        cobrado.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="toolbar">
        <Field label="Desde">
          <input
            type="date"
            value={from}
            onChange={(e) =>
              e.target.value && changed(() => setFrom(e.target.value))
            }
          />
        </Field>
        <Field label="Hasta">
          <input
            type="date"
            min={from}
            value={to}
            onChange={(e) =>
              e.target.value && changed(() => setTo(e.target.value))
            }
          />
        </Field>
        <Field label="Buscar socio o referencia">
          <input
            maxLength={180}
            value={query}
            onChange={(e) => changed(() => setQuery(e.target.value))}
            placeholder="Nombre, DNI, teléfono…"
          />
        </Field>
        <Field label="Medio">
          <select
            value={method}
            onChange={(e) => changed(() => setMethod(e.target.value))}
          >
            <option value="all">Todos</option>
            {[
              ...new Set([
                ...(data?.method_names || []),
                ...(method !== "all" ? [method] : []),
              ]),
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
      </div>
      {loading ? (
        <p className="chart-caption" role="status">
          Buscando cobros…
        </p>
      ) : (
        <PaymentTable payments={data?.rows || []} onVoid={onVoid} />
      )}
      <div className="pagination">
        <button
          className="secondary"
          disabled={loading || page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <span>
          {data?.total || 0} filas · página {page} de{" "}
          {Math.max(1, Math.ceil((data?.total || 0) / 50))}
        </span>
        <button
          className="secondary"
          disabled={loading || page * 50 >= (data?.total || 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
type Pending = {
  id: string;
  member_name: string;
  document: string;
  amount_cents: number;
  method_name: string;
  reference: string;
  status: string;
  verification: string;
  created_at: string;
  reason: string;
};
export function Reconciliation({
  user,
  onChanged,
  revision = 0,
}: {
  user: User;
  onChanged: () => Promise<void>;
  revision?: number;
}) {
  const [items, setItems] = useState<Pending[]>([]),
    [selected, setSelected] = useState<Pending | null>(null),
    [quote, setQuote] = useState<Quote | null>(null),
    [reason, setReason] = useState(""),
    [operation, setOperation] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false),
    [connected, setConnected] = useState(false);
  const can =
    user.role === "owner" || user.permissions.includes("payments.reconcile");
  const load = () => api<Pending[]>("/pending-payments").then(setItems);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    if (can)
      void api<{ configured: boolean }>("/gym-mercadopago")
        .then((r) => setConnected(r.configured))
        .catch(() => {});
  }, [revision]);
  async function review(p: Pending) {
    setSelected(p);
    setQuote(null);
    setError("");
    setNotice("");
    setReason("");
    setOperation("");
    setBusy(true);
    try {
      setQuote(await api<Quote>(`/pending-payments/${p.id}/quote`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(action: string) {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/pending-payments/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action,
          reason,
          provider_payment_id: operation || undefined,
          expected_total_cents: quote?.total_cents,
          expected_periods: quote?.lines.map((l) => ({
            member_id: l.member_id,
            plan_id: l.plan.id,
            starts_on: l.starts_on,
            ends_on: l.ends_on,
          })),
        }),
      });
      setSelected(null);
      await load();
      await onChanged();
      setNotice(
        action === "reject"
          ? "Pendiente rechazado. No se generó un ingreso."
          : "Cobro confirmado y pases habilitados.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel tools-panel">
      <div className="panel-head">
        <div>
          <h2>Acreditaciones pendientes</h2>
          <p>
            {items.filter((p) => p.status === "pending").length} por revisar ·
            no habilitan pases ni suman ingresos
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Actualizar
        </button>
      </div>
      <p className="fine-print">
        {connected
          ? "Mercado Pago conectado para esta sede. Verificá el número de operación y asignalo al socio correcto."
          : "Mercado Pago: falta conectar la cuenta receptora del gimnasio para verificar operaciones desde FITWare. Mientras tanto, revisá tu cuenta y registrá la confirmación manual."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label className="checkbox">
        <input
          type="checkbox"
          checked={history}
          onChange={(e) => setHistory(e.target.checked)}
        />
        Ver también los últimos 100 revisados
      </label>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Fecha / socio</th>
              <th>Medio / referencia</th>
              <th>Importe</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items
              .filter((p) => history || p.status === "pending")
              .map((p) => (
                <tr key={p.id}>
                  <td>
                    {shortDate(p.created_at)}
                    <strong>{p.member_name}</strong>
                    <small>DNI {p.document}</small>
                  </td>
                  <td>
                    {p.method_name}
                    <small>{p.reference || "Sin referencia"}</small>
                  </td>
                  <td>{money(p.amount_cents)}</td>
                  <td>
                    {p.status === "pending"
                      ? "Pendiente"
                      : p.status === "rejected"
                        ? "Rechazado"
                        : p.verification === "mercadopago"
                          ? "Verificado por MP al confirmar"
                          : "Confirmado manualmente"}
                    <small>{p.reason}</small>
                  </td>
                  <td>
                    {can && p.status === "pending" && (
                      <button className="link" onClick={() => void review(p)}>
                        Revisar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <p className="chart-caption">
          Todavía no hay transferencias informadas. Al cobrar una cuota podés
          dejarla pendiente de acreditación.
        </p>
      )}
      {selected && (
        <div className="review-box">
          <h3>Revisar pago de {selected.member_name}</h3>
          <p>
            {money(selected.amount_cents)} · {selected.method_name}
          </p>
          {quote && (
            <>
              <p>Total actual: {money(quote.total_cents)}</p>
              {quote.lines.map((l) => (
                <p key={l.member_id + l.plan.id}>
                  {l.member_name} · {l.plan.name} · {shortDate(l.starts_on!)} →{" "}
                  {shortDate(l.ends_on!)}
                </p>
              ))}
            </>
          )}
          <Field label="Constancia de la revisión">
            <input
              value={reason}
              maxLength={180}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Acreditado en Banco Nación, operación…"
            />
          </Field>
          <p className="fine-print">
            La confirmación manual registra tu revisión de la cuenta. Para
            verificar con Mercado Pago, ingresá el ID de una operación
            acreditada en la cuenta del gimnasio; comprobá también a qué socio
            pertenece.
          </p>
          {connected && (
            <Field label="Número de operación de Mercado Pago">
              <input
                inputMode="numeric"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              />
            </Field>
          )}
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setSelected(null)}
            >
              Volver
            </button>
            <button
              className="secondary"
              disabled={busy || !reason.trim()}
              onClick={() => void confirm("reject")}
            >
              Rechazar
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !quote ||
                !reason.trim() ||
                quote.total_cents !== selected.amount_cents
              }
              onClick={() => void confirm("confirm")}
            >
              Confirmar manualmente
            </button>
            {connected && (
              <button
                className="primary"
                disabled={busy || !quote || !reason.trim() || !operation}
                onClick={() => void confirm("mercadopago")}
              >
                Verificar operación MP
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
export function photoUrl(
  memberId: string,
  gymId: string,
  version?: string | null,
) {
  return `/api/member-photos/${encodeURIComponent(memberId)}?gym_id=${encodeURIComponent(gymId)}&v=${encodeURIComponent(version || "")}`;
}
export function MemberAccessTools({
  member,
  gymId,
  canEdit,
  canManage,
}: {
  member: Member;
  gymId: string;
  canEdit: boolean;
  canManage: boolean;
}) {
  const [version, setVersion] = useState(member.photo_updated_at),
    [credential, setCredential] = useState(""),
    [qr, setQr] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function upload(file?: File) {
    if (!file) return;
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setError("Usá una foto JPG o PNG de hasta 2 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`/members/${member.id}/photo`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      setVersion(new Date().toISOString());
      setNotice("Foto guardada.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function issue() {
    if (
      !window.confirm(
        "Se creará una credencial nueva y la anterior dejará de funcionar. ¿Continuar?",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ credential: string }>(
        `/members/${member.id}/credential`,
        { method: "POST" },
      );
      setCredential(r.credential);
      setQr(
        await QRCode.toDataURL(r.credential, {
          width: 320,
          margin: 2,
          errorCorrectionLevel: "M",
        }),
      );
      setNotice("Credencial renovada. Guardá el QR y entregáselo al socio.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="member-access-tools">
      <div className="photo-controls">
        {version ? (
          <img
            className="member-photo"
            src={photoUrl(member.id, gymId, version)}
            alt={`Foto de ${member.name}`}
          />
        ) : (
          <div className="member-photo photo-empty">Sin foto</div>
        )}
        {canEdit && (
          <div>
            <Field label="Foto del socio">
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="user"
                disabled={busy}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </Field>
            <small>
              JPG o PNG · hasta 2 MB. Usá una foto autorizada por el socio.
            </small>
            {version && (
              <button
                className="link"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api(`/members/${member.id}/photo`, {
                      method: "DELETE",
                    });
                    setVersion(null);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Quitar foto
              </button>
            )}
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {canManage && (
        <details>
          <summary>Credencial de ingreso QR</summary>
          <p className="fine-print">
            El socio puede guardarla en el teléfono o imprimirla. En recepción
            también podés buscarlo por DNI o nombre. No depende del envío de un
            PIN.
          </p>
          <div className="form-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void issue()}
            >
              Crear / renovar QR
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm("¿Revocar la credencial de este socio?"))
                  return;
                setBusy(true);
                setError("");
                try {
                  await api(`/members/${member.id}/credential`, {
                    method: "DELETE",
                  });
                  setQr("");
                  setCredential("");
                  setNotice("Credencial revocada.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Revocar QR
            </button>
          </div>
          {qr && (
            <div className="qr-card">
              <img src={qr} alt={`Credencial QR de ${member.name}`} />
              <strong>{member.name}</strong>
              <a
                className="secondary"
                href={qr}
                download={`FITWare-credencial-${member.document}.png`}
              >
                Guardar QR
              </a>
              <small>Credencial personal · no compartir</small>
              <code className="qr-code-text">{credential}</code>
            </div>
          )}
        </details>
      )}
    </section>
  );
}
type AccessResult = {
  member: {
    id: string;
    name: string;
    document: string;
    photo_updated_at: string | null;
  };
  allowed: boolean;
  reason: string;
  active: {
    plan_id: string;
    name: string;
    activity: string;
    ends_on: string;
  }[];
  latest: {
    plan_id: string;
    name: string;
    activity: string;
    ends_on: string;
  }[];
};
export function AccessDesk({
  members,
  plans,
  gymId,
}: {
  members: Member[];
  plans: Plan[];
  gymId: string;
}) {
  const [identifier, setIdentifier] = useState(""),
    [activity, setActivity] = useState(""),
    [result, setResult] = useState<AccessResult | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState<any[]>([]),
    [camera, setCamera] = useState(false),
    [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    lookupSeq = useRef(0),
    [key, setKey] = useState(() => crypto.randomUUID());
  const load = () => api<any[]>("/access/checkins").then(setHistory);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
    input.current?.focus();
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  async function lookup(value = identifier, area = activity) {
    const seq = ++lookupSeq.current;
    setBusy(true);
    setError("");
    setNotice("");
    setResult(null);
    setKey(crypto.randomUUID());
    try {
      const r = await api<AccessResult>("/access/lookup", {
        method: "POST",
        body: JSON.stringify({ identifier: value, activity: area }),
      });
      if (seq === lookupSeq.current) setResult(r);
    } catch (e) {
      if (seq === lookupSeq.current) setError((e as Error).message);
    } finally {
      if (seq === lookupSeq.current) setBusy(false);
    }
  }
  async function startCamera() {
    if (stream.current) stop();
    setError("");
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) {
      setError(
        "Este navegador no permite leer QR con la cámara. Usá un lector USB o buscá por DNI o nombre.",
      );
      return;
    }
    try {
      setCamera(true);
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      stream.current = media;
      if (!video.current) {
        stop();
        return;
      }
      video.current.srcObject = media;
      await video.current.play();
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!stream.current || !video.current) return;
        try {
          const codes = await detector.detect(video.current);
          if (codes[0]?.rawValue) {
            const value = codes[0].rawValue;
            stop();
            setIdentifier(value);
            void lookup(value);
            return;
          }
        } catch {
          stop();
          setError("No pudimos leer el QR. Probá con DNI o un lector USB.");
          return;
        }
        setTimeout(() => void scan(), 250);
      };
      void scan();
    } catch {
      stop();
      setError(
        "No se pudo abrir la cámara. Revisá el permiso o usá DNI o lector USB.",
      );
    }
  }
  async function checkin() {
    if (!result || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        allowed: boolean;
        reason: string;
        duplicate?: boolean;
      }>("/access/checkins", {
        method: "POST",
        body: JSON.stringify({ identifier, activity, request_key: key }),
      });
      setNotice(
        r.duplicate
          ? "El ingreso ya se registró hace menos de un minuto."
          : r.allowed
            ? "Ingreso registrado."
            : "Ingreso rechazado: " + r.reason,
      );
      setResult(null);
      setIdentifier("");
      setKey(crypto.randomUUID());
      await load();
      input.current?.focus();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel tools-panel">
        <h2>Recepción e ingresos</h2>
        <p>
          Escaneá una credencial QR con un lector USB, usá la cámara o buscá por
          DNI. La foto permite comprobar la identidad antes de registrar el
          ingreso.
        </p>
        <form
          className="toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <Field label="DNI o credencial QR">
            <input
              ref={input}
              value={identifier}
              onChange={(e) => {
                lookupSeq.current++;
                setBusy(false);
                setIdentifier(e.target.value);
                setResult(null);
              }}
              autoComplete="off"
              maxLength={180}
              required
              placeholder="DNI o lector USB…"
            />
          </Field>
          <Field label="Área de ingreso">
            <select
              value={activity}
              onChange={(e) => {
                stop();
                setActivity(e.target.value);
                setResult(null);
                setBusy(false);
                lookupSeq.current++;
              }}
            >
              <option value="">Cualquier actividad vigente</option>
              {[...new Set(plans.map((p) => p.activity))].sort().map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <button className="primary" disabled={busy}>
            Buscar
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || camera}
            onClick={() => void startCamera()}
          >
            Leer QR con cámara
          </button>
        </form>
        {camera && (
          <div>
            <video ref={video} muted playsInline className="access-camera" />
            <button className="secondary" onClick={stop}>
              Cerrar cámara
            </button>
          </div>
        )}
        <Field label="Buscar por nombre si no recuerda el DNI">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Escribí al menos dos letras…"
          />
        </Field>
        {query.trim().length >= 2 && (
          <div className="tools-list">
            {members
              .filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
              .slice(0, 10)
              .map((m) => (
                <button
                  className="secondary"
                  key={m.id}
                  disabled={busy}
                  onClick={() => {
                    setIdentifier(m.document);
                    setQuery("");
                    void lookup(m.document);
                  }}
                >
                  {m.name} · DNI {m.document}
                </button>
              ))}
          </div>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice-box" role="status">
            {notice}
          </p>
        )}
        {result && (
          <div className="access-result">
            <div>
              {result.member.photo_updated_at ? (
                <img
                  className="access-photo"
                  src={photoUrl(
                    result.member.id,
                    gymId,
                    result.member.photo_updated_at,
                  )}
                  alt={`Foto de ${result.member.name}`}
                />
              ) : (
                <div className="access-photo photo-empty">Sin foto cargada</div>
              )}
            </div>
            <div>
              <h2>{result.member.name}</h2>
              <p>DNI {result.member.document}</p>
              <strong
                className={result.allowed ? "amount-green" : "amount-red"}
              >
                {result.reason}
              </strong>
              {result.active.map((p) => (
                <p key={p.plan_id + p.ends_on}>
                  {p.activity} · {p.name} · hasta {shortDate(p.ends_on)}
                </p>
              ))}
              <button
                className="primary"
                disabled={busy}
                onClick={() => void checkin()}
              >
                {result.allowed
                  ? "Registrar ingreso"
                  : "Registrar intento rechazado"}
              </button>
            </div>
          </div>
        )}
        <p className="fine-print">
          El sistema comprueba la vigencia de los pases. El registro de
          recepción no abre un molinete; esa conexión depende del equipo
          instalado.
        </p>
      </section>
      <section className="panel tools-panel">
        <h2>Últimos 100 intentos de ingreso</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Socio</th>
                <th>Área</th>
                <th>Resultado</th>
                <th>Operador</th>
              </tr>
            </thead>
            <tbody>
              {history.map((c) => (
                <tr key={c.id}>
                  <td>
                    {shortDate(c.created_at)}
                    <small>
                      {new Date(c.created_at).toLocaleTimeString("es-AR", {
                        timeZone: "America/Argentina/Buenos_Aires",
                      })}
                    </small>
                  </td>
                  <td>
                    {c.name}
                    <small>DNI {c.document}</small>
                  </td>
                  <td>{c.activity || "Cualquier actividad"}</td>
                  <td className={c.allowed ? "amount-green" : "amount-red"}>
                    {c.allowed ? "Permitido" : "Rechazado"}
                    <small>{c.reason}</small>
                  </td>
                  <td>{c.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!history.length && <p>Los ingresos aparecerán acá.</p>}
      </section>
    </>
  );
}
type CountRow = {
  key: string;
  name: string;
  method: string;
  expected_cents: number;
  counted_cents?: number;
  difference_cents?: number;
};
type CountData = {
  day: string;
  movements_hash: string;
  rows: CountRow[];
  history: {
    id: string;
    created_at: string;
    created_by_name: string;
    opening_cents: number;
    movements_hash: string;
    reason: string;
    rows: CountRow[];
  }[];
};
export function CashCount({
  day,
  canCount,
  revision = "",
}: {
  day: string;
  canCount: boolean;
  revision?: string;
}) {
  const [data, setData] = useState<CountData | null>(null),
    [opening, setOpening] = useState("0"),
    [counts, setCounts] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(() => crypto.randomUUID());
  const load = async () => {
    setData(await api<CountData>(`/cash-counts?day=${day}`));
  };
  useEffect(() => {
    let ignore = false;
    setData(null);
    setOpening("0");
    setCounts({});
    setReason("");
    setKey(crypto.randomUUID());
    setError("");
    void api<CountData>(`/cash-counts?day=${day}`)
      .then((r) => {
        if (!ignore) setData(r);
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [day, revision]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/cash-counts", {
        method: "POST",
        body: JSON.stringify({
          day,
          opening_cents: Math.round(Number(opening) * 100),
          movements_hash: data.movements_hash,
          counts: data.rows.map((r) => ({
            key: r.key,
            counted_cents: Math.round(Number(counts[r.key]) * 100),
          })),
          reason,
          request_key: key,
        }),
      });
      await load();
      setKey(crypto.randomUUID());
      setNotice(
        "Arqueo guardado. Los movimientos posteriores requerirán una nueva revisión.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest = data?.history[0];
  return (
    <section className="panel tools-panel">
      <h2>Arqueo y conciliación del día</h2>
      <p>
        Compará lo registrado con el efectivo contado y las acreditaciones que
        revisaste en cada cuenta. Se guarda una constancia por revisión.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {latest && (
        <div className="notice-box">
          <strong>
            Último arqueo: {shortDate(latest.created_at)} ·{" "}
            {latest.created_by_name}
          </strong>
          <p>
            {latest.movements_hash === data?.movements_hash
              ? "Sin cambios en los movimientos desde ese arqueo."
              : "Los movimientos cambiaron desde el último arqueo. Revisá los importes nuevamente."}
          </p>
          <p>
            Diferencia total:{" "}
            {money(
              latest.rows.reduce((s, r) => s + (r.difference_cents || 0), 0),
            )}{" "}
            · {latest.reason || "Sin diferencias"}
          </p>
          {latest.rows.map((r) => (
            <small key={r.key}>
              {r.name}: esperado {money(r.expected_cents)} · contado{" "}
              {money(r.counted_cents || 0)} · diferencia{" "}
              {money(r.difference_cents || 0)}
            </small>
          ))}
        </div>
      )}
      <button
        className="link"
        disabled={busy}
        onClick={() => void load().catch((e) => setError(e.message))}
      >
        Actualizar movimientos para contar
      </button>
      {data && canCount && (
        <form onSubmit={save}>
          <Field label="Saldo inicial en efectivo (ARS)">
            <input
              type="number"
              min="0"
              max="10000000"
              step="0.01"
              required
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </Field>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Medio</th>
                  <th>Esperado</th>
                  <th>Contado / acreditado (ARS)</th>
                  <th>Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const expected =
                    r.expected_cents +
                    (r.key === "cash:Efectivo"
                      ? Math.round(Number(opening) * 100)
                      : 0);
                  return (
                    <tr key={r.key}>
                      <td>{r.name}</td>
                      <td>{money(expected)}</td>
                      <td>
                        <input
                          aria-label={`Contado en ${r.name}`}
                          type="number"
                          min="0"
                          max="10000000"
                          step="0.01"
                          required
                          value={counts[r.key] ?? ""}
                          onChange={(e) =>
                            setCounts((c) => ({
                              ...c,
                              [r.key]: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td>
                        {counts[r.key] !== undefined && counts[r.key] !== ""
                          ? money(
                              Math.round(Number(counts[r.key]) * 100) -
                                expected,
                            )
                          : "Sin contar"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Field label="Observaciones / explicación de diferencias">
            <input
              value={reason}
              maxLength={180}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <button
            className="primary"
            disabled={
              busy ||
              data.rows.some(
                (r) => counts[r.key] === undefined || counts[r.key] === "",
              )
            }
          >
            Guardar arqueo
          </button>
        </form>
      )}
      <p className="fine-print">
        El saldo inicial se suma a la fila Efectivo. Si creaste otros medios de
        efectivo, contalos por separado sin repetir billetes. Una revisión no
        bloquea el día ni sustituye la verificación de tu banco. Los
        comprobantes pendientes no se incluyen.
      </p>
      {!!data?.history.length && (
        <details>
          <summary>Historial de arqueos ({data.history.length})</summary>
          {data.history.map((h) => (
            <p key={h.id}>
              {shortDate(h.created_at)} · {h.created_by_name} · diferencia{" "}
              {money(h.rows.reduce((n, r) => n + (r.difference_cents || 0), 0))}{" "}
              · {h.reason || "Sin diferencias"}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
