import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Database } from "./db.js";
import { tokenHash } from "./security.js";

export const platformCookie = "fitware_platform_session";
export const tenantCookie = "fitware_session";
export const demoCookie = "fitware_demo_session";
export const sessionDuration = 8 * 60 * 60 * 1000;

export function sessionToken(req: Request, name: string) {
  const prefix = name + "=";
  const token = req.headers.cookie
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : "";
}

export function cookieOptions(path: string) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path,
  };
}

export function isDemoRequest(req: Request) {
  return (
    req.get("x-fitware-demo") === "1" ||
    (/^\/member-photos\/[^/]+$/.test(req.path) && req.query.demo === "1")
  );
}

export async function issueTenantSession(
  db: Database,
  res: Response,
  userId: string,
  demo = false,
) {
  const token = randomBytes(32).toString("hex");
  await db.query("INSERT INTO sessions VALUES($1,$2,$3)", [
    tokenHash(token),
    userId,
    new Date(Date.now() + sessionDuration),
  ]);
  res.cookie(demo ? demoCookie : tenantCookie, token, {
    ...cookieOptions("/api"),
    maxAge: sessionDuration,
  });
}
