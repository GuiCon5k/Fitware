import { MemberAccessTools } from "./gym-tools";
import { PasswordInput } from "./password-input";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Search,
  X,
  Download,
  Upload,
  Settings as SettingsIcon,
} from "lucide-react";
import { api, downloadApi, money, shortDate, localDay } from "./api";
import { Field, PanelHead } from "./components";
import type { Member, Plan, Payment, Modules } from "./types";
export function Dialog({
  title,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement;
    const get = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]",
        ) || [],
      );
    get()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) closeRef.current();
      if (e.key === "Tab") {
        const nodes = get();
        if (e.shiftKey && document.activeElement === nodes[0]) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus();
    };
  }, [busy]);
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
        aria-labelledby="tool-dialog-title"
      >
        <div className="modal-heading">
          <h2 id="tool-dialog-title">{title}</h2>
          <button
            className="icon-btn"
            aria-label="Cerrar"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function GlobalSearch({
  members,
  gymName,
  onSelect,
}: {
  members: Member[];
  gymName: string;
  onSelect: (m: Member) => void;
}) {
  const [query, setQuery] = useState(""),
    [focused, setFocused] = useState(false),
    [index, setIndex] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const matches = query.trim()
    ? members
        .filter((m) =>
          normalize(m.name + " " + m.document).includes(
            normalize(query.trim()),
          ),
        )
        .slice(0, 8)
    : [];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector('[aria-modal="true"]')
      ) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  const choose = (m: Member) => {
    onSelect(m);
    setQuery("");
    setFocused(false);
  };
  return (
    <div
      className="global-search"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setFocused(false);
      }}
    >
      <Search size={17} />
      <input
        ref={ref}
        aria-label="Buscar socio en todo el gimnasio"
        placeholder="Buscar nombre o DNI…"
        role="combobox"
        aria-expanded={focused && !!query.trim()}
        aria-controls="member-search-results"
        aria-autocomplete="list"
        aria-activedescendant={
          matches[index] ? `search-${matches[index].id}` : undefined
        }
        value={query}
        onFocus={() => setFocused(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setFocused(false);
            setQuery("");
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.max(0, Math.min(matches.length - 1, i + 1)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter" && matches[index]) {
            e.preventDefault();
            choose(matches[index]);
          }
        }}
      />
      <kbd>⌘ / Ctrl K</kbd>
      {focused && !!query.trim() && (
        <div className="search-results">
          <small>{gymName} · hasta 8 resultados</small>
          <ul
            id="member-search-results"
            role="listbox"
            aria-label="Socios encontrados"
          >
            {matches.map((m, i) => (
              <li
                key={m.id}
                id={"search-" + m.id}
                role="option"
                aria-selected={i === index}
              >
                <button
                  className={i === index ? "selected" : ""}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(m)}
                >
                  <strong>{m.name}</strong>
                  <small>DNI {m.document}</small>
                </button>
              </li>
            ))}
          </ul>
          {!matches.length && (
            <p role="status">No encontramos socios con ese nombre o DNI.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function MemberProfile({
  gymId = "",
  canManageAccess = false,
  member: m,
  plans,
  payments: initialPayments,
  status,
  canEdit,
  canPay,
  canReadPayments,
  onEdit,
  onRenew,
  onClose,
  onArchive,
}: {
  gymId?: string;
  canManageAccess?: boolean;
  member: Member;
  plans: Plan[];
  payments: Payment[];
  status: string;
  canEdit: boolean;
  canPay: boolean;
  canReadPayments: boolean;
  onEdit: () => void;
  onRenew: () => void;
  onClose: () => void;
  onArchive?: () => void;
}) {
  const [payments, setPayments] = useState(initialPayments),
    [paymentError, setPaymentError] = useState("");
  useEffect(() => {
    if (!canReadPayments || !gymId) return;
    let ignore = false;
    api<Payment[]>(`/payments?member_id=${encodeURIComponent(m.id)}`)
      .then((r) => {
        if (!ignore) setPayments(r);
      })
      .catch((e) => {
        if (!ignore) setPaymentError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [m.id, gymId, canReadPayments]);
  const day = localDay();
  const latest = payments
    .filter((p) => p.member_id === m.id && !p.voided_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const lastAmount = latest?.order_id
    ? payments
        .filter(
          (p) =>
            p.member_id === m.id &&
            p.order_id === latest.order_id &&
            !p.voided_at,
        )
        .reduce((n, p) => n + p.amount_cents, 0)
    : latest?.amount_cents || 0;
  const byPlan = new Map<string, string>();
  for (const s of m.subscriptions)
    if (!byPlan.has(s.plan_id) || byPlan.get(s.plan_id)! < s.ends_on)
      byPlan.set(s.plan_id, s.ends_on);
  const ends = [...byPlan.values()].filter((d) => d >= day).sort()[0];
  return (
    <Dialog title={m.name} onClose={onClose}>
      {gymId && (
        <MemberAccessTools
          member={m}
          gymId={gymId}
          canEdit={canEdit}
          canManage={canManageAccess}
        />
      )}
      {paymentError && (
        <p className="error" role="alert">
          No se pudo actualizar el historial: {paymentError}
        </p>
      )}
      <div className="profile-summary">
        <span className={"badge " + (status === "Activo" ? "green" : "amber")}>
          {status}
        </span>
        <p>
          <small>Próximo vencimiento</small>
          <strong>{ends ? shortDate(ends) : "Sin cuota vigente"}</strong>
        </p>
        <p>
          <small>Actividades</small>
          <strong>
            {m.plan_ids
              .map((id) => plans.find((p) => p.id === id)?.activity)
              .filter(Boolean)
              .join(" · ") || "Sin actividades elegidas"}
          </strong>
        </p>
        {canReadPayments && (
          <p>
            <small>Último pago</small>
            <strong>
              {latest
                ? money(lastAmount) + " · " + shortDate(latest.created_at)
                : "Sin pagos registrados"}
            </strong>
            {latest?.promotion_name && (
              <small>Promoción: {latest.promotion_name}</small>
            )}
            {latest?.order_id && (
              <small>Importe correspondiente a este socio.</small>
            )}
          </p>
        )}
      </div>
      <div className="form-actions">
        {canEdit && (
          <button className="secondary" onClick={onEdit}>
            Editar datos / DNI
          </button>
        )}
        {canPay && (
          <button className="primary" onClick={onRenew}>
            Renovar igual
          </button>
        )}
      </div>
      <details className="profile-details">
        <summary>Datos de contacto y emergencia</summary>
        <div className="detail-grid">
          {[
            ["DNI", m.document],
            ["Email", m.email],
            ["Teléfono", m.phone],
            ["Dirección", m.address],
            ["Contacto de emergencia", m.emergency_name],
            ["Teléfono de emergencia", m.emergency_phone],
          ].map(([label, value]) => (
            <p key={label}>
              <small>{label}</small>
              {value || "Sin cargar"}
            </p>
          ))}
        </div>
        {m.notes && <p className="notes">{m.notes}</p>}
      </details>
      <details className="profile-details">
        <summary>Historial de suscripciones</summary>
        {m.subscriptions.length ? (
          m.subscriptions.map((s) => (
            <div className="subscription-line" key={s.id}>
              <strong>
                {s.activity} · {s.plan_name}
              </strong>
              <span>
                {shortDate(s.starts_on)} → {shortDate(s.ends_on)}
              </span>
            </div>
          ))
        ) : (
          <p>Todavía no hay suscripciones.</p>
        )}
      </details>
      {onArchive && (
        <button className="danger-link" onClick={onArchive}>
          Dar de baja al socio
        </button>
      )}
    </Dialog>
  );
}
type Preview = {
  id: string;
  valid: number;
  duplicates: number;
  errors: number;
  rows: {
    row: number;
    status: string;
    errors: string[];
    member?: { name: string; document: string };
    name?: string;
    document?: string;
  }[];
};
export function ImportMembers({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<{
      imported: number;
      skipped: number;
    } | null>(null);
  async function upload(file: File) {
    setError("");
    setPreview(null);
    setResult(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("El archivo supera los 2 MB.");
      return;
    }
    setBusy(true);
    try {
      const data = await api<Preview>("/members/import/preview", {
        method: "POST",
        headers: {
          "Content-Type": file.name.toLowerCase().endsWith(".csv")
            ? "text/csv"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: file,
      });
      setPreview(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await api<{ imported: number; skipped: number }>(
        "/members/import/commit",
        { method: "POST", body: JSON.stringify({ batch_id: preview.id }) },
      );
      setResult(r);
      await onSaved(`${r.imported} socios importados`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Importar socios desde Excel" onClose={onClose} busy={busy}>
      <p>
        Descargá la plantilla, completala y revisá los datos antes de
        importarlos. Se admiten XLSX y CSV, hasta 500 socios y 2 MB. Los DNI
        existentes se omiten.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void downloadApi(
            "/members/import/template",
            "FITWare-socios.xlsx",
          ).catch((e) => setError(e.message))
        }
      >
        <Download size={16} />
        Descargar plantilla
      </button>
      <Field label="Archivo de socios">
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </Field>
      {busy && <p role="status">Procesando…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <>
          <p className="flow-hint">
            {preview.valid} válidos · {preview.duplicates} duplicados ·{" "}
            {preview.errors} con errores. Las filas inválidas se omiten y no se
            modifica ningún socio existente. Las actividades importadas quedan
            pendientes de cobro.
          </p>
          <div className="table-wrap import-preview">
            <table>
              <thead>
                <tr>
                  <th>FILA</th>
                  <th>SOCIO / DNI</th>
                  <th>RESULTADO</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    <td>
                      {r.member?.name || r.name || "—"}
                      <small>{r.member?.document || r.document}</small>
                    </td>
                    <td>
                      {r.status === "valid"
                        ? "Listo para importar"
                        : r.status === "duplicate"
                          ? "Duplicado"
                          : "Revisar"}
                      <small>{r.errors?.join(" · ")}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result && (
            <button
              className="primary"
              disabled={busy || !preview.valid}
              onClick={() => void commit()}
            >
              <Upload size={16} />
              Confirmar importación de {preview.valid} socios
            </button>
          )}
        </>
      )}
      {result && (
        <div className="flow-hint" role="status">
          Importación terminada: {result.imported} socios agregados,{" "}
          {result.skipped} omitidos.{" "}
          <button className="secondary" onClick={onClose}>
            Volver a socios
          </button>
        </div>
      )}
    </Dialog>
  );
}
export function Settings({
  modules,
  onModules,
  onNavigate,
}: {
  modules: Modules;
  onModules: (m: Modules) => Promise<void>;
  onNavigate: (page: string) => void;
}) {
  const [draft, setDraft] = useState(modules),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [backups, setBackups] = useState<
      { id: string; size_bytes: number; created_at: string }[]
    >([]);
  useEffect(() => setDraft(modules), [modules]);
  async function reload() {
    setBackups(await api("/backups"));
  }
  useEffect(() => {
    void reload().catch((e) => setError(e.message));
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await onModules(draft);
      setNotice("Configuración guardada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="panel settings-panel">
        <PanelHead
          title="Funciones de tu gimnasio"
          subtitle="Activá lo que necesitás. Los datos históricos se conservan al desactivar una función."
        />
        <form onSubmit={save}>
          {(
            [
              ["products", "Consumibles y control de stock"],
              ["promotions", "Promociones y descuentos"],
              ["multi_gym", "Múltiples gimnasios"],
            ] as const
          ).map(([key, label]) => (
            <label className="checkbox module-option" key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <button className="primary" disabled={busy}>
            <SettingsIcon size={16} />
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        </form>
      </section>
      <div className="settings-grid">
        {[
          [
            "staff",
            "Equipo y permisos",
            "Creá perfiles para recepción y entrenamiento.",
          ],
          ...(modules.multi_gym
            ? [
                [
                  "gyms",
                  "Mis gimnasios",
                  "Administrá las sedes de tu organización.",
                ],
              ]
            : []),
          ...(modules.promotions
            ? [
                [
                  "promotions",
                  "Promociones",
                  "Configurá ofertas y sus participantes.",
                ],
              ]
            : []),
          [
            "billing",
            "Mi servicio FITWare",
            "Estado de suscripción y datos de pago.",
          ],
        ].map(([page, title, description]) => (
          <button
            className="panel settings-card"
            key={page}
            onClick={() => onNavigate(page)}
          >
            <strong>{title}</strong>
            <span>{description}</span>
          </button>
        ))}
      </div>
      <section className="panel settings-panel">
        <PanelHead
          title="Copias de seguridad"
          subtitle="Respaldo automático cada 24 horas mientras el servidor está encendido."
        />
        <p>
          Descargá una copia y guardala en un lugar privado, fuera de esta
          computadora. Incluye datos personales y credenciales protegidas. La
          restauración se ejecuta con el comando indicado en el README, sobre
          una base nueva.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/backups", { method: "POST" });
              await reload();
              setNotice("Respaldo creado");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Crear respaldo ahora
        </button>
        {!backups.length && <p>Aún no hay respaldos disponibles.</p>}
        {backups.slice(0, 10).map((b) => (
          <div className="backup-row" key={b.id}>
            <span>
              {shortDate(b.created_at)} ·{" "}
              {new Date(b.created_at).toLocaleTimeString("es-AR")} ·{" "}
              {Math.ceil(b.size_bytes / 1024)} KB
            </span>
            <button
              className="link"
              onClick={() =>
                void downloadApi(
                  "/backups/" + b.id + "/download",
                  "FITWare-respaldo-" + b.id + ".json.gz",
                ).catch((e) => setError(e.message))
              }
            >
              Descargar
            </button>
          </div>
        ))}
      </section>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="flow-hint" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
export function VoidDialog({
  movement,
  onClose,
  onSaved,
}: {
  movement: { id: string; kind: string; description: string };
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title="Anular movimiento" onClose={onClose} busy={busy}>
      <p>
        <strong>{movement.description}</strong>
      </p>
      <p>
        Se conserva el historial y se excluye el importe del balance. Si es un
        cobro con varias actividades o un 2x1, se anula el cobro completo. Las
        ventas devuelven las unidades al stock.
      </p>
      <p className="fine-print">
        Esta acción corrige el registro de FITWare. La devolución del dinero se
        gestiona por separado con el socio.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api(
              "/movements/" + movement.kind + "/" + movement.id + "/void",
              { method: "POST", body: JSON.stringify({ reason }) },
            );
            await onSaved("Movimiento anulado; historial conservado");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Motivo de la anulación">
          <textarea
            value={reason}
            required
            minLength={5}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            className="primary"
            disabled={busy || reason.trim().length < 5}
          >
            {busy ? "Anulando…" : "Confirmar anulación"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function Recovery({
  token,
  onBack,
}: {
  token?: string;
  onBack: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [done, setDone] = useState(false);
  return (
    <main className="recovery-page">
      <section className="panel">
        <h1>{token ? "Elegí una nueva contraseña" : "Recuperar acceso"}</h1>
        <form
          onSubmit={async (e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const data = Object.fromEntries(new FormData(e.currentTarget));
            setBusy(true);
            setError("");
            try {
              if (token) {
                if (data.password !== data.confirm)
                  throw new Error("Las contraseñas no coinciden");
                await api("/auth/reset-password", {
                  method: "POST",
                  body: JSON.stringify({ token, password: data.password }),
                });
                setNotice(
                  "Contraseña actualizada. Ingresá con la nueva contraseña.",
                );
                setDone(true);
                history.replaceState(
                  null,
                  "",
                  location.pathname + location.search,
                );
              } else {
                const r = await api<{ delivery: string }>(
                  "/auth/forgot-password",
                  {
                    method: "POST",
                    body: JSON.stringify({ email: data.email }),
                  },
                );
                setNotice(
                  r.delivery === "local"
                    ? "Si el email está registrado, se generó el enlace en el buzón local del servidor. Pedile al administrador que revise .data/mail."
                    : "Si el email está registrado, recibirás un enlace válido por 30 minutos. Revisá también spam.",
                );
              }
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!done &&
            (token ? (
              <>
                <PasswordInput
                  label="Nueva contraseña"

                  name="password"
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                />
                <PasswordInput
                  label="Repetir contraseña"

                  name="confirm"
                  minLength={10}
                  maxLength={200}
                  autoComplete="new-password"
                  required
                />
              </>
            ) : (
              <Field label="Email de tu cuenta">
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                />
              </Field>
            ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="flow-hint" role="status">
              {notice}
            </p>
          )}
          {!done && (
            <button className="primary" disabled={busy}>
              {busy
                ? "Procesando…"
                : token
                  ? "Guardar contraseña"
                  : "Enviar enlace"}
            </button>
          )}
        </form>
        <button className="auth-switch" disabled={busy} onClick={onBack}>
          Volver a ingresar
        </button>
      </section>
    </main>
  );
}
