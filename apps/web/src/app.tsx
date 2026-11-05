import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowDownLeft,
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  Dumbbell,
  LayoutDashboard,
  LogOut,
  Plus,
  Users,
  Wallet,
  Menu,
  Search,
  Building2,
  ShoppingBag,
  Tags,
  BarChart3,
  UserRound,
  ShieldCheck,
  Download,
  Settings as SettingsIcon,
} from "lucide-react";
import { api, setGym, money, shortDate, localDay, exportCSV } from "./api";
import type {
  User,
  Modules,
  VoidTarget,
  Gym,
  Member,
  Plan,
  Payment,
  Product,
  Promotion,
  Staff,
  Billing,
  Dashboard,
  Report,
} from "./types";
import {
  Logo,
  Stat,
  PanelHead,
  Empty,
  Field,
  PaymentTable,
  initials,
} from "./components";
import { EditorModal, permissionLabels, type Editor } from "./editor";
import { Reports } from "./reports";
import { Cash } from "./cash";
import { BillingPanel } from "./billing-panel";
import {
  GlobalSearch,
  MemberProfile,
  ImportMembers,
  Settings,
  VoidDialog,
  Recovery,
} from "./workspace-tools";
type Page =
  | "dashboard"
  | "members"
  | "plans"
  | "payments"
  | "products"
  | "promotions"
  | "reports"
  | "cash"
  | "staff"
  | "gyms"
  | "profile"
  | "billing"
  | "settings";
const titles: Record<Page, string> = {
  dashboard: "Tu gimnasio, al día.",
  members: "Socios",
  plans: "Planes y actividades",
  payments: "Pagos y suscripciones",
  products: "Consumibles",
  promotions: "Promociones",
  reports: "Resumen y balances",
  cash: "Caja y movimientos",
  staff: "Mi equipo",
  gyms: "Mis gimnasios",
  profile: "Mi perfil",
  billing: "Mi servicio FITWare",
  settings: "Configuración",
};
const roleNames = {
  owner: "Dueño",
  receptionist: "Recepcionista",
  trainer: "Entrenador",
};
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [page, setPage] = useState<Page>("dashboard"),
    [gyms, setGyms] = useState<Gym[]>([]),
    [gymId, setGymId] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
    [plans, setPlans] = useState<Plan[]>([]),
    [payments, setPayments] = useState<Payment[]>([]),
    [products, setProducts] = useState<Product[]>([]),
    [promotions, setPromotions] = useState<Promotion[]>([]),
    [staff, setStaff] = useState<Staff[]>([]),
    [billing, setBilling] = useState<Billing | null>(null),
    [dashboard, setDashboard] = useState<Dashboard | null>(null),
    [report, setReport] = useState<Report | null>(null),
    [editor, setEditor] = useState<Editor | null>(null),
    [detail, setDetail] = useState<Member | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(false),
    [menu, setMenu] = useState(false),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("all"),
    [activity, setActivity] = useState("all"),
    [from, setFrom] = useState(localDay().slice(0, 7) + "-01"),
    [to, setTo] = useState(localDay()),
    [scope, setScope] = useState("gym"),
    [cashDay, setCashDay] = useState(localDay()),
    [modules, setModules] = useState<Modules | null>(null),
    [importing, setImporting] = useState(false),
    [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null),
    [resetToken, setResetToken] = useState(
      () => new URLSearchParams(location.hash.slice(1)).get("reset") || "",
    );
  const sequence = useRef(0);
  const owner = user?.role === "owner";
  const allowed = (p: string) =>
    !!user && (user.role === "owner" || user.permissions.includes(p));
  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setChecking(false));
    const expired = () => {
      sequence.current++;
      setStaff([]);
      setBilling(null);
      setGyms([]);
      setPlans([]);
      setProducts([]);
      setPromotions([]);
      setDashboard(null);
      setReport(null);
      setUser(null);
      setEditor(null);
      setDetail(null);
      setGym("");
      setGymId("");
      setMembers([]);
      setPayments([]);
      setError("La sesión venció. Volvé a ingresar.");
    };
    window.addEventListener("session-expired", expired);
    return () => window.removeEventListener("session-expired", expired);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function context() {
    if (!user) return;
    const [list, settings] = await Promise.all([
      api<Gym[]>("/gyms"),
      api<{ modules: Modules }>("/settings"),
    ]);
    setModules((prev) =>
      JSON.stringify(prev) === JSON.stringify(settings.modules)
        ? prev
        : settings.modules,
    );
    setGyms(list);
    const valid = list.find((g) => g.id === gymId) || list[0];
    setGym(valid?.id || "");
    setGymId(valid?.id || "");
    if (owner) {
      setBilling(await api<Billing>("/billing"));
      try {
        setStaff(await api<Staff[]>("/staff"));
      } catch {
        setStaff([]);
      }
    }
  }
  useEffect(() => {
    if (user) {
      setError("");
      void context().catch((e) => setError(e.message));
    }
  }, [user]);
  async function load() {
    if (!user || !gymId || !modules) return;
    const seq = ++sequence.current;
    setLoading(true);
    try {
      setGym(gymId);
      const [m, p, pa, pr, pro, d] = await Promise.all([
        allowed("members.read") ? api<Member[]>("/members") : [],
        allowed("plans.read") ? api<Plan[]>("/plans") : [],
        allowed("payments.read") ? api<Payment[]>("/payments") : [],
        modules.products && allowed("products.read")
          ? api<Product[]>("/products")
          : [],
        modules.promotions && allowed("plans.read")
          ? api<Promotion[]>("/promotions")
          : [],
        allowed("members.read") ? api<Dashboard>("/dashboard") : null,
      ]);
      if (seq !== sequence.current) return;
      setMembers(m);
      setPlans(p);
      setPayments(pa);
      setProducts(pr);
      setPromotions(pro);
      setDashboard(d);
      setError("");
    } catch (e) {
      if (seq === sequence.current) setError((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    setMembers([]);
    setPlans([]);
    setPayments([]);
    setProducts([]);
    setPromotions([]);
    setDashboard(null);
    setReport(null);
    setDetail(null);
    setEditor(null);
    if (gymId) void load();
    setImporting(false);
    setVoidTarget(null);
  }, [gymId, user, modules]);
  useEffect(() => {
    if (
      !user ||
      !gymId ||
      !allowed("reports.read") ||
      !["reports", "cash"].includes(page)
    )
      return;
    let ignore = false;
    setReport(null);
    const start = page === "cash" ? cashDay : from,
      end = page === "cash" ? cashDay : to;
    api<Report>(
      `/reports?from=${start}&to=${end}&scope=${page === "cash" ? "gym" : scope}`,
    )
      .then((r) => {
        if (!ignore) setReport(r);
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [user, gymId, page, from, to, scope, notice, cashDay]);
  const navigate = (next: Page) => {
    setPage(next);
    setMenu(false);
    setSearch("");
    setStatus("all");
    setActivity("all");
    setError("");
    setDetail(null);
    setImporting(false);
    setVoidTarget(null);
  };
  const closeEditor = useCallback(() => setEditor(null), []);
  const open = (next: Editor) => {
    setDetail(null);
    setError("");
    if (next.kind === "promotion" && next.item?.discount_type === "fixed")
      next = { ...next, item: { ...next.item, value: next.item.value / 100 } };
    setEditor(next);
  };
  async function saved(message: string) {
    setNotice(message);
    try {
      const next = await api<User>("/auth/me");
      setUser((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      await context();
      await load();
    } catch (e) {
      setError(
        "Los cambios se guardaron, pero no se pudo actualizar la pantalla. " +
          (e as Error).message,
      );
    }
  }
  async function renew(member: Member) {
    try {
      const item = await api("/members/" + member.id + "/renewal");
      open({ kind: "payment", item });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const onVoid = allowed("movements.void")
    ? (m: Report["movements"][number]) => {
        if (m.gym_id && m.gym_id !== gymId) {
          setError("Seleccioná la sede del movimiento para anularlo.");
          return;
        }
        setVoidTarget({
          id: m.id,
          kind:
            m.type === "Cuota"
              ? "payment"
              : m.type === "Venta"
                ? "sale"
                : "expense",
          description: m.description,
        });
      }
    : undefined;
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      sequence.current++;
      setUser(null);
      setGym("");
      setGymId("");
      setGyms([]);
      setStaff([]);
      setPlans([]);
      setProducts([]);
      setPromotions([]);
      setMembers([]);
      setPayments([]);
      setBilling(null);
      setReport(null);
      setPage("dashboard");
      setModules(null);
      setImporting(false);
      setVoidTarget(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const day = dashboard?.day || localDay();
  const activeSubs = (m: Member) =>
    m.subscriptions.filter((s) => s.starts_on <= day && s.ends_on > day);
  const memberStatus = (m: Member) =>
    activeSubs(m).length
      ? "Activo"
      : m.subscriptions.some((s) => s.starts_on > day)
        ? "Programado"
        : m.subscriptions.length
          ? "Vencido"
          : "Sin cuota";
  const expiring = dashboard?.upcoming || [];
  if (checking)
    return (
      <div className="boot">
        <Dumbbell />
        <p>Cargando FITWare…</p>
      </div>
    );
  if (resetToken)
    return (
      <Recovery
        token={resetToken}
        onBack={() => {
          history.replaceState(null, "", location.pathname + location.search);
          setResetToken("");
          setUser(null);
          setGymId("");
          setGym("");
        }}
      />
    );
  if (!user)
    return (
      <Auth
        onLogin={(u) => {
          setGymId("");
          setGym("");
          setUser(u);
        }}
        initialError={error}
      />
    );
  const nav = [
    {
      id: "dashboard",
      icon: LayoutDashboard,
      label: "Resumen",
      show: allowed("members.read"),
    },
    {
      id: "members",
      icon: Users,
      label: "Socios",
      show: allowed("members.read"),
    },
    {
      id: "plans",
      icon: Dumbbell,
      label: "Planes y actividades",
      show: allowed("plans.read"),
    },
    {
      id: "payments",
      icon: CreditCard,
      label: "Pagos y suscripciones",
      show: allowed("payments.read") || allowed("payments.write"),
    },
    {
      id: "products",
      icon: ShoppingBag,
      label: "Consumibles",
      show: !!modules?.products && allowed("products.read"),
    },
    {
      id: "promotions",
      icon: Tags,
      label: "Promociones",
      show: false,
    },
    {
      id: "cash",
      icon: Wallet,
      label: "Caja y movimientos",
      show: allowed("reports.read"),
    },
    {
      id: "reports",
      icon: BarChart3,
      label: "Resumen y balances",
      show: allowed("reports.read"),
    },
    { id: "staff", icon: Users, label: "Mi equipo", show: false },
    { id: "gyms", icon: Building2, label: "Mis gimnasios", show: false },
    { id: "profile", icon: UserRound, label: "Mi perfil", show: true },
    {
      id: "billing",
      icon: ShieldCheck,
      label: "Mi servicio FITWare",
      show: false,
    },
    { id: "settings", icon: SettingsIcon, label: "Configuración", show: owner },
  ];
  const filtered = members.filter(
    (m) =>
      `${m.name} ${m.document} ${m.email}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (status === "all" || memberStatus(m) === status) &&
      (activity === "all" ||
        m.plan_ids.some(
          (id) => plans.find((p) => p.id === id)?.activity === activity,
        )),
  );
  const actions: Partial<
    Record<Page, { label: string; kind: Editor["kind"]; show: boolean }>
  > = {
    dashboard: {
      label: "Registrar pago",
      kind: "payment",
      show: allowed("payments.write"),
    },
    members: {
      label: "Nuevo socio",
      kind: "member",
      show: allowed("members.write"),
    },
    plans: { label: "Nuevo plan", kind: "plan", show: allowed("plans.manage") },
    payments: {
      label: "Registrar pago",
      kind: "payment",
      show: allowed("payments.write"),
    },
    products: {
      label: "Nuevo consumible",
      kind: "product",
      show: allowed("products.manage"),
    },
    promotions: {
      label: "Nueva promoción",
      kind: "promotion",
      show: false,
    },
    staff: { label: "Nuevo empleado", kind: "staff", show: !!owner },
    gyms: {
      label: "Nuevo gimnasio",
      kind: "gym",
      show: !!owner && !!modules?.multi_gym,
    },
    profile: { label: "Editar mi perfil", kind: "profile", show: true },
    cash: {
      label: "Registrar egreso",
      kind: "expense",
      show: allowed("expenses.write"),
    },
    reports: {
      label: "Registrar egreso",
      kind: "expense",
      show: allowed("expenses.write"),
    },
  };
  const action = actions[page];
  const activeGym = gyms.find((g) => g.id === gymId);
  return (
    <div className="app">
      <aside className={menu ? "sidebar show" : "sidebar"}>
        <Logo />
        <label className="gym-select">
          <span>GIMNASIO ACTIVO</span>
          <select
            aria-label="Seleccionar gimnasio"
            value={gymId}
            onChange={(e) => {
              sequence.current++;
              setGym(e.target.value);
              setGymId(e.target.value);
            }}
          >
            {gyms.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <span className="nav-caption">ESPACIO DE TRABAJO</span>
        <nav>
          {nav
            .filter((n) => n.show)
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? "nav-item selected" : "nav-item"}
                onClick={() => navigate(n.id as Page)}
              >
                <n.icon size={18} />
                {n.label}
                {page === n.id && <span className="nav-dot" />}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile">
            <button
              className="avatar"
              onClick={() => navigate("profile")}
              aria-label="Abrir mi perfil"
            >
              {initials(user.name)}
            </button>
            <div>
              {user.name}
              <small>{roleNames[user.role]}</small>
            </div>
            <button
              aria-label="Cerrar sesión"
              className="icon-btn"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="backdrop"
          aria-label="Cerrar menú"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-btn mobile-menu"
            aria-label="Abrir menú"
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <span>
            {activeGym?.name || "Mi cuenta"}
            <ChevronRight size={14} />
            <b>{page === "dashboard" ? "Resumen" : titles[page]}</b>
          </span>
          {allowed("members.read") && (
            <GlobalSearch
              key={gymId}
              members={members}
              gymName={activeGym?.name || "Mi gimnasio"}
              onSelect={setDetail}
            />
          )}
          <button
            className="profile-shortcut"
            onClick={() => navigate("profile")}
          >
            <UserRound size={16} />
            {user.name}
          </button>
        </header>
        <main className="content" aria-busy={loading}>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {owner ? "TU ORGANIZACIÓN" : "MI ESPACIO DE TRABAJO"}
              </span>
              <h1>{titles[page]}</h1>
              <p>
                {page === "dashboard"
                  ? "Cada socio cuenta. Cada movimiento, también."
                  : page === "billing"
                    ? "La suscripción de tu organización es independiente de las cuotas de tus socios."
                    : `${activeGym?.name || "Mi cuenta"} · ${roleNames[user.role]}`}
              </p>
            </div>
            {action?.show && (
              <button
                className="primary"
                onClick={() => open({ kind: action.kind })}
              >
                <Plus size={17} />
                {action.label}
              </button>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              {!error.includes("venció") && (
                <button onClick={() => void load()}>Reintentar</button>
              )}
              {owner && error.includes("venció") && (
                <button onClick={() => navigate("billing")}>
                  Renovar servicio
                </button>
              )}
            </div>
          )}
          {billing && owner && page !== "billing" && (
            <div className="service-strip">
              <ShieldCheck size={15} />
              {billing.enabled
                ? billing.active
                  ? `${billing.paid ? "Servicio activo" : "Período de prueba"} hasta ${shortDate(billing.until)}`
                  : "Servicio vencido"
                : "Modo local · cobro del servicio sin activar"}
              <button className="link" onClick={() => navigate("billing")}>
                Ver mi servicio
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          {page === "settings" && owner && modules && (
            <Settings
              modules={modules}
              onNavigate={(p) => navigate(p as Page)}
              onModules={async (m) => {
                const r = await api<{ modules: Modules }>("/settings", {
                  method: "PUT",
                  body: JSON.stringify({ modules: m }),
                });
                setModules(r.modules);
              }}
            />
          )}
          {page === "dashboard" && allowed("members.read") && (
            <>
              <div className="date-line">
                <CalendarDays size={16} />
                {shortDate(day)} · {activeGym?.name}
              </div>
              <div className="stats">
                <Stat
                  title="Socios activos"
                  value={String(dashboard?.active || 0)}
                  detail={`${dashboard?.members || 0} socios registrados`}
                  icon={<Users />}
                />
                <Stat
                  title="Ingresos del mes"
                  value={
                    allowed("payments.read")
                      ? money(dashboard?.month_income || 0)
                      : "Restringido"
                  }
                  detail="Cuotas + consumibles"
                  icon={<Wallet />}
                />
                <Stat
                  title="Ingresos de hoy"
                  value={
                    allowed("payments.read")
                      ? money(dashboard?.today_income || 0)
                      : "Restringido"
                  }
                  detail="Cobros y ventas registrados"
                  icon={<ArrowDownLeft />}
                />
                <Stat
                  title="Por vencer"
                  value={String(expiring.length)}
                  detail="Próximos 7 días"
                  icon={<CalendarDays />}
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <PanelHead
                    title="Últimos pagos de cuotas"
                    subtitle="El pulso de tu gimnasio"
                    action={allowed("payments.read") ? "Ver todos" : undefined}
                    onClick={() => navigate("payments")}
                  />
                  {allowed("payments.read") ? (
                    <PaymentTable payments={payments.slice(0, 5)} />
                  ) : (
                    <p className="chart-caption">
                      Tu perfil no tiene acceso al historial de cobros.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <PanelHead
                    title="Próximos vencimientos"
                    subtitle="Anticipate a las renovaciones"
                  />
                  {expiring.length ? (
                    expiring.slice(0, 8).map((s) => (
                      <div
                        className="renewal-row"
                        key={s.member_id + s.activity + s.plan_name}
                      >
                        <button
                          className="link"
                          onClick={() => {
                            const m = members.find((m) => m.id === s.member_id);
                            if (m) setDetail(m);
                          }}
                        >
                          {s.name}
                        </button>
                        <div>
                          <small>
                            {s.activity} · {shortDate(s.ends_on)}
                          </small>
                        </div>
                        {allowed("payments.write") && (
                          <button
                            className="secondary"
                            onClick={() => {
                              const m = members.find(
                                (m) => m.id === s.member_id,
                              );
                              if (m) void renew(m);
                            }}
                          >
                            Renovar igual
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <Empty
                      icon={<CalendarDays />}
                      title="Todo al día"
                      text="No hay cuotas por vencer en los próximos 7 días."
                    />
                  )}
                </section>
              </div>
              {!!dashboard?.low_stock?.length && (
                <section className="panel low-stock-panel">
                  <PanelHead
                    title="Stock por reponer"
                    subtitle="Productos que llegaron al mínimo configurado"
                  />
                  {dashboard.low_stock.map((p) => (
                    <div className="renewal-row" key={p.id}>
                      <div>
                        <strong>{p.name}</strong>
                        <small>
                          {p.stock} disponibles · mínimo {p.low_stock_threshold}
                        </small>
                      </div>
                      {allowed("products.manage") && (
                        <button
                          className="secondary"
                          onClick={() => {
                            const product = products.find(
                              (item) => item.id === p.id,
                            );
                            if (product)
                              open({ kind: "restock", item: product });
                          }}
                        >
                          Reponer
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
              {modules?.multi_gym && (
                <div className="bottom-banner">
                  <span className="banner-icon">
                    <Activity />
                  </span>
                  <div>
                    <strong>Más sedes. Una misma forma de gestionar.</strong>
                    <p>Los datos se mantienen separados por gimnasio.</p>
                  </div>
                  {owner && (
                    <button
                      className="secondary"
                      onClick={() => navigate("gyms")}
                    >
                      Mis gimnasios
                      <ChevronRight size={15} />
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {page === "members" && (
            <section className="panel">
              <div className="toolbar">
                {allowed("members.write") && (
                  <button
                    className="secondary"
                    onClick={() => setImporting(true)}
                  >
                    Importar Excel
                  </button>
                )}
                <div className="search">
                  <Search size={18} />
                  <input
                    aria-label="Buscar socios"
                    placeholder="Nombre, documento o email…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <select
                  aria-label="Estado del socio"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">Todos los estados</option>
                  {["Activo", "Programado", "Vencido", "Sin cuota"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Actividad del socio"
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                >
                  <option value="all">Todas las actividades</option>
                  {[...new Set(plans.map((p) => p.activity))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>SOCIO</th>
                      <th>DOCUMENTO</th>
                      <th>ACTIVIDADES ELEGIDAS</th>
                      <th>ESTADO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((m) => (
                      <tr key={m.id}>
                        <td>
                          <div className="person">
                            <span className="member-avatar">
                              {initials(m.name)}
                            </span>
                            <div>
                              <strong>{m.name}</strong>
                              <small>
                                {m.email || m.phone || "Sin contacto"}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>{m.document}</td>
                        <td>
                          {m.plan_ids
                            .map((id) => plans.find((p) => p.id === id)?.name)
                            .filter(Boolean)
                            .join(", ") || "Sin actividades"}
                        </td>
                        <td>
                          <span
                            className={
                              "badge " +
                              (memberStatus(m) === "Activo"
                                ? "green"
                                : "neutral")
                            }
                          >
                            {memberStatus(m)}
                          </span>
                        </td>
                        <td>
                          <button className="link" onClick={() => setDetail(m)}>
                            Ver ficha
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!filtered.length && (
                <Empty
                  icon={<Users />}
                  title="No hay socios para mostrar"
                  text="Registrá un socio o probá otra búsqueda."
                />
              )}
            </section>
          )}
          {page === "plans" && (
            <div className="plan-grid">
              {plans.map((p) => (
                <section
                  className={"panel plan-card " + (!p.active ? "inactive" : "")}
                  key={p.id}
                >
                  <div className="plan-top">
                    <span className="plan-icon">
                      <Dumbbell />
                    </span>
                    <span
                      className={"badge " + (p.active ? "green" : "neutral")}
                    >
                      {p.active ? "Disponible" : "Inactivo"}
                    </span>
                  </div>
                  <span className="eyebrow">{p.activity}</span>
                  <h2>{p.name}</h2>
                  <div className="plan-price">
                    {money(p.price_cents)}
                    <small>
                      {" "}
                      /{" "}
                      {p.duration_unit === "month"
                        ? "mes calendario"
                        : p.duration_days + " días"}
                    </small>
                  </div>
                  <p className="fine-print">
                    {p.duration_unit === "month"
                      ? "Renueva el mismo día del mes."
                      : "Duración personalizada por el dueño."}
                  </p>
                  {allowed("plans.manage") && (
                    <button
                      className="secondary wide"
                      onClick={() => open({ kind: "plan", item: p })}
                    >
                      Editar plan
                    </button>
                  )}
                </section>
              ))}
              {!plans.length && (
                <Empty
                  icon={<Dumbbell />}
                  title="Sin planes todavía"
                  text="Creá un plan para habilitar actividades."
                />
              )}
            </div>
          )}
          {page === "payments" && (
            <section className="panel">
              <div className="toolbar">
                <div>
                  <h2>Historial de cuotas</h2>
                  <small>
                    En promociones, cada fila es la parte del cobro de un socio
                    y plan.
                  </small>
                </div>
                {allowed("payments.read") && (
                  <button
                    className="secondary"
                    onClick={() =>
                      exportCSV("FITWare-cuotas.csv", [
                        [
                          "Fecha",
                          "Socio",
                          "Plan",
                          "Promoción",
                          "Importe ARS",
                          "Orden",
                        ],
                        ...payments
                          .filter((p) => !p.voided_at)
                          .map((p) => [
                            shortDate(p.created_at),
                            p.member_name,
                            p.plan_name,
                            p.promotion_name,
                            p.amount_cents / 100,
                            p.order_id,
                          ]),
                      ])
                    }
                  >
                    <Download size={15} />
                    Exportar CSV
                  </button>
                )}
              </div>
              <PaymentTable
                payments={payments}
                onVoid={
                  allowed("movements.void")
                    ? (p) =>
                        setVoidTarget({
                          id: p.id,
                          kind: "payment",
                          description: p.member_name + " · " + p.plan_name,
                        })
                    : undefined
                }
              />
            </section>
          )}
          {page === "products" && modules?.products && (
            <section className="panel">
              <PanelHead
                title="Bebidas, snacks y suplementos"
                subtitle="Stock separado para cada gimnasio"
                action={allowed("sales.write") ? "Registrar venta" : undefined}
                onClick={() => open({ kind: "sale" })}
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>CONSUMIBLE</th>
                      <th>CATEGORÍA</th>
                      <th>STOCK</th>
                      <th>PRECIO</th>
                      {allowed("products.manage") && <th>COSTO UNITARIO</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <strong>{p.name}</strong>
                          <small>{p.active ? "Disponible" : "Inactivo"}</small>
                        </td>
                        <td>{p.category}</td>
                        <td>
                          <span
                            className={"badge " + (p.stock ? "green" : "amber")}
                          >
                            {p.stock} unidades
                          </span>
                        </td>
                        <td>{money(p.price_cents)}</td>
                        {allowed("products.manage") && (
                          <td>{money(p.cost_cents)}</td>
                        )}
                        <td>
                          <div className="row-actions">
                            {allowed("sales.write") && p.active && (
                              <button
                                className="link"
                                onClick={() => open({ kind: "sale", item: p })}
                              >
                                Vender
                              </button>
                            )}
                            {allowed("products.manage") && (
                              <>
                                <button
                                  className="link"
                                  onClick={() =>
                                    open({ kind: "restock", item: p })
                                  }
                                >
                                  Reponer
                                </button>
                                <button
                                  className="link"
                                  onClick={() =>
                                    open({ kind: "product", item: p })
                                  }
                                >
                                  Editar
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!products.length && (
                <Empty
                  icon={<ShoppingBag />}
                  title="Agregá tus consumibles"
                  text="Registrá productos, reponé stock y comenzá a vender."
                />
              )}
            </section>
          )}
          {page === "promotions" && modules?.promotions && (
            <div className="plan-grid">
              {promotions.map((p) => (
                <section className="panel plan-card" key={p.id}>
                  <div className="plan-top">
                    <Tags />
                    <span
                      className={"badge " + (p.active ? "green" : "neutral")}
                    >
                      {p.active ? "Activa" : "Inactiva"}
                    </span>
                  </div>
                  <span className="eyebrow">
                    {p.kind === "two_for_one"
                      ? "DOS SOCIOS · UN PLAN"
                      : p.kind === "combo"
                        ? "COMBO DE ACTIVIDADES"
                        : "DESCUENTO"}
                  </span>
                  <h2>{p.name}</h2>
                  <div className="plan-price">
                    {p.kind === "two_for_one"
                      ? "2 × 1"
                      : p.discount_type === "percent"
                        ? p.value + "%"
                        : money(p.value)}
                  </div>
                  <p className="fine-print">
                    {p.plan_ids.length
                      ? p.plan_ids
                          .map(
                            (id) => plans.find((plan) => plan.id === id)?.name,
                          )
                          .join(" + ")
                      : "Sin restricción de planes"}
                    <br />
                    {p.starts_on
                      ? shortDate(p.starts_on)
                      : "Desde ahora"} ·{" "}
                    {p.ends_on ? shortDate(p.ends_on) : "Sin fecha de fin"}
                  </p>
                  {p.beneficiaries?.length > 0 && (
                    <p className="promotion-beneficiaries">
                      Socios: {p.beneficiaries.map((m) => m.name).join(" + ")}
                    </p>
                  )}
                  {allowed("payments.write") && p.active && (
                    <button
                      className="primary wide"
                      onClick={() =>
                        open({
                          kind: "payment",
                          item: {
                            promotion_id: p.id,
                            member_id: p.member_ids?.[0] || "",
                            partner_id: p.member_ids?.[1] || "",
                            plan_ids: p.plan_ids,
                          },
                        })
                      }
                    >
                      Aplicar y cobrar promoción
                    </button>
                  )}
                  <button
                    className="secondary wide"
                    onClick={() => open({ kind: "promotion", item: p })}
                  >
                    Editar promoción
                  </button>
                </section>
              ))}
              {!promotions.length && (
                <Empty
                  icon={<Tags />}
                  title="Tus promociones, tus reglas"
                  text="Creá un 2x1, un combo o un descuento por importe o porcentaje."
                />
              )}
            </div>
          )}
          {page === "cash" && allowed("reports.read") && (
            <Cash
              report={report}
              day={cashDay}
              onDay={setCashDay}
              onVoid={onVoid}
              onPayment={
                allowed("payments.write")
                  ? () => open({ kind: "payment" })
                  : undefined
              }
              onSale={
                modules?.products && allowed("sales.write")
                  ? () => open({ kind: "sale" })
                  : undefined
              }
              onExpense={
                allowed("expenses.write")
                  ? () => open({ kind: "expense" })
                  : undefined
              }
            />
          )}
          {page === "reports" && allowed("reports.read") && (
            <Reports
              report={report}
              from={from}
              to={to}
              scope={scope}
              owner={!!owner}
              onVoid={onVoid}
              onFilter={(f, t, s) => {
                setFrom(f);
                setTo(t);
                setScope(s);
              }}
            />
          )}
          {page === "staff" && owner && (
            <section className="panel">
              <PanelHead
                title="Empleados y accesos"
                subtitle="Cada perfil ve solo las sedes y las funciones que le asignás"
              />
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>EMPLEADO</th>
                      <th>ROL</th>
                      <th>GIMNASIOS</th>
                      <th>ESTADO</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {staff.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.name}</strong>
                          <small>{s.email}</small>
                        </td>
                        <td>{roleNames[s.role]}</td>
                        <td>
                          {s.gym_ids
                            .map((id) => gyms.find((g) => g.id === id)?.name)
                            .join(", ")}
                        </td>
                        <td>
                          <span
                            className={
                              "badge " + (s.active ? "green" : "neutral")
                            }
                          >
                            {s.active ? "Habilitado" : "Deshabilitado"}
                          </span>
                        </td>
                        <td>
                          <button
                            className="link"
                            onClick={() => open({ kind: "staff", item: s })}
                          >
                            Editar acceso
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!staff.length && (
                <Empty
                  icon={<Users />}
                  title="Armá tu equipo"
                  text="Creá perfiles de recepcionista o entrenador con permisos personalizados."
                />
              )}
            </section>
          )}
          {page === "gyms" && owner && modules?.multi_gym && (
            <div className="plan-grid">
              {gyms.map((g) => (
                <section className="panel plan-card" key={g.id}>
                  <span className="plan-icon">
                    <Building2 />
                  </span>
                  <h2 className="gym-card-title">{g.name}</h2>
                  <p className="muted">{g.address || "Sin dirección"}</p>
                  <button
                    className="secondary wide"
                    onClick={() => {
                      sequence.current++;
                      setGym(g.id);
                      setGymId(g.id);
                      navigate("dashboard");
                    }}
                  >
                    {gymId === g.id
                      ? "Gimnasio seleccionado"
                      : "Gestionar este gimnasio"}
                    <ChevronRight size={15} />
                  </button>
                </section>
              ))}
            </div>
          )}
          {page === "profile" && (
            <section className="panel profile-panel">
              <span className="profile-large">{initials(user.name)}</span>
              <h2>{user.name}</h2>
              <span className="badge green">{roleNames[user.role]}</span>
              <div className="detail-grid">
                <p>
                  <small>Email de acceso</small>
                  {user.email}
                </p>
                <p>
                  <small>Teléfono</small>
                  {user.phone || "Sin cargar"}
                </p>
                <p>
                  <small>Dirección</small>
                  {user.address || "Sin cargar"}
                </p>
                <p>
                  <small>Gimnasios disponibles</small>
                  {gyms.map((g) => g.name).join(", ") || "Sin sedes asignadas"}
                </p>
              </div>
              <h3>Mis permisos</h3>
              <p className="fine-print">
                {owner
                  ? "Acceso completo a tu organización y tus gimnasios."
                  : user.permissions
                      .map((p) => permissionLabels[p] || p)
                      .join(" · ") || "Sin permisos asignados"}
              </p>
              <button
                className="secondary"
                onClick={() => open({ kind: "password" })}
              >
                Cambiar contraseña
              </button>
            </section>
          )}
          {page === "billing" && owner && (
            <BillingPanel billing={billing} onRefresh={context} />
          )}
          <footer>
            FITWare <span>Gestión que acompaña tu crecimiento.</span>
            <span>ARS · Argentina</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      {editor && (
        <EditorModal
          key={editor.kind + (editor.item?.id || "new")}
          editor={editor}
          user={user}
          gyms={gyms}
          members={members}
          plans={plans}
          products={products}
          promotions={promotions}
          onClose={closeEditor}
          onSaved={saved}
          modules={modules || undefined}
          onCreated={(id) => {
            void api<Member[]>("/members")
              .then((list) => {
                setMembers(list);
                setDetail(list.find((m) => m.id === id) || null);
              })
              .catch((e) => setError(e.message));
          }}
        />
      )}
      {importing && (
        <ImportMembers onClose={() => setImporting(false)} onSaved={saved} />
      )}
      {voidTarget && (
        <VoidDialog
          movement={voidTarget}
          onClose={() => setVoidTarget(null)}
          onSaved={saved}
        />
      )}
      {detail && (
        <MemberProfile
          key={detail.id}
          member={detail}
          plans={plans}
          payments={payments}
          status={memberStatus(detail)}
          canEdit={allowed("members.write")}
          canPay={allowed("payments.write")}
          canReadPayments={allowed("payments.read")}
          onClose={() => setDetail(null)}
          onEdit={() => open({ kind: "member", item: detail })}
          onRenew={() => void renew(detail)}
          onArchive={
            owner
              ? async () => {
                  if (
                    !window.confirm(
                      `¿Dar de baja a ${detail.name}? Se conserva su historial.`,
                    )
                  )
                    return;
                  try {
                    await api("/members/" + detail.id, { method: "DELETE" });
                    setDetail(null);
                    await saved("Socio dado de baja");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
function Auth({
  onLogin,
  initialError,
}: {
  onLogin: (u: User) => void;
  initialError: string;
}) {
  const [forgot, setForgot] = useState(false);
  const [register, setRegister] = useState(false),
    [error, setError] = useState(initialError),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget));
      onLogin(
        await api<User>(register ? "/auth/register" : "/auth/login", {
          method: "POST",
          body: JSON.stringify(data),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (forgot) return <Recovery onBack={() => setForgot(false)} />;
  return (
    <main className="login">
      <section className="login-story">
        <Logo />
        <div>
          <span className="eyebrow">MÁS TIEMPO PARA LO QUE IMPORTA</span>
          <h1>
            El movimiento
            <br />
            empieza con
            <br />
            <em>orden.</em>
          </h1>
          <p>
            Socios, actividades, equipo y caja.
            <br />
            Cada gimnasio, en su lugar.
          </p>
        </div>
        <small>FITWare · Gestión que te acompaña</small>
      </section>
      <section className="login-form">
        <span className="eyebrow">BIENVENIDO A FITWARE</span>
        <h2>
          {register
            ? "Tu gimnasio empieza acá."
            : "Vamos a ponernos en marcha."}
        </h2>
        <p>
          {register
            ? "Creá tu cuenta de dueño y tu primer gimnasio."
            : "Ingresá con tu cuenta para continuar."}
        </p>
        <form onSubmit={submit}>
          {register && (
            <>
              <Field label="Tu nombre y apellido">
                <input
                  name="name"
                  required
                  maxLength={180}
                  autoComplete="name"
                />
              </Field>
              <Field label="Nombre de tu organización">
                <input name="business_name" required maxLength={180} />
              </Field>
              <Field label="Nombre de tu primer gimnasio">
                <input name="gym_name" required maxLength={180} />
              </Field>
            </>
          )}
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required />
          </Field>
          <Field label="Contraseña">
            <input
              name="password"
              type="password"
              minLength={register ? 10 : 1}
              maxLength={200}
              autoComplete={register ? "new-password" : "current-password"}
              required
            />
          </Field>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary wide" disabled={busy}>
            {busy ? "Procesando…" : register ? "Crear cuenta" : "Ingresar"}
            <ChevronRight size={16} />
          </button>
        </form>
        {!register && (
          <button className="auth-switch" onClick={() => setForgot(true)}>
            Olvidé mi contraseña
          </button>
        )}
        <button
          className="auth-switch"
          onClick={() => {
            setRegister(!register);
            setError("");
          }}
        >
          {register
            ? "Ya tengo cuenta · Ingresar"
            : "¿Tenés un gimnasio? Creá tu cuenta"}
        </button>
        <div className="login-note">
          <ShieldCheck size={20} />
          <span>
            {register
              ? "Prueba inicial de 14 días. El cobro del servicio depende de la configuración del administrador."
              : "Los empleados acceden con las cuentas creadas por su dueño."}
          </span>
        </div>
      </section>
    </main>
  );
}
