import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { Express } from "express";
import { rateLimit } from "express-rate-limit";
import type { Database } from "./db.js";
import { hashPassword, tokenHash } from "./security.js";
import { HttpError } from "./domain.js";
export type ResetMail = { to: string; subject: string; text: string };
export type ResetSender = (mail: ResetMail) => Promise<void>;
export function recoveryMode() {
  if (process.env.MAIL_MODE === "off") return "unavailable";
  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_FROM &&
    process.env.MAIL_MODE !== "local"
  )
    return "smtp";
  if (process.env.NODE_ENV !== "production" && process.env.MAIL_MODE !== "smtp")
    return "local";
  return "unavailable";
}
export function makeResetSender(): ResetSender | null {
  const mode = recoveryMode();
  if (mode === "local")
    return async (mail) => {
      const dir = resolve(".data/mail");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(dir, randomUUID() + ".json"),
        JSON.stringify(mail, null, 2),
        { mode: 0o600, flag: "wx" },
      );
    };
  if (mode !== "smtp") return null;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    ...(process.env.SMTP_USER
      ? {
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        }
      : {}),
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 10000,
    socketTimeout: 15000,
  });
  return async (mail) => {
    await transport.sendMail({ from: process.env.SMTP_FROM, ...mail });
  };
}
export function installRecovery(
  app: Express,
  db: Database,
  sender: ResetSender | null = makeResetSender(),
) {
  const limiter = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Demasiadas solicitudes. Esperá unos minutos." },
  });
  app.post("/api/auth/forgot-password", limiter, async (req, res) => {
    const { email } = z.object({ email: z.email() }).parse(req.body);
    if (!sender)
      throw new HttpError(
        503,
        "La recuperación por correo todavía no está habilitada. Contactá al administrador.",
      );
    const origin = process.env.APP_ORIGIN || "http://localhost:5173";
    if (process.env.NODE_ENV === "production" && !origin.startsWith("https://"))
      throw new HttpError(
        503,
        "La recuperación requiere una dirección HTTPS configurada",
      );
    const user = (
      await db.query("SELECT id,email FROM users WHERE email=$1 AND active", [
        email.toLowerCase(),
      ])
    ).rows[0];
    if (user) {
      const recent = (
        await db.query(
          "SELECT token_hash FROM password_resets WHERE user_id=$1 AND created_at>now()-interval '1 minute' AND used_at IS NULL",
          [user.id],
        )
      ).rows.length;
      if (!recent) {
        const token = randomBytes(32).toString("hex");
        await db.query(
          "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
          [tokenHash(token), user.id, new Date(Date.now() + 30 * 60000)],
        );
        try {
          await sender({
            to: user.email,
            subject: "Recuperar tu acceso a FITWare",
            text: `Recibimos una solicitud para recuperar tu acceso.\n\nAbrí este enlace en los próximos 30 minutos:\n${origin}/#reset=${token}\n\nSi no solicitaste el cambio, podés ignorar este correo.`,
          });
        } catch {
          await db.query(
            "UPDATE password_resets SET used_at=now() WHERE token_hash=$1",
            [tokenHash(token)],
          );
          console.error(
            "No se pudo entregar un correo de recuperación. Revisar la configuración del remitente.",
          );
        }
      }
    }
    res.status(202).json({
      message:
        "Si la cuenta está habilitada, se solicitó el envío de instrucciones para recuperar el acceso.",
      delivery: recoveryMode() === "local" ? "local" : "email",
    });
  });
  app.post("/api/auth/reset-password", limiter, async (req, res) => {
    const b = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z.string().min(10).max(200),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const reset = (
        await tx.query(
          "SELECT r.*,u.active FROM password_resets r JOIN users u ON u.id=r.user_id WHERE token_hash=$1 FOR UPDATE",
          [tokenHash(b.token)],
        )
      ).rows[0];
      if (
        !reset ||
        !reset.active ||
        reset.used_at ||
        new Date(reset.expires_at).getTime() <= Date.now()
      )
        throw new HttpError(
          400,
          "El enlace no es válido o ya venció. Solicitá uno nuevo.",
        );
      await tx.query("UPDATE users SET password_hash=$2 WHERE id=$1", [
        reset.user_id,
        hashPassword(b.password),
      ]);
      await tx.query(
        "UPDATE password_resets SET used_at=now() WHERE user_id=$1",
        [reset.user_id],
      );
      await tx.query("DELETE FROM sessions WHERE user_id=$1", [reset.user_id]);
    });
    res.json({ message: "Contraseña actualizada. Ya podés ingresar." });
  });
}
