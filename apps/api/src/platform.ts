import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { Database } from "./db.js";
import { dateText, today } from "./dates.js";
import { HttpError } from "./domain.js";
import { serviceCoverage } from "./billing.js";
import { demoAccountId, demoOwnerId, demoGymId } from "./demo.js";
import { hashPassword, tokenHash, verifyPassword } from "./security.js";
import {
  cookieOptions,
  demoCookie,
  issueTenantSession,
  platformCookie,
  sessionDuration,
  sessionToken,
} from "./tenant-session.js";

const cookiePath = "/api/platform";
const email = z.email().max(254);
const invitation = z.object({
  email,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  expires: z.iso.datetime(),
});

function activeInvite() {
  try {
    const config = invitation.parse(
      JSON.parse(process.env.PLATFORM_ADMIN_INVITE || "null"),
    );
    if (Date.parse(config.expires) > Date.now()) return config;
  } catch {
    // An absent or incomplete configuration leaves enrollment closed.
  }
}

type Client = {
  id: string;
  organization: string;
  name: string;
  active: boolean;
  created_at: Date;
  trial_until: string;
  paid_until: string | null;
  gym_count: number;
};

const selectClients = `
  SELECT a.id,a.name organization,a.created_at,a.trial_until,a.paid_until,
         u.name,u.active,(SELECT count(*)::integer FROM gyms g WHERE g.account_id=a.id) gym_count
  FROM accounts a
  JOIN LATERAL (
    SELECT name,active
    FROM users WHERE account_id=a.id AND role='owner'
    ORDER BY active DESC,id LIMIT 1
  ) u ON true
  WHERE NOT a.is_demo`;

function groupByAccount<T extends { account_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const account = grouped.get(row.account_id);
    if (account) account.push(row);
    else grouped.set(row.account_id, [row]);
  }
  return grouped;
}

type Receipt = { account_id: string; starts_on: string; ends_on: string };
function describe(client: Client, receipts: Receipt[], day: string) {
  const coverage = serviceCoverage(client.trial_until, receipts, day);
  return {
    id: client.id,
    organization: client.organization,
    name: client.name,
    gym_count: client.gym_count,
    status:
      !client.active || !coverage.active
        ? "inactive"
        : coverage.paid
          ? "paid"
          : "trial",
    until: coverage.active
      ? coverage.until
      : [
          client.paid_until ? dateText(client.paid_until) : "",
          dateText(client.trial_until),
        ]
          .sort()
          .at(-1),
    created_at: client.created_at,
  };
}

export function platformRoutes(db: Database, loginLimiter: RequestHandler) {
  const router = Router();

  async function session(res: Response) {
    const token = randomBytes(32).toString("hex");
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM platform_sessions WHERE expires_at<=now()");
      await tx.query(
        "INSERT INTO platform_sessions(token_hash,expires_at) VALUES($1,$2)",
        [tokenHash(token), new Date(Date.now() + sessionDuration)],
      );
    });
    res.cookie(platformCookie, token, {
      ...cookieOptions(cookiePath),
      maxAge: sessionDuration,
    });
  }
  const currentAdmin = (token: string) =>
    db
      .query<{ email: string }>(
        `SELECT a.email FROM platform_admin a JOIN platform_sessions s ON s.admin_id=a.id
       WHERE s.token_hash=$1 AND s.expires_at>now()`,
        [tokenHash(token)],
      )
      .then((result) => result.rows[0]);

  router.get("/me", async (req, res) => {
    const admin = await currentAdmin(sessionToken(req, platformCookie));
    if (admin) return res.json({ authenticated: true, email: admin.email });
    const setup =
      Boolean(activeInvite()) &&
      !(await db.query("SELECT id FROM platform_admin")).rows.length;
    res.json({ authenticated: false, setup });
  });

  router.post("/setup", loginLimiter, async (req, res) => {
    const invite = activeInvite();
    if (!invite)
      throw new HttpError(403, "La activación no está disponible o venció.");
    const input = z
      .object({
        email,
        token: z.string().min(1).max(150),
        password: z.string().min(14).max(200),
        confirm_password: z.string().min(1).max(200),
      })
      .refine((data) => data.password === data.confirm_password, {
        path: ["confirm_password"],
        message: "Las contraseñas no coinciden.",
      })
      .parse(req.body);
    if (
      input.email !== invite.email.toLowerCase() ||
      !timingSafeEqual(
        Buffer.from(tokenHash(input.token), "hex"),
        Buffer.from(invite.hash, "hex"),
      )
    )
      throw new HttpError(
        403,
        "El email o el código de activación es incorrecto.",
      );
    const inserted = await db.query(
      "INSERT INTO platform_admin(id,email,password_hash) VALUES(1,$1,$2) ON CONFLICT(id) DO NOTHING RETURNING id",
      [input.email, hashPassword(input.password)],
    );
    if (!inserted.rows.length)
      throw new HttpError(
        409,
        "La cuenta ya fue activada. Ingresá con tu contraseña.",
      );
    await session(res);
    res.status(201).json({ authenticated: true, email: input.email });
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const input = z
      .object({ email, password: z.string().min(1).max(200) })
      .parse(req.body);
    const admin = (
      await db.query<{ email: string; password_hash: string }>(
        "SELECT email,password_hash FROM platform_admin",
      )
    ).rows[0];
    if (
      !admin ||
      !verifyPassword(input.password, admin.password_hash) ||
      input.email !== admin.email
    )
      throw new HttpError(401, "Email o contraseña incorrectos.");
    await session(res);
    res.json({ authenticated: true, email: admin.email });
  });

  router.use(async (req, _res, next) => {
    if (!(await currentAdmin(sessionToken(req, platformCookie))))
      throw new HttpError(401, "Ingresá al panel privado para continuar.");
    next();
  });

  router.post("/logout", async (req, res) => {
    await db.transaction(async (tx) => {
      await tx.query("DELETE FROM platform_sessions WHERE token_hash=$1", [
        tokenHash(sessionToken(req, platformCookie)),
      ]);
      await tx.query(
        "DELETE FROM sessions WHERE token_hash=$1 AND user_id=$2",
        [tokenHash(sessionToken(req, demoCookie)), demoOwnerId],
      );
    });
    res.clearCookie(platformCookie, cookieOptions(cookiePath));
    res.clearCookie(demoCookie, cookieOptions("/api"));
    res.sendStatus(204);
  });

  router.get("/clients", async (req, res) => {
    const { q, status, page } = z
      .object({
        q: z.string().max(180).default(""),
        status: z.enum(["all", "active", "inactive"]).default("all"),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(req.query);
    const day = today();
    const [clients, receipts, gyms] = await Promise.all([
      db.query<Client>(selectClients + " ORDER BY lower(u.name),a.id"),
      db.query<Receipt>(
        "SELECT account_id,starts_on,ends_on FROM billing_receipts WHERE status='approved' AND ends_on>$1 ORDER BY starts_on,ends_on",
        [day],
      ),
      db.query<{ account_id: string; name: string }>(
        "SELECT account_id,name FROM gyms",
      ),
    ]);
    const receiptsByAccount = groupByAccount(receipts.rows);
    const gymsByAccount = groupByAccount(gyms.rows);
    const data = clients.rows.map((client) =>
      describe(client, receiptsByAccount.get(client.id) || [], day),
    );
    const query = q.toLocaleLowerCase("es-AR");
    const filtered = data.filter(
      (client) =>
        (status === "all" ||
          (status === "active") === (client.status !== "inactive")) &&
        (!query ||
          [
            client.name,
            client.organization,
            ...(gymsByAccount.get(client.id) || []).map((gym) => gym.name),
          ].some((value) => value.toLocaleLowerCase("es-AR").includes(query))),
    );
    const perPage = 20;
    res.json({
      clients: filtered.slice((page - 1) * perPage, page * perPage),
      total: filtered.length,
      per_page: perPage,
      summary: {
        clients: data.length,
        active: data.filter((client) => client.status !== "inactive").length,
        gyms: data.reduce((sum, client) => sum + client.gym_count, 0),
      },
      demo: gymsByAccount.has(demoAccountId),
    });
  });

  router.get("/clients/:id", async (req, res) => {
    const id = z.string().min(1).max(180).parse(req.params.id);
    const day = today();
    // Contact fields are sent only when this client's profile is opened.
    const [clients, receipts, gyms, contacts] = await Promise.all([
      db.query<Client>(selectClients + " AND a.id=$1", [id]),
      db.query<Receipt>(
        "SELECT account_id,starts_on,ends_on FROM billing_receipts WHERE account_id=$1 AND status='approved' ORDER BY starts_on,ends_on",
        [id],
      ),
      db.query(
        "SELECT id,name,address FROM gyms WHERE account_id=$1 ORDER BY lower(name),id",
        [id],
      ),
      db.query(
        "SELECT email,phone,address,active FROM users WHERE account_id=$1 AND role='owner' ORDER BY active DESC,id LIMIT 1",
        [id],
      ),
    ]);
    if (!clients.rows.length)
      throw new HttpError(404, "Cliente no encontrado.");
    const client = describe(clients.rows[0], receipts.rows, day);
    res.json({
      ...client,
      ...contacts.rows[0],
      gyms: gyms.rows.map((gym) => ({ ...gym, status: client.status })),
    });
  });

  router.post("/demo", async (_req, res) => {
    const { rows } = await db.query(
      "SELECT g.id FROM gyms g JOIN accounts a ON a.id=g.account_id WHERE g.id=$1 AND a.id=$2 AND a.is_demo",
      [demoGymId, demoAccountId],
    );
    if (!rows.length)
      throw new HttpError(404, "El gimnasio demo todavía no está disponible.");
    await issueTenantSession(db, res, demoOwnerId, true);
    res.sendStatus(204);
  });
  return router;
}
