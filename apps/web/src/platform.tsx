import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Dumbbell,
  LogOut,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { api, ApiError, shortDate } from "./api";
import { Empty, Field, Logo, initials } from "./components";
import { Form, matchPasswords } from "./form-guidance";
import { PasswordInput } from "./password-input";
import { Dialog } from "./workspace-tools";

type Session =
  | { authenticated: true; email: string }
  | { authenticated: false; setup: boolean };
type ClientStatus = "trial" | "paid" | "inactive";
type Client = {
  id: string;
  organization: string;
  name: string;
  gym_count: number;
  status: ClientStatus;
  until: string;
  created_at: string;
};
type ClientList = {
  clients: Client[];
  total: number;
  per_page: number;
  summary: { clients: number; active: number; gyms: number };
  demo: boolean;
};
type ClientDetail = Client & {
  email: string;
  phone: string;
  address: string;
  active: boolean;
  gyms: { id: string; name: string; address: string; status: ClientStatus }[];
};
const statusLabel: Record<ClientStatus, string> = {
  paid: "Activa · pagada",
  trial: "Activa · en prueba",
  inactive: "Inactiva",
};

function SubscriptionBadge({ status }: { status: ClientStatus }) {
  return (
    <span className={`platform-badge state-${status}`}>
      {statusLabel[status]}
    </span>
  );
}

function PlatformLogin({
  canSetup,
  onSession,
}: {
  canSetup: boolean;
  onSession: (session: Session) => void;
}) {
  const [setup, setSetup] = useState(canSetup);
  const [busy, setBusy] = useState(false);
  return (
    <main className="platform-auth">
      <section className="platform-auth-intro">
        <Logo />
        <div>
          <ShieldCheck size={36} aria-hidden="true" />
          <h1>Administración de FITWare</h1>
          <p>
            Consultá las organizaciones, sus gimnasios y el estado de cada
            suscripción.
          </p>
        </div>
        <a href="/" className="platform-return">
          <ArrowLeft size={16} /> Volver a FITWare
        </a>
      </section>
      <section className="platform-auth-main">
        <div className="platform-auth-form">
          <h2>
            {setup ? "Activá tu cuenta privada" : "Ingresá al panel privado"}
          </h2>
          {setup && <p>Usá el código de activación y elegí tu contraseña.</p>}
          <Form
            feedbackScope={setup}
            validate={
              setup
                ? (form) => matchPasswords(form, "password", "confirm_password")
                : undefined
            }
            onSubmit={async (form) => {
              setBusy(true);
              try {
                onSession(
                  await api<Session>(
                    setup ? "/platform/setup" : "/platform/login",
                    {
                      method: "POST",
                      body: JSON.stringify(
                        Object.fromEntries(new FormData(form)),
                      ),
                    },
                  ),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Email">
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                maxLength={254}
              />
            </Field>
            {setup && (
              <PasswordInput
                label="Código de activación"
                name="token"
                required
                maxLength={150}
                autoComplete="off"
              />
            )}
            <PasswordInput
              label="Contraseña"
              name="password"
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 14 : 1}
              maxLength={200}
              required
              hint={setup ? "Usá al menos 14 caracteres." : undefined}
            />
            {setup && (
              <PasswordInput
                label="Repetí la contraseña"
                name="confirm_password"
                autoComplete="new-password"
                minLength={14}
                maxLength={200}
                required
              />
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Procesando…" : setup ? "Activar cuenta" : "Ingresar"}{" "}
              <ArrowRight size={16} />
            </button>
          </Form>
          {canSetup && (
            <button
              type="button"
              className="auth-switch"
              disabled={busy}
              onClick={() => setSetup(!setup)}
            >
              {setup ? "Ya activé mi cuenta" : "Tengo un código de activación"}
            </button>
          )}
        </div>
      </section>
    </main>
  );
}

function ClientProfile({
  client,
  onClose,
  onExpired,
}: {
  client: Client;
  onClose: () => void;
  onExpired: () => void;
}) {
  const [data, setData] = useState<ClientDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const request = new AbortController();
    api<ClientDetail>("/platform/clients/" + encodeURIComponent(client.id), {
      signal: request.signal,
    })
      .then(setData)
      .catch((e: Error) => {
        if (request.signal.aborted) return;
        if (e instanceof ApiError && e.status === 401) onExpired();
        else setError(e.message);
      });
    return () => request.abort();
  }, [client.id, onExpired]);

  return (
    <Dialog title={client.name} onClose={onClose}>
      <div className="platform-profile-meta">
        <span>{client.organization}</span>
        <SubscriptionBadge status={client.status} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Cargando ficha del cliente…</p>}
      {data && (
        <>
          <dl className="platform-contact">
            <div>
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${data.email}`}>{data.email}</a>
              </dd>
            </div>
            <div>
              <dt>Teléfono</dt>
              <dd>
                {data.phone ? (
                  <a href={`tel:${data.phone.replace(/[^+0-9]/g, "")}`}>
                    {data.phone}
                  </a>
                ) : (
                  "Sin cargar"
                )}
              </dd>
            </div>
            <div>
              <dt>Dirección</dt>
              <dd>{data.address || "Sin cargar"}</dd>
            </div>
            <div>
              <dt>Alta en FITWare</dt>
              <dd>{shortDate(data.created_at)}</dd>
            </div>
            <div>
              <dt>
                {data.status === "inactive"
                  ? "Último vencimiento"
                  : "Vigente hasta"}
              </dt>
              <dd>{shortDate(data.until)}</dd>
            </div>
            <div>
              <dt>Acceso de la cuenta</dt>
              <dd>{data.active ? "Habilitado" : "Deshabilitado"}</dd>
            </div>
          </dl>
          <h3>Gimnasios ({data.gym_count})</h3>
          <p className="platform-hint">
            Las sedes comparten el estado del servicio de esta organización.
          </p>
          <ul className="platform-gyms">
            {data.gyms.map((gym) => (
              <li key={gym.id}>
                <span className="platform-gym-icon">
                  <Building2 size={18} aria-hidden="true" />
                </span>
                <span>
                  <strong>{gym.name}</strong>
                  {gym.address && <small>{gym.address}</small>}
                </span>
                <SubscriptionBadge status={gym.status} />
              </li>
            ))}
          </ul>
          {!data.gyms.length && <p>No hay gimnasios registrados.</p>}
        </>
      )}
    </Dialog>
  );
}

function ClientDashboard({
  session,
  onExit,
}: {
  session: Extract<Session, { authenticated: true }>;
  onExit: () => void;
}) {
  const [data, setData] = useState<ClientList | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          q: query,
          status,
          page: String(page),
        });
        api<ClientList>("/platform/clients?" + params, {
          signal: request.signal,
        })
          .then(setData)
          .catch((e: Error) => {
            if (request.signal.aborted) return;
            if (e instanceof ApiError && e.status === 401) onExit();
            else setError(e.message);
          })
          .finally(() => {
            if (!request.signal.aborted) setLoading(false);
          });
      },
      query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      request.abort();
    };
  }, [query, status, page, revision, onExit]);

  async function action(endpoint: "demo" | "logout") {
    setWorking(true);
    setError("");
    try {
      await api("/platform/" + endpoint, { method: "POST" });
      if (endpoint === "demo") location.assign("/demo");
      else onExit();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onExit();
      else setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.per_page)) : 1;
  return (
    <div className="platform-page">
      <header className="platform-header">
        <Logo />
        <div className="platform-header-actions">
          <span title={session.email}>{session.email}</span>
          <button
            className="secondary"
            disabled={working}
            onClick={() => void action("logout")}
          >
            <LogOut size={16} /> Salir
          </button>
        </div>
      </header>
      <main className="platform-content">
        <section className="platform-hero">
          <div>
            <h1>Clientes de FITWare</h1>
            <p>Consultá suscripciones, gimnasios y contactos.</p>
          </div>
          {data?.demo && (
            <button
              className="platform-demo-button"
              disabled={working}
              onClick={() => void action("demo")}
            >
              <Dumbbell size={17} /> Abrir gimnasio demo{" "}
              <ArrowRight size={16} />
            </button>
          )}
        </section>
        {data && (
          <section className="platform-stats" aria-label="Resumen de clientes">
            <div>
              <UsersRound size={22} aria-hidden="true" />
              <span>Organizaciones</span>
              <strong>{data.summary.clients}</strong>
            </div>
            <div>
              <CircleCheck size={22} aria-hidden="true" />
              <span>Suscripciones activas</span>
              <strong>{data.summary.active}</strong>
            </div>
            <div>
              <Building2 size={22} aria-hidden="true" />
              <span>Gimnasios registrados</span>
              <strong>{data.summary.gyms}</strong>
            </div>
          </section>
        )}
        <section className="platform-directory" aria-busy={loading}>
          <div className="platform-directory-head">
            <h2>Directorio de clientes</h2>
            <div className="platform-filters">
              <Field label="Buscar por nombre, organización o gimnasio">
                <input
                  type="search"
                  value={query}
                  maxLength={180}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Field label="Estado de suscripción">
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Todos los estados</option>
                  <option value="active">Activas</option>
                  <option value="inactive">Inactivas</option>
                </select>
              </Field>
            </div>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}{" "}
              <button onClick={() => setRevision((value) => value + 1)}>
                Volver a cargar
              </button>
            </p>
          )}
          {!data && loading && (
            <p className="platform-loading" role="status">
              Cargando clientes…
            </p>
          )}
          {data &&
            (data.clients.length ? (
              <>
                <div className="platform-table-header" aria-hidden="true">
                  <span>Cliente</span>
                  <span>Estado de suscripción</span>
                  <span>Gimnasios</span>
                  <span />
                </div>
                <ul className="platform-clients">
                  {data.clients.map((entry) => (
                    <li key={entry.id}>
                      <button
                        className="platform-client"
                        onClick={() => setClient(entry)}
                        aria-label={`Ver ficha de ${entry.name}`}
                      >
                        <span className="platform-client-identity">
                          <span
                            className="platform-initials"
                            aria-hidden="true"
                          >
                            {initials(entry.name)}
                          </span>
                          <span>
                            <strong>{entry.name}</strong>
                            <small>{entry.organization}</small>
                          </span>
                        </span>
                        <SubscriptionBadge status={entry.status} />
                        <span className="platform-gym-count">
                          {entry.gym_count}
                          <span>
                            {" "}
                            {entry.gym_count === 1 ? "gimnasio" : "gimnasios"}
                          </span>
                        </span>
                        <ChevronRight
                          className="platform-client-arrow"
                          size={18}
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
                {pages > 1 && (
                  <div
                    className="platform-pagination"
                    aria-label="Paginación de clientes"
                  >
                    <button
                      className="secondary"
                      disabled={loading || page === 1}
                      onClick={() => setPage(page - 1)}
                    >
                      <ChevronLeft size={16} /> Anterior
                    </button>
                    <span>
                      {page} de {pages}
                    </span>
                    <button
                      className="secondary"
                      disabled={loading || page === pages}
                      onClick={() => setPage(page + 1)}
                    >
                      Siguiente <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </>
            ) : (
              !loading && (
                <Empty
                  icon={<UsersRound />}
                  title={
                    query || status !== "all"
                      ? "No hay coincidencias"
                      : "Todavía no hay clientes"
                  }
                  text={
                    query || status !== "all"
                      ? "Probá con otro nombre o estado."
                      : "Las organizaciones aparecerán cuando creen su cuenta."
                  }
                />
              )
            ))}
        </section>
      </main>
      {client && (
        <ClientProfile
          key={client.id}
          client={client}
          onClose={() => setClient(null)}
          onExpired={onExit}
        />
      )}
    </div>
  );
}

export function Platform() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setError("");
    api<Session>("/platform/me")
      .then(setSession)
      .catch((e: Error) => setError(e.message));
  }, [revision]);
  const exit = useCallback(
    () => setSession({ authenticated: false, setup: false }),
    [],
  );
  if (error)
    return (
      <main className="boot">
        <p className="error" role="alert">
          {error}
        </p>
        <button
          className="secondary"
          onClick={() => setRevision((value) => value + 1)}
        >
          Volver a intentar
        </button>
      </main>
    );
  if (!session)
    return (
      <main className="boot">
        <p role="status">Cargando panel privado…</p>
      </main>
    );
  return session.authenticated ? (
    <ClientDashboard session={session} onExit={exit} />
  ) : (
    <PlatformLogin canSetup={session.setup} onSession={setSession} />
  );
}
