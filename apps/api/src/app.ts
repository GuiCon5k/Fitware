import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Row } from "./db.js";
import { hashPassword, tokenHash, verifyPassword } from "./security.js";
import { today, dateText, addDays } from "./dates.js";
import {
  HttpError,
  text,
  method,
  orderSchema,
  quote,
  charge,
  fingerprint,
} from "./domain.js";
import { permissionNames, presets } from "./seed.js";
import { billingStatus, checkout, webhook } from "./billing.js";
import { createServiceQuote } from "./exchange.js";
import { getModules, audit, checkModule, type Modules } from "./features.js";
import { installRecovery, type ResetSender } from "./recovery.js";
import { createBackupService, type BackupService } from "./backups.js";
import {
  importTemplate,
  previewImport,
  commitImport,
} from "./import-members.js";
import {
  registrationSchema,
  registerAndCharge,
  renewalTemplate,
  voidMovement,
} from "./member-flows.js";
import {
  normalizeInput,
  InputError,
  validationErrors,
} from "./input-safety.js";
import { paymentFields, resolveMethod } from "./payment-methods.js";
import { installGymOperations } from "./gym-operations.js";
import { installAccess, photoParser } from "./access.js";
import { memberSchema } from "./validators.js";
type User = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "receptionist" | "trainer";
  account_id: string;
  phone: string;
  address: string;
  permissions: string[];
  active: boolean;
};
declare global {
  namespace Express {
    interface Request {
      user: User;
      gymId: string;
      modules: Modules;
    }
  }
}
const planSchema = z.object({
  name: text,
  activity: text,
  price_cents: z.number().int().positive().max(1000000000),
  duration_unit: z.enum(["month", "days"]).default("month"),
  duration_days: z.number().int().min(1).max(730).default(30),
  active: z.boolean().default(true),
});
const productSchema = z.object({
  ...paymentFields,
  low_stock_threshold: z.number().int().min(0).max(100000000).default(5),
  stock: z.number().int().min(0).max(100000000).optional(),
  expected_stock: z.number().int().min(0).optional(),
  stock_reason: z.string().trim().max(300).optional(),
  record_stock_expense: z.boolean().default(false),
  method: method.default("cash"),
  request_key: z.uuid().optional(),
  name: text,
  category: text,
  price_cents: z.number().int().positive().max(100000000),
  cost_cents: z.number().int().min(0).max(100000000),
  active: z.boolean().default(true),
});
const isoDate = z.iso.date();
export function createApp(
  db: Database,
  options: { resetSender?: ResetSender; backups?: BackupService } = {},
) {
  const backups = options.backups || createBackupService(db);
  const app = express();
  app.disable("x-powered-by");
  if (process.env.RENDER) app.set("trust proxy", 1);
  app.use(helmet());
  app.use("/api/members/:id/photo", photoParser);
  app.use(express.json({ limit: "100kb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.path === "/billing/webhook") return next();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (
        origin &&
        origin !== (process.env.APP_ORIGIN || "http://localhost:5173")
      )
        return res.status(403).json({ error: "Origen no permitido" });
      if (req.get("x-fitware-client") !== "web")
        return res.status(403).json({ error: "Falta encabezado de seguridad" });
    }
    next();
  });
  app.use("/api", (req, _res, next) => {
    try {
      if (req.path === "/billing/webhook") return next();
      if (req.body && !Buffer.isBuffer(req.body))
        req.body = normalizeInput(req.body);
      Object.defineProperty(req, "query", {
        value: normalizeInput(req.query),
        configurable: true,
      });
      next();
    } catch (e) {
      next(e);
    }
  });
  const sessionToken = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .find((x) => x.trim().startsWith("fitware_session="))
      ?.trim()
      .slice(16) || "";
  const auth = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const user = (
        await db.query<User>(
          `SELECT u.id,u.name,u.email,u.role,u.account_id,u.phone,u.address,u.permissions,u.active FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,
          [tokenHash(sessionToken(req))],
        )
      ).rows[0];
      if (!user) throw new HttpError(401, "Ingresá para continuar");
      req.user = user;
      req.modules = await getModules(db, user.account_id);
      next();
    } catch (e) {
      next(e);
    }
  };
  const owner = (req: Request, _res: Response, next: NextFunction) =>
    req.user.role === "owner"
      ? next()
      : next(new HttpError(403, "Solo el dueño puede realizar esta operación"));
  const can = (req: Request, p: string) =>
    req.user.role === "owner" || req.user.permissions.includes(p);
  const permit =
    (p: string) => (req: Request, _res: Response, next: NextFunction) =>
      can(req, p)
        ? next()
        : next(new HttpError(403, "No tenés permiso para esta operación"));
  const publicUser = (u: Row) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    account_id: u.account_id,
    phone: u.phone || "",
    address: u.address || "",
    permissions: u.permissions || [],
  });
  async function session(res: Response, user: Row) {
    const token = randomBytes(32).toString("hex");
    await db.query("INSERT INTO sessions VALUES($1,$2,$3)", [
      tokenHash(token),
      user.id,
      new Date(Date.now() + 8 * 3600000),
    ]);
    res.cookie("fitware_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 3600000,
      path: "/api",
    });
    return publicUser(user);
  }
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiados intentos. Esperá 15 minutos." },
  });
  app.get("/api/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.json({
        status: "ok",
        version: 4,
        release: "4.0.1",
        commit: process.env.RENDER_GIT_COMMIT || "local",
      });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const b = z
      .object({ email: z.email(), password: z.string().min(1).max(200) })
      .parse(req.body);
    const u = (
      await db.query("SELECT * FROM users WHERE email=$1 AND active", [
        b.email.toLowerCase(),
      ])
    ).rows[0];
    if (!u || !verifyPassword(b.password, u.password_hash))
      throw new HttpError(401, "Email o contraseña incorrectos");
    res.json(await session(res, u));
  });
  app.post("/api/auth/register", loginLimiter, async (req, res) => {
    const b = z
      .object({
        name: text,
        email: z.email(),
        password: z.string().min(10).max(200),
        confirm_password: z.string().min(1).max(200),
        business_name: text,
        gym_name: text,
      })
      .refine((b) => b.password === b.confirm_password, {
        path: ["confirm_password"],
        message:
          "Las contraseñas no coinciden. Escribí la misma contraseña en ambos campos.",
      })
      .parse(req.body);
    const user = await db.transaction(async (tx) => {
      const accountId = randomUUID(),
        gymId = randomUUID(),
        id = randomUUID();
      await tx.query(
        "INSERT INTO accounts(id,name,trial_until) VALUES($1,$2,$3)",
        [accountId, b.business_name, addDays(today(), 14)],
      );
      await tx.query("INSERT INTO gyms(id,account_id,name) VALUES($1,$2,$3)", [
        gymId,
        accountId,
        b.gym_name,
      ]);
      return (
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash,role,account_id) VALUES($1,$2,$3,$4,'owner',$5) RETURNING *",
          [
            id,
            b.name,
            b.email.toLowerCase(),
            hashPassword(b.password),
            accountId,
          ],
        )
      ).rows[0];
    });
    res.status(201).json(await session(res, user));
  });
  app.post("/api/billing/webhook", webhook(db));
  installRecovery(app, db, options.resetSender);
  app.use("/api", auth);
  app.get("/api/auth/me", (req, res) => res.json(publicUser(req.user)));
  app.post("/api/auth/logout", async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      tokenHash(sessionToken(req)),
    ]);
    res.clearCookie("fitware_session", { path: "/api" }).sendStatus(204);
  });
  app.put("/api/profile", async (req, res) => {
    const b = z
      .object({
        name: text,
        phone: z.string().max(40).default(""),
        address: z.string().max(300).default(""),
      })
      .parse(req.body);
    const u = (
      await db.query(
        "UPDATE users SET name=$2,phone=$3,address=$4 WHERE id=$1 RETURNING *",
        [req.user.id, b.name, b.phone, b.address],
      )
    ).rows[0];
    res.json(publicUser(u));
  });
  app.post("/api/profile/password", async (req, res) => {
    const b = z
      .object({
        current_password: z.string().max(200),
        new_password: z.string().min(10).max(200),
      })
      .parse(req.body);
    const u = (
      await db.query("SELECT password_hash FROM users WHERE id=$1", [
        req.user.id,
      ])
    ).rows[0];
    if (!verifyPassword(b.current_password, u.password_hash))
      throw new HttpError(400, "La contraseña actual no coincide");
    await db.transaction(async (tx) => {
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        req.user.id,
        hashPassword(b.new_password),
      ]);
      await tx.query(
        "DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2",
        [req.user.id, tokenHash(sessionToken(req))],
      );
    });
    res.sendStatus(204);
  });
  app.get("/api/billing", owner, async (req, res) =>
    res.json({
      ...(await billingStatus(db, req.user.account_id)),
      receipts: (
        await db.query(
          "SELECT * FROM billing_receipts WHERE account_id=$1 ORDER BY ends_on DESC",
          [req.user.account_id],
        )
      ).rows,
    }),
  );
  app.post("/api/billing/quote", owner, async (req, res) =>
    res.json(await createServiceQuote(db, req.user.account_id)),
  );
  app.post("/api/billing/checkout", owner, async (req, res) =>
    res.json(
      await checkout(
        db,
        req.user.account_id,
        z.uuid().parse(req.body?.quote_id),
      ),
    ),
  );
  app.get("/api/gyms", async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT g.* FROM gyms g WHERE account_id=$1 ${req.user.role === "owner" ? "" : "AND EXISTS(SELECT 1 FROM staff_gyms s WHERE s.gym_id=g.id AND s.user_id=$2)"} ORDER BY name`,
          req.user.role === "owner"
            ? [req.user.account_id]
            : [req.user.account_id, req.user.id],
        )
      ).rows,
    ),
  );
  app.get("/api/settings", (req, res) => res.json({ modules: req.modules }));
  app.put("/api/settings", owner, async (req, res) => {
    const modules = z
      .object({
        products: z.boolean(),
        promotions: z.boolean(),
        multi_gym: z.boolean(),
      })
      .parse(req.body.modules);
    await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        req.user.account_id,
      ]);
      if (
        !modules.multi_gym &&
        Number(
          (
            await tx.query("SELECT count(*) n FROM gyms WHERE account_id=$1", [
              req.user.account_id,
            ])
          ).rows[0].n,
        ) > 1
      )
        throw new HttpError(
          409,
          "Tenés más de una sede. Mantené habilitados los múltiples gimnasios.",
        );
      await tx.query(
        "UPDATE account_settings SET modules=$2 WHERE account_id=$1",
        [req.user.account_id, JSON.stringify(modules)],
      );
      await audit(tx, req.user.account_id, req.user.id, "settings.updated", {
        modules,
      });
    });
    res.json({ modules });
  });
  app.get("/api/backups", owner, async (req, res) =>
    res.json(await backups.list(req.user.account_id)),
  );
  app.post("/api/backups", owner, async (req, res) =>
    res.status(201).json(await backups.create(req.user.account_id)),
  );
  app.get("/api/backups/:id/download", owner, async (req, res) => {
    const bytes = await backups.download(
      req.user.account_id,
      z.uuid().parse(req.params.id),
    );
    res
      .type("application/gzip")
      .attachment("FITWare-respaldo-" + req.params.id + ".json.gz")
      .send(bytes);
  });
  app.use("/api", (req, _res, next) => {
    try {
      if (/^\/(products|sales)(\/|$)/.test(req.path))
        checkModule(req.modules, "products");
      if (/^\/promotions(\/|$)/.test(req.path))
        checkModule(req.modules, "promotions");
      if (req.path === "/gyms" && req.method === "POST")
        checkModule(req.modules, "multi_gym");
      if (
        req.path.startsWith("/payments") &&
        (req.body?.promotion_id || req.body?.discount_cents)
      )
        checkModule(req.modules, "promotions");
      next();
    } catch (e) {
      next(e);
    }
  });
  // The subscription gate is enforced server-side. Profile, billing and gym selector remain accessible after expiry.
  app.use("/api", async (req, _res, next) => {
    try {
      const b = await billingStatus(db, req.user.account_id);
      if (b.enabled && !b.active)
        throw new HttpError(
          402,
          "La suscripción de FITWare venció. El dueño debe renovar el servicio.",
        );
      next();
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/gyms", owner, async (req, res) => {
    const b = z
      .object({ name: text, address: z.string().max(300).default("") })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        req.user.account_id,
      ]);
      checkModule(await getModules(tx, req.user.account_id), "multi_gym");
      return (
        await tx.query(
          "INSERT INTO gyms(id,account_id,name,address) VALUES($1,$2,$3,$4) RETURNING *",
          [randomUUID(), req.user.account_id, b.name, b.address],
        )
      ).rows[0];
    });
    res.status(201).json(result);
  });
  app.get("/api/permissions", owner, (_req, res) =>
    res.json({ permissions: permissionNames, presets }),
  );
  app.get("/api/staff", owner, async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT u.id,u.name,u.email,u.phone,u.address,u.role,u.active,u.permissions,COALESCE((SELECT json_agg(gym_id) FROM staff_gyms s WHERE s.user_id=u.id),'[]'::json) gym_ids FROM users u WHERE account_id=$1 AND role<>'owner' ORDER BY name`,
          [req.user.account_id],
        )
      ).rows,
    ),
  );
  const staffSchema = z.object({
    name: text,
    email: z.email(),
    phone: z.string().max(40).default(""),
    address: z.string().max(300).default(""),
    role: z.enum(["receptionist", "trainer"]),
    permissions: z.array(z.enum(permissionNames)).max(30),
    gym_ids: z.array(text).min(1).max(100),
    active: z.boolean().default(true),
    password: z.string().min(10).max(200).optional(),
  });
  async function saveStaff(req: Request, res: Response) {
    const b = staffSchema.parse(req.body);
    if (req.method === "POST" && !b.password)
      throw new HttpError(
        400,
        "Definí una contraseña inicial de al menos 10 caracteres",
      );
    const result = await db.transaction(async (tx) => {
      for (const gymId of b.gym_ids)
        if (
          !(
            await tx.query(
              "SELECT id FROM gyms WHERE id=$1 AND account_id=$2",
              [gymId, req.user.account_id],
            )
          ).rows.length
        )
          throw new HttpError(400, "Sede no disponible");
      const id = req.method === "POST" ? randomUUID() : req.params.id;
      if (
        req.method !== "POST" &&
        !(
          await tx.query(
            "SELECT id FROM users WHERE id=$1 AND account_id=$2 AND role<>'owner'",
            [id, req.user.account_id],
          )
        ).rows.length
      )
        throw new HttpError(404, "Empleado no encontrado");
      if (req.method === "POST")
        await tx.query(
          "INSERT INTO users(id,name,email,password_hash,role,account_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            b.name,
            b.email.toLowerCase(),
            hashPassword(b.password!),
            b.role,
            req.user.account_id,
          ],
        );
      const deps: Record<string, string[]> = {
        "members.write": ["members.read"],
        "payments.reconcile": [
          "payments.read",
          "payments.write",
          "members.read",
          "plans.read",
        ],
        "cash.count": ["reports.read"],
        "access.checkin": ["members.read", "plans.read"],
        "access.manage": ["members.read"],
        "payments.write": ["members.read", "plans.read"],
        "plans.manage": ["plans.read"],
        "products.manage": ["products.read"],
        "sales.write": ["products.read"],
        "promos.manage": ["plans.read"],
      };
      b.permissions = [
        ...new Set(b.permissions.flatMap((p) => [p, ...(deps[p] || [])])),
      ] as typeof b.permissions;
      await tx.query(
        "UPDATE users SET name=$2,email=$3,phone=$4,address=$5,role=$6,permissions=$7::jsonb,active=$8 WHERE id=$1",
        [
          id,
          b.name,
          b.email.toLowerCase(),
          b.phone,
          b.address,
          b.role,
          JSON.stringify(b.permissions),
          b.active,
        ],
      );
      if (b.password && req.method !== "POST")
        await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
          id,
          hashPassword(b.password),
        ]);
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [id]);
      await tx.query("DELETE FROM staff_gyms WHERE user_id=$1", [id]);
      for (const gymId of [...new Set(b.gym_ids)])
        await tx.query("INSERT INTO staff_gyms VALUES($1,$2)", [id, gymId]);
      return { id };
    });
    res.status(req.method === "POST" ? 201 : 200).json(result);
  }
  app.post("/api/staff", owner, saveStaff);
  app.put("/api/staff/:id", owner, saveStaff);
  app.use("/api", async (req, _res, next) => {
    try {
      const gymId =
        req.get("x-gym-id") ||
        (/^\/member-photos\/[^/]+$/.test(req.path)
          ? String(req.query.gym_id || "")
          : "");
      if (!gymId) throw new HttpError(400, "Seleccioná un gimnasio");
      const g = (
        await db.query("SELECT id FROM gyms WHERE id=$1 AND account_id=$2", [
          gymId,
          req.user.account_id,
        ])
      ).rows[0];
      if (!g) throw new HttpError(403, "No tenés acceso a ese gimnasio");
      if (
        req.user.role !== "owner" &&
        !(
          await db.query(
            "SELECT gym_id FROM staff_gyms WHERE gym_id=$1 AND user_id=$2",
            [gymId, req.user.id],
          )
        ).rows.length
      )
        throw new HttpError(403, "La sede no está asignada a tu perfil");
      req.gymId = gymId;
      next();
    } catch (e) {
      next(e);
    }
  });
  installGymOperations(app, db, permit, owner);
  installAccess(app, db, permit);
  app.get(
    "/api/members/import/template",
    permit("members.write"),
    async (req, res) =>
      res
        .type(
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .attachment("FITWare-socios.xlsx")
        .send(await importTemplate(db, req.gymId)),
  );
  app.post(
    "/api/members/import/preview",
    permit("members.write"),
    express.raw({
      type: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "application/octet-stream",
      ],
      limit: "2mb",
    }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body))
        throw new HttpError(400, "Seleccioná un archivo XLSX o CSV");
      res.json(
        await previewImport(
          db,
          req.gymId,
          req.user.id,
          req.body,
          req.get("content-type") || "",
        ),
      );
    },
  );
  app.post(
    "/api/members/import/commit",
    permit("members.write"),
    async (req, res) =>
      res.json(
        await commitImport(
          db,
          req.gymId,
          req.user.id,
          req.user.account_id,
          z.uuid().parse(req.body.batch_id),
        ),
      ),
  );
  app.post(
    "/api/members/registration-quote",
    permit("members.write"),
    permit("payments.write"),
    async (req, res) => {
      const b = registrationSchema.parse(req.body);
      if (b.payment.promotion_id || b.payment.discount_cents)
        checkModule(req.modules, "promotions");
      res.json(
        await quote(
          db,
          req.gymId,
          { ...b.payment, member_id: "new-member" },
          can(req, "promos.manage"),
          { id: "new-member", name: b.member.name },
        ),
      );
    },
  );
  app.post(
    "/api/members/register-and-charge",
    permit("members.write"),
    permit("payments.write"),
    async (req, res) => {
      const b = registrationSchema.parse(req.body);
      if (b.payment.promotion_id || b.payment.discount_cents)
        checkModule(req.modules, "promotions");
      res
        .status(201)
        .json(
          await registerAndCharge(
            db,
            req.gymId,
            req.user.id,
            req.user.account_id,
            b,
            can(req, "promos.manage"),
          ),
        );
    },
  );
  app.get(
    "/api/members/:id/renewal",
    permit("payments.write"),
    async (req, res) =>
      res.json(
        await renewalTemplate(
          db,
          req.gymId,
          String(req.params.id),
          can(req, "promos.manage"),
          req.modules.promotions,
        ),
      ),
  );
  app.post(
    "/api/movements/:kind/:id/void",
    permit("movements.void"),
    async (req, res) =>
      res.json(
        await voidMovement(
          db,
          req.gymId,
          req.user.account_id,
          req.user.id,
          String(req.params.kind),
          String(req.params.id),
          z.string().trim().min(5).max(500).parse(req.body.reason),
        ),
      ),
  );
  app.get("/api/members", permit("members.read"), async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT m.*,(SELECT updated_at FROM member_photos mp WHERE mp.member_id=m.id) photo_updated_at,COALESCE((SELECT json_agg(json_build_object('id',s.id,'plan_id',p.id,'plan_name',p.name,'activity',p.activity,'starts_on',s.starts_on,'ends_on',s.ends_on)) FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.member_id=m.id AND s.cancelled_at IS NULL),'[]'::json) subscriptions,COALESCE((SELECT json_agg(plan_id) FROM member_activities a WHERE a.member_id=m.id),'[]'::json) plan_ids FROM members m WHERE gym_id=$1 AND NOT archived ORDER BY name`,
          [req.gymId],
        )
      ).rows,
    ),
  );
  async function saveMember(req: Request, res: Response) {
    const b = memberSchema.parse(req.body);
    const id = req.method === "POST" ? randomUUID() : req.params.id;
    await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [req.gymId]);
      const before = (
        await tx.query(
          "SELECT document FROM members WHERE id=$1 AND gym_id=$2",
          [id, req.gymId],
        )
      ).rows[0];
      for (const pid of b.plan_ids)
        if (
          !(
            await tx.query(
              "SELECT id FROM plans WHERE id=$1 AND gym_id=$2 AND active",
              [pid, req.gymId],
            )
          ).rows.length
        )
          throw new HttpError(400, "Actividad no disponible");
      if (req.method === "POST")
        await tx.query(
          "INSERT INTO members(id,name,document,gym_id) VALUES($1,$2,$3,$4)",
          [id, b.name, b.document, req.gymId],
        );
      const row = (
        await tx.query(
          "UPDATE members SET name=$3,document=$4,email=$5,phone=$6,notes=$7,address=$8,emergency_name=$9,emergency_phone=$10 WHERE id=$1 AND gym_id=$2 AND NOT archived RETURNING id",
          [
            id,
            req.gymId,
            b.name,
            b.document,
            b.email,
            b.phone,
            b.notes,
            b.address,
            b.emergency_name,
            b.emergency_phone,
          ],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, "Socio no encontrado");
      if (before && before.document !== b.document)
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "member.document_changed",
          { member_id: id, previous: before.document, current: b.document },
          req.gymId,
        );
      await tx.query("DELETE FROM member_activities WHERE member_id=$1", [id]);
      for (const pid of [...new Set(b.plan_ids)])
        await tx.query("INSERT INTO member_activities VALUES($1,$2)", [
          id,
          pid,
        ]);
    });
    res.status(req.method === "POST" ? 201 : 200).json({ id });
  }
  app.post("/api/members", permit("members.write"), saveMember);
  app.put("/api/members/:id", permit("members.write"), saveMember);
  app.delete("/api/members/:id", owner, async (req, res) => {
    if (
      !(
        await db.query(
          "UPDATE members SET archived=true WHERE id=$1 AND gym_id=$2 RETURNING id",
          [req.params.id, req.gymId],
        )
      ).rows.length
    )
      throw new HttpError(404, "Socio no encontrado");
    res.sendStatus(204);
  });
  app.get("/api/plans", permit("plans.read"), async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM plans WHERE gym_id=$1 ORDER BY activity,name",
          [req.gymId],
        )
      ).rows,
    ),
  );
  async function savePlan(req: Request, res: Response) {
    const b = planSchema.parse(req.body);
    const values = [
      b.name,
      b.activity,
      b.price_cents,
      b.duration_days,
      b.duration_unit,
      b.active,
    ];
    const row =
      req.method === "POST"
        ? (
            await db.query(
              "INSERT INTO plans(id,gym_id,name,activity,price_cents,duration_days,duration_unit,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
              [randomUUID(), req.gymId, ...values],
            )
          ).rows[0]
        : (
            await db.query(
              "UPDATE plans SET name=$3,activity=$4,price_cents=$5,duration_days=$6,duration_unit=$7,active=$8 WHERE id=$1 AND gym_id=$2 RETURNING *",
              [req.params.id, req.gymId, ...values],
            )
          ).rows[0];
    if (!row) throw new HttpError(404, "Plan no encontrado");
    res.json(row);
  }
  app.post("/api/plans", permit("plans.manage"), savePlan);
  app.put("/api/plans/:id", permit("plans.manage"), savePlan);
  app.get("/api/promotions", permit("plans.read"), async (req, res) =>
    res.json(
      (
        await db.query(
          `SELECT p.*,COALESCE((SELECT json_agg(json_build_object('id',m.id,'name',m.name)) FROM members m WHERE m.id IN (SELECT jsonb_array_elements_text(p.member_ids))),'[]'::json) beneficiaries FROM promotions p WHERE p.gym_id=$1 ORDER BY name`,
          [req.gymId],
        )
      ).rows,
    ),
  );
  const promoSchema = z
    .object({
      name: text,
      kind: z.enum(["two_for_one", "combo", "discount"]),
      discount_type: z.enum(["percent", "fixed"]),
      value: z.number().int().min(0).max(1000000000),
      plan_ids: z.array(text).max(20).default([]),
      member_ids: z.array(text).max(2).default([]),
      starts_on: isoDate.nullable().default(null),
      ends_on: isoDate.nullable().default(null),
      active: z.boolean().default(true),
    })
    .refine(
      (b) => b.discount_type !== "percent" || b.value <= 100,
      "El porcentaje no puede superar 100",
    )
    .refine(
      (b) => !b.starts_on || !b.ends_on || b.ends_on >= b.starts_on,
      "Las fechas no son válidas",
    )
    .refine(
      (b) => b.kind !== "two_for_one" || b.plan_ids.length <= 1,
      "Un 2x1 admite como máximo un plan",
    );
  async function savePromotion(req: Request, res: Response) {
    const b = promoSchema.parse(req.body);
    b.plan_ids = [...new Set(b.plan_ids)];
    b.member_ids = [...new Set(b.member_ids)];
    if (
      b.member_ids.length &&
      (b.kind === "two_for_one"
        ? b.member_ids.length !== 2
        : b.member_ids.length !== 1)
    )
      throw new HttpError(
        400,
        b.kind === "two_for_one"
          ? "Seleccioná dos socios diferentes"
          : "Seleccioná un socio",
      );
    if (
      b.member_ids.length &&
      b.kind === "two_for_one" &&
      b.plan_ids.length !== 1
    )
      throw new HttpError(400, "El 2x1 requiere una actividad");
    const activities = new Set<string>();
    for (const id of b.plan_ids) {
      const p = (
        await db.query(
          "SELECT id,activity FROM plans WHERE id=$1 AND gym_id=$2",
          [id, req.gymId],
        )
      ).rows[0];
      if (!p) throw new HttpError(400, "Plan de otra sede");
      activities.add(p.activity);
    }
    if (
      b.kind === "combo" &&
      b.plan_ids.length &&
      (activities.size < 2 || activities.size !== b.plan_ids.length)
    )
      throw new HttpError(
        400,
        "El combo requiere dos o más actividades distintas",
      );
    if (b.member_ids.length && b.kind === "combo" && b.plan_ids.length < 2)
      throw new HttpError(400, "Seleccioná las actividades del combo");
    for (const id of b.member_ids)
      if (
        !(
          await db.query(
            "SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
            [id, req.gymId],
          )
        ).rows.length
      )
        throw new HttpError(400, "Socio no disponible en este gimnasio");
    const values = [
      b.name,
      b.kind,
      b.discount_type,
      b.value,
      JSON.stringify(b.plan_ids),
      b.starts_on,
      b.ends_on,
      b.active,
      JSON.stringify(b.member_ids),
    ];
    const r =
      req.method === "POST"
        ? await db.query(
            "INSERT INTO promotions(id,gym_id,name,kind,discount_type,value,plan_ids,starts_on,ends_on,active,member_ids) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb) RETURNING *",
            [randomUUID(), req.gymId, ...values],
          )
        : await db.query(
            "UPDATE promotions SET name=$3,kind=$4,discount_type=$5,value=$6,plan_ids=$7::jsonb,starts_on=$8,ends_on=$9,active=$10,member_ids=$11::jsonb WHERE id=$1 AND gym_id=$2 RETURNING *",
            [req.params.id, req.gymId, ...values],
          );
    if (!r.rows[0]) throw new HttpError(404, "Promoción no encontrada");
    res.json(r.rows[0]);
  }
  app.post("/api/promotions", permit("promos.manage"), savePromotion);
  app.put("/api/promotions/:id", permit("promos.manage"), savePromotion);
  app.post("/api/payments/quote", permit("payments.write"), async (req, res) =>
    res.json(
      await quote(
        db,
        req.gymId,
        orderSchema.parse(req.body),
        can(req, "promos.manage"),
      ),
    ),
  );
  app.post("/api/payments", permit("payments.write"), async (req, res) =>
    res
      .status(201)
      .json(
        await db.transaction((tx) =>
          charge(
            tx,
            req.gymId,
            req.user.id,
            orderSchema.parse(req.body),
            can(req, "promos.manage"),
          ),
        ),
      ),
  );
  app.get("/api/payments", permit("payments.read"), async (req, res) => {
    const memberId = req.query.member_id
      ? text.parse(req.query.member_id)
      : null;
    const limit = req.query.limit
      ? z.coerce.number().int().min(1).max(2000).parse(req.query.limit)
      : null;
    res.json(
      (
        await db.query(
          `SELECT p.*,m.name member_name,m.document member_document,m.phone member_phone,COALESCE(p.plan_snapshot,pl.name) plan_name,u.name created_by_name,COALESCE(o.promotion_name,'') promotion_name FROM payments p JOIN members m ON m.id=p.member_id JOIN subscriptions s ON s.id=p.subscription_id JOIN plans pl ON pl.id=s.plan_id JOIN users u ON u.id=p.created_by LEFT JOIN orders o ON o.id=p.order_id WHERE p.gym_id=$1 AND ($2::text IS NULL OR p.member_id=$2) ORDER BY p.created_at DESC,p.id DESC LIMIT $3`,
          [req.gymId, memberId, limit],
        )
      ).rows,
    );
  });
  app.get("/api/products", permit("products.read"), async (req, res) => {
    const rows = (
      await db.query(
        "SELECT * FROM products WHERE gym_id=$1 ORDER BY category,name",
        [req.gymId],
      )
    ).rows;
    res.json(
      rows.map((p) => {
        if (can(req, "products.manage") || can(req, "reports.read")) return p;
        const { cost_cents, ...visible } = p;
        return visible;
      }),
    );
  });
  async function saveProduct(req: Request, res: Response) {
    const b = productSchema.parse(req.body),
      fp = fingerprint({
        id: req.params.id || null,
        http_method: req.method,
        ...b,
      });
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [req.gymId]);
      if (b.request_key) {
        const prior = (
          await tx.query(
            "SELECT * FROM product_operations WHERE request_key=$1",
            [b.request_key],
          )
        ).rows[0];
        if (prior) {
          if (prior.gym_id !== req.gymId || prior.fingerprint !== fp)
            throw new HttpError(409, "Referencia de producto ya utilizada");
          return (
            await tx.query("SELECT * FROM products WHERE id=$1", [
              prior.product_id,
            ])
          ).rows[0];
        }
      }
      const id = req.method === "POST" ? randomUUID() : String(req.params.id);
      let previousStock = 0;
      if (req.method !== "POST") {
        const current = (
          await tx.query(
            "SELECT * FROM products WHERE id=$1 AND gym_id=$2 FOR UPDATE",
            [id, req.gymId],
          )
        ).rows[0];
        if (!current) throw new HttpError(404, "Producto no encontrado");
        previousStock = current.stock;
        if (
          b.stock !== undefined &&
          (b.expected_stock === undefined || b.expected_stock !== current.stock)
        )
          throw new HttpError(
            409,
            "El stock cambió desde que abriste el producto. Volvé a abrirlo antes de guardar.",
          );
      }
      const stock = b.stock ?? previousStock,
        delta = stock - previousStock;
      if (req.method !== "POST" && delta !== 0 && !b.stock_reason)
        throw new HttpError(400, "Indicá el motivo del ajuste de stock");
      if (
        b.record_stock_expense &&
        (delta <= 0 || delta * b.cost_cents > 1000000000)
      )
        throw new HttpError(
          400,
          "El egreso de stock requiere un ingreso de unidades con importe válido",
        );
      const row =
        req.method === "POST"
          ? (
              await tx.query(
                "INSERT INTO products(id,gym_id,name,category,price_cents,cost_cents,active,stock,low_stock_threshold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
                [
                  id,
                  req.gymId,
                  b.name,
                  b.category,
                  b.price_cents,
                  b.cost_cents,
                  b.active,
                  stock,
                  b.low_stock_threshold,
                ],
              )
            ).rows[0]
          : (
              await tx.query(
                "UPDATE products SET name=$3,category=$4,price_cents=$5,cost_cents=$6,active=$7,stock=$8,low_stock_threshold=$9 WHERE id=$1 AND gym_id=$2 RETURNING *",
                [
                  id,
                  req.gymId,
                  b.name,
                  b.category,
                  b.price_cents,
                  b.cost_cents,
                  b.active,
                  stock,
                  b.low_stock_threshold,
                ],
              )
            ).rows[0];
      if (delta !== 0)
        await tx.query(
          "INSERT INTO inventory_movements(id,gym_id,product_id,quantity,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            req.gymId,
            id,
            delta,
            req.method === "POST" ? "Stock inicial" : b.stock_reason,
            req.user.id,
          ],
        );
      if (b.record_stock_expense && delta * b.cost_cents > 0)
        await tx.query(
          "INSERT INTO expenses(id,gym_id,description,amount_cents,method,created_by,category,method_name,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [
            randomUUID(),
            req.gymId,
            `Compra inicial de stock: ${b.name} × ${delta}`,
            delta * b.cost_cents,
            b.method,
            req.user.id,
            "Stock",
            (await resolveMethod(tx, req.gymId, b)).name,
            b.reference,
          ],
        );
      if (b.request_key)
        await tx.query("INSERT INTO product_operations VALUES($1,$2,$3,$4)", [
          b.request_key,
          req.gymId,
          fp,
          id,
        ]);
      return row;
    });
    res.json(result);
  }
  app.post("/api/products", permit("products.manage"), saveProduct);
  app.put("/api/products/:id", permit("products.manage"), saveProduct);
  app.post(
    "/api/products/:id/restock",
    permit("products.manage"),
    async (req, res) => {
      const b = z
        .object({
          quantity: z.number().int().min(1).max(10000),
          unit_cost_cents: z.number().int().min(0).max(100000000),
          method,
          ...paymentFields,
          record_expense: z.boolean().default(true),
          request_key: z.uuid(),
        })
        .parse(req.body);
      if (b.quantity * b.unit_cost_cents > 1000000000)
        throw new HttpError(400, "Importe demasiado alto");
      await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [
          req.gymId,
        ]);
        const previous = (
          await tx.query(
            "SELECT * FROM inventory_movements WHERE request_key=$1",
            [b.request_key],
          )
        ).rows[0];
        if (previous) {
          if (
            previous.gym_id !== req.gymId ||
            previous.product_id !== req.params.id ||
            previous.fingerprint !== fingerprint(b)
          )
            throw new HttpError(409, "Referencia de reposición ya utilizada");
          return;
        }
        const old = (
          await tx.query(
            "SELECT * FROM products WHERE id=$1 AND gym_id=$2 FOR UPDATE",
            [req.params.id, req.gymId],
          )
        ).rows[0];
        if (!old) throw new HttpError(404, "Producto no encontrado");
        const stock = old.stock + b.quantity;
        if (stock > 100000000)
          throw new HttpError(400, "Cantidad de stock demasiado alta");
        const weightedCost = Number(
          (BigInt(old.stock) * BigInt(old.cost_cents) +
            BigInt(b.quantity) * BigInt(b.unit_cost_cents) +
            BigInt(Math.floor(stock / 2))) /
            BigInt(stock),
        );
        const product = (
          await tx.query(
            "UPDATE products SET stock=$3,cost_cents=$4 WHERE id=$1 AND gym_id=$2 RETURNING *",
            [req.params.id, req.gymId, stock, weightedCost],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO inventory_movements(id,gym_id,product_id,quantity,reason,request_key,fingerprint,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            randomUUID(),
            req.gymId,
            product.id,
            b.quantity,
            "Reposición",
            b.request_key,
            fingerprint(b),
            req.user.id,
          ],
        );
        if (b.record_expense && b.unit_cost_cents > 0)
          await tx.query(
            "INSERT INTO expenses(id,gym_id,description,amount_cents,method,created_by,category,method_name,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              randomUUID(),
              req.gymId,
              `Compra de stock: ${product.name} × ${b.quantity}`,
              b.quantity * b.unit_cost_cents,
              b.method,
              req.user.id,
              "Stock",
              (await resolveMethod(tx, req.gymId, b)).name,
              b.reference,
            ],
          );
      });
      res.sendStatus(204);
    },
  );
  app.post("/api/sales", permit("sales.write"), async (req, res) => {
    const b = z
      .object({
        product_id: text,
        quantity: z.number().int().min(1).max(10000),
        method,
        ...paymentFields,
        request_key: z.uuid(),
      })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [req.gymId]);
      const prior = (
        await tx.query("SELECT * FROM sales WHERE request_key=$1", [
          b.request_key,
        ])
      ).rows[0];
      if (prior) {
        if (prior.voided_at)
          throw new HttpError(
            409,
            "La venta fue anulada. Iniciá una nueva operación.",
          );
        if (prior.gym_id !== req.gymId || prior.fingerprint !== fingerprint(b))
          throw new HttpError(409, "Referencia ya utilizada");
        return prior;
      }
      const payMethod = await resolveMethod(tx, req.gymId, b);
      const p = (
        await tx.query(
          "SELECT * FROM products WHERE id=$1 AND gym_id=$2 AND active FOR UPDATE",
          [b.product_id, req.gymId],
        )
      ).rows[0];
      if (!p) throw new HttpError(404, "Producto no disponible");
      if (p.stock < b.quantity) throw new HttpError(400, "Stock insuficiente");
      if (
        p.price_cents * b.quantity > 1000000000 ||
        p.cost_cents * b.quantity > 1000000000
      )
        throw new HttpError(400, "Importe demasiado alto");
      await tx.query("UPDATE products SET stock=stock-$2 WHERE id=$1", [
        p.id,
        b.quantity,
      ]);
      await tx.query(
        "INSERT INTO inventory_movements(id,gym_id,product_id,quantity,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)",
        [randomUUID(), req.gymId, p.id, -b.quantity, "Venta", req.user.id],
      );
      return (
        await tx.query(
          "INSERT INTO sales(id,gym_id,product_id,product_snapshot,category_snapshot,quantity,amount_cents,cost_cents,method,created_by,request_key,fingerprint,method_name,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *",
          [
            randomUUID(),
            req.gymId,
            p.id,
            p.name,
            p.category,
            b.quantity,
            p.price_cents * b.quantity,
            p.cost_cents * b.quantity,
            b.method,
            req.user.id,
            b.request_key,
            fingerprint(b),
            payMethod.name,
            payMethod.reference,
          ],
        )
      ).rows[0];
    });
    if (!can(req, "reports.read")) {
      const { cost_cents, ...visible } = result;
      res.status(201).json(visible);
    } else res.status(201).json(result);
  });
  app.get("/api/sales", permit("payments.read"), async (req, res) => {
    const rows = (
      await db.query(
        "SELECT * FROM sales WHERE gym_id=$1 ORDER BY created_at DESC",
        [req.gymId],
      )
    ).rows;
    res.json(
      rows.map((s) => {
        if (can(req, "reports.read")) return s;
        const { cost_cents, ...visible } = s;
        return visible;
      }),
    );
  });
  app.get("/api/expenses", permit("reports.read"), async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM expenses WHERE gym_id=$1 ORDER BY created_at DESC",
          [req.gymId],
        )
      ).rows,
    ),
  );
  app.post("/api/expenses", permit("expenses.write"), async (req, res) => {
    const b = z
      .object({
        description: text,
        amount_cents: z.number().int().positive().max(1000000000),
        method,
        ...paymentFields,
        category: text.default("General"),
        request_key: z.uuid().optional(),
      })
      .parse(req.body);
    const result = await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [req.gymId]);
      if (b.request_key) {
        const old = (
          await tx.query("SELECT * FROM expenses WHERE request_key=$1", [
            b.request_key,
          ])
        ).rows[0];
        if (old) {
          if (
            old.gym_id !== req.gymId ||
            old.fingerprint !== fingerprint(b) ||
            old.voided_at
          )
            throw new HttpError(
              409,
              "Referencia utilizada en otro egreso o ya anulada.",
            );
          return old;
        }
      }
      const m = await resolveMethod(tx, req.gymId, b);
      return (
        await tx.query(
          "INSERT INTO expenses(id,gym_id,description,amount_cents,method,created_by,category,method_name,reference,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
          [
            randomUUID(),
            req.gymId,
            b.description,
            b.amount_cents,
            b.method,
            req.user.id,
            b.category,
            m.name,
            m.reference,
            b.request_key || null,
            fingerprint(b),
          ],
        )
      ).rows[0];
    });
    res.status(201).json(result);
  });
  app.get("/api/reports", permit("reports.read"), async (req, res) => {
    const start = isoDate.parse(req.query.from || today().slice(0, 7) + "-01"),
      end = isoDate.parse(req.query.to || today());
    if (end < start)
      throw new HttpError(400, "El rango de fechas no es válido");
    const scope = req.query.scope === "all";
    if (scope && req.user.role !== "owner")
      throw new HttpError(403, "Solo el dueño ve todas las sedes");
    const gyms = scope
      ? (
          await db.query("SELECT id FROM gyms WHERE account_id=$1", [
            req.user.account_id,
          ])
        ).rows.map((g) => g.id)
      : [req.gymId];
    const payments = (
      await db.query(
        `SELECT p.*,m.name member_name FROM payments p JOIN members m ON m.id=p.member_id WHERE p.gym_id=ANY($1::text[]) AND (p.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3`,
        [gyms, start, end],
      )
    ).rows;
    const sales = (
      await db.query(
        `SELECT * FROM sales WHERE gym_id=ANY($1::text[]) AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3`,
        [gyms, start, end],
      )
    ).rows;
    const expenses = (
      await db.query(
        `SELECT * FROM expenses WHERE gym_id=ANY($1::text[]) AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3`,
        [gyms, start, end],
      )
    ).rows;
    const active = (
      await db.query(
        `SELECT DISTINCT s.member_id,p.activity FROM subscriptions s JOIN members m ON m.id=s.member_id JOIN plans p ON p.id=s.plan_id WHERE s.gym_id=ANY($1::text[]) AND NOT m.archived AND s.cancelled_at IS NULL AND s.starts_on<=$2 AND s.ends_on>$2`,
        [gyms, end],
      )
    ).rows;
    const attendance = (
      await db.query(
        `SELECT COALESCE(NULLIF(activity,''),'Ingreso general') activity,count(*)::integer visits,count(DISTINCT member_id)::integer unique_members FROM checkins WHERE gym_id=ANY($1::text[]) AND allowed AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN $2 AND $3 GROUP BY activity ORDER BY visits DESC`,
        [gyms, start, end],
      )
    ).rows;
    const groups = new Map<string, Row>();
    const group = (name: string, kind: string) => {
      const key = kind + name;
      if (!groups.has(key))
        groups.set(key, {
          name,
          kind,
          income_cents: 0,
          expense_cents: 0,
          cost_of_sales_cents: 0,
          transactions: 0,
          active_members: 0,
        });
      return groups.get(key)!;
    };
    for (const p of payments.filter((p) => !p.voided_at)) {
      const g = group(p.activity_snapshot || "Actividad anterior", "Actividad");
      g.income_cents += p.amount_cents;
      g.transactions++;
    }
    for (const s of sales.filter((s) => !s.voided_at)) {
      const g = group(s.category_snapshot, "Consumibles");
      g.income_cents += s.amount_cents;
      g.cost_of_sales_cents += s.cost_cents;
      g.transactions += s.quantity;
    }
    for (const e of expenses.filter((e) => !e.voided_at)) {
      const g = group(e.category, "Egreso");
      g.expense_cents += e.amount_cents;
      g.transactions++;
    }
    for (const a of active) group(a.activity, "Actividad").active_members++;
    const rows = [...groups.values()].map((g) => ({
      ...g,
      balance_cents: g.income_cents - g.expense_cents,
    }));
    const sum = (items: Row[], key: string) =>
      items.filter((p) => !p.voided_at).reduce((a, p) => a + Number(p[key]), 0);
    const income = sum(payments, "amount_cents") + sum(sales, "amount_cents"),
      out = sum(expenses, "amount_cents");
    const movements: Row[] = [
      ...payments.map((p) => ({
        ...p,
        type: "Cuota",
        description: p.member_name + " · " + p.plan_snapshot,
      })),
      ...sales.map((s) => ({
        ...s,
        type: "Venta",
        description: s.product_snapshot + " × " + s.quantity,
      })),
      ...expenses.map((e) => ({ ...e, type: "Egreso" })),
    ].sort((a, b) =>
      String((b as Row).created_at).localeCompare(
        String((a as Row).created_at),
      ),
    );
    const daily = new Map<string, Row>();
    for (const m of movements.filter((m) => !m.voided_at)) {
      const d = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(m.created_at));
      if (!daily.has(d))
        daily.set(d, { day: d, income_cents: 0, expense_cents: 0 });
      daily.get(d)![m.type === "Egreso" ? "expense_cents" : "income_cents"] +=
        m.amount_cents;
    }
    res.json({
      from: start,
      to: end,
      income_cents: income,
      expense_cents: out,
      balance_cents: income - out,
      cost_of_sales_cents: sum(sales, "cost_cents"),
      rows,
      movements,
      daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
      attendance,
      passes: payments.filter((p) => !p.voided_at).length,
      charges: new Set(
        payments.filter((p) => !p.voided_at).map((p) => p.order_id || p.id),
      ).size,
      activity_definition:
        "Socios únicos con suscripción vigente al cierre del período; no son visitas ni asistencia.",
    });
  });
  app.get("/api/dashboard", permit("members.read"), async (req, res) => {
    const day = today();
    const m = (
      await db.query(
        `SELECT count(*) total,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM subscriptions s WHERE s.member_id=m.id AND s.cancelled_at IS NULL AND s.starts_on<=$2 AND s.ends_on>$2)) active FROM members m WHERE gym_id=$1 AND NOT archived`,
        [req.gymId, day],
      )
    ).rows[0];
    let income = { total: 0, today: 0 };
    if (can(req, "payments.read")) {
      income = (
        await db.query(
          `SELECT COALESCE(sum(amount_cents),0) total,COALESCE(sum(amount_cents) FILTER(WHERE d=$2),0) today FROM (SELECT amount_cents,(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date d FROM payments WHERE gym_id=$1 AND voided_at IS NULL UNION ALL SELECT amount_cents,(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date d FROM sales WHERE gym_id=$1 AND voided_at IS NULL) x WHERE d>=$3`,
          [req.gymId, day, day.slice(0, 7) + "-01"],
        )
      ).rows[0] as any;
    }
    res.json({
      upcoming: (
        await db.query(
          `SELECT m.id member_id,m.name,m.phone,p.activity,p.name plan_name,max(s.ends_on) ends_on FROM subscriptions s JOIN members m ON m.id=s.member_id JOIN plans p ON p.id=s.plan_id WHERE s.gym_id=$1 AND NOT m.archived AND s.cancelled_at IS NULL GROUP BY m.id,m.name,m.phone,p.id,p.activity,p.name HAVING max(s.ends_on)>=$2 AND max(s.ends_on)<=$3 ORDER BY max(s.ends_on),m.name LIMIT 30`,
          [req.gymId, day, addDays(day, 7)],
        )
      ).rows,
      low_stock:
        req.modules.products && can(req, "products.read")
          ? (
              await db.query(
                "SELECT id,name,stock,low_stock_threshold FROM products WHERE gym_id=$1 AND active AND stock<=low_stock_threshold ORDER BY stock,name LIMIT 30",
                [req.gymId],
              )
            ).rows
          : [],
      day,
      members: Number(m.total),
      active: Number(m.active),
      month_income: Number(income.total),
      today_income: Number(income.today),
    });
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Ruta no encontrada" }),
  );
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError)
      return res.status(400).json(validationErrors(error));
    if (error instanceof InputError)
      return res.status(400).json({
        error: error.message,
        fields: { [error.field]: error.message },
      });
    if (error.code === "23505")
      return res.status(409).json({
        error: String(error.constraint).includes("users_email")
          ? "Ese email ya tiene una cuenta. Ingresá o recuperá tu contraseña."
          : String(error.constraint).includes("members_gym_document")
            ? "Ya hay un socio con ese DNI en este gimnasio. Buscalo antes de crear otro."
            : "Ya existe un registro con esos datos. Revisá el formulario.",
      });
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "El archivo o los datos superan el tamaño permitido" });
    if (error instanceof HttpError)
      return res.status(error.status).json({ error: error.message });
    if (error.type === "entity.parse.failed")
      return res.status(400).json({
        error:
          "No pudimos leer el formulario. Revisá los datos y volvé a intentarlo.",
      });
    console.error(error);
    res.status(500).json({ error: "No se pudo completar la operación" });
  });
  return app;
}
