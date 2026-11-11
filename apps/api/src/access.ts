import express, { type Express, type RequestHandler } from "express";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { Database, Row } from "./db.js";
import { HttpError, text, fingerprint } from "./domain.js";
import { tokenHash } from "./security.js";
import { today, dateText } from "./dates.js";
import { audit } from "./features.js";

export const photoParser = express.raw({
  type: ["image/jpeg", "image/png"],
  limit: "2mb",
});
const accessInput = z.object({
  identifier: text,
  activity: z.string().max(180).default(""),
});
export async function lookupAccess(
  db: Database,
  gymId: string,
  identifier: string,
  activity: string,
) {
  let m: Row | undefined;
  if (identifier.startsWith("FW1-"))
    m = (
      await db.query(
        "SELECT m.id,m.name,m.document,m.phone FROM members m JOIN access_credentials c ON c.member_id=m.id WHERE c.token_hash=$1 AND c.gym_id=$2 AND m.gym_id=$2 AND NOT m.archived",
        [tokenHash(identifier), gymId],
      )
    ).rows[0];
  else
    m = (
      await db.query(
        "SELECT id,name,document,phone FROM members WHERE document=$1 AND gym_id=$2 AND NOT archived",
        [identifier, gymId],
      )
    ).rows[0];
  if (!m)
    throw new HttpError(
      404,
      "No encontramos ese DNI o credencial en esta sede. Revisá el dato o buscá al socio por nombre.",
    );
  const day = today();
  const passes = (
    await db.query(
      `SELECT p.id plan_id,p.name,p.activity,s.starts_on,s.ends_on FROM subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.member_id=$1 AND s.gym_id=$2 AND s.cancelled_at IS NULL ORDER BY s.ends_on DESC`,
      [m.id, gymId],
    )
  ).rows;
  for (const p of passes) {
    p.starts_on = dateText(p.starts_on);
    p.ends_on = dateText(p.ends_on);
  }
  const active = passes.filter(
    (p) => dateText(p.starts_on) <= day && dateText(p.ends_on) > day,
  );
  const eligible = activity
    ? active.filter((p) => p.activity === activity)
    : active;
  const photo = (
    await db.query(
      "SELECT updated_at FROM member_photos WHERE member_id=$1 AND gym_id=$2",
      [m.id, gymId],
    )
  ).rows[0];
  return {
    member: {
      id: String(m.id),
      name: String(m.name),
      document: String(m.document),
      phone: String(m.phone),
      photo_updated_at: photo?.updated_at || null,
    },
    active,
    latest: passes.slice(0, 12),
    allowed: eligible.length > 0,
    reason: eligible.length
      ? "Pase vigente"
      : activity
        ? `Sin pase vigente para ${activity}`
        : "Sin pases vigentes",
    day,
  };
}
export function installAccess(
  app: Express,
  db: Database,
  permit: (p: string) => RequestHandler,
) {
  app.put(
    "/api/members/:id/photo",
    permit("members.write"),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body) || !req.body.length)
        throw new HttpError(
          400,
          "Seleccioná una foto JPG o PNG de hasta 2 MB.",
        );
      if (
        !(
          await db.query(
            "SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived",
            [req.params.id, req.gymId],
          )
        ).rows.length
      )
        throw new HttpError(404, "Socio no encontrado");
      let image: Buffer;
      try {
        const input = sharp(req.body, {
          limitInputPixels: 16000000,
          animated: false,
        });
        const metadata = await input.metadata();
        if (!["jpeg", "png"].includes(metadata.format || ""))
          throw new Error("format");
        image = await input
          .rotate()
          .resize(480, 480, { fit: "cover", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch {
        throw new HttpError(
          400,
          "La imagen no es válida. Usá una foto JPG o PNG de hasta 2 MB.",
        );
      }
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO member_photos(member_id,gym_id,image_base64) VALUES($1,$2,$3) ON CONFLICT(member_id) DO UPDATE SET image_base64=$3,updated_at=now()",
          [req.params.id, req.gymId, image.toString("base64")],
        );
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "member.photo_updated",
          { member_id: req.params.id },
          req.gymId,
        );
      });
      res.json({ ok: true });
    },
  );
  app.delete(
    "/api/members/:id/photo",
    permit("members.write"),
    async (req, res) => {
      await db.transaction(async (tx) => {
        await tx.query(
          "DELETE FROM member_photos WHERE member_id=$1 AND gym_id=$2",
          [req.params.id, req.gymId],
        );
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "member.photo_removed",
          { member_id: req.params.id },
          req.gymId,
        );
      });
      res.status(204).end();
    },
  );
  app.get(
    "/api/member-photos/:id",
    permit("members.read"),
    async (req, res) => {
      const p = (
        await db.query(
          "SELECT p.image_base64 FROM member_photos p JOIN members m ON m.id=p.member_id WHERE p.member_id=$1 AND p.gym_id=$2 AND m.gym_id=$2 AND NOT m.archived",
          [req.params.id, req.gymId],
        )
      ).rows[0];
      if (!p) throw new HttpError(404, "Foto no disponible");
      res.type("image/jpeg").send(Buffer.from(p.image_base64, "base64"));
    },
  );
  app.post(
    "/api/members/:id/credential",
    permit("access.manage"),
    async (req, res) => {
      const token = "FW1-" + randomBytes(24).toString("base64url");
      await db.transaction(async (tx) => {
        if (
          !(
            await tx.query(
              "SELECT id FROM members WHERE id=$1 AND gym_id=$2 AND NOT archived FOR UPDATE",
              [req.params.id, req.gymId],
            )
          ).rows.length
        )
          throw new HttpError(404, "Socio no encontrado");
        await tx.query(
          "INSERT INTO access_credentials(member_id,gym_id,token_hash) VALUES($1,$2,$3) ON CONFLICT(member_id) DO UPDATE SET token_hash=$3,created_at=now()",
          [req.params.id, req.gymId, tokenHash(token)],
        );
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "access.credential_rotated",
          { member_id: req.params.id },
          req.gymId,
        );
      });
      res.status(201).json({ credential: token });
    },
  );
  app.delete(
    "/api/members/:id/credential",
    permit("access.manage"),
    async (req, res) => {
      await db.transaction(async (tx) => {
        await tx.query(
          "DELETE FROM access_credentials WHERE member_id=$1 AND gym_id=$2",
          [req.params.id, req.gymId],
        );
        await audit(
          tx,
          req.user.account_id,
          req.user.id,
          "access.credential_revoked",
          { member_id: req.params.id },
          req.gymId,
        );
      });
      res.status(204).end();
    },
  );
  app.post("/api/access/lookup", permit("access.checkin"), async (req, res) => {
    const b = accessInput.parse(req.body);
    res.json(await lookupAccess(db, req.gymId, b.identifier, b.activity));
  });
  app.post(
    "/api/access/checkins",
    permit("access.checkin"),
    async (req, res) => {
      const b = accessInput.extend({ request_key: z.uuid() }).parse(req.body);
      const result = await db.transaction(async (tx) => {
        await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [
          req.gymId,
        ]);
        const old = (
          await tx.query("SELECT * FROM checkins WHERE request_key=$1", [
            b.request_key,
          ])
        ).rows[0];
        // Never persist a reusable access credential in logs or request fingerprints.
        const fp = tokenHash(fingerprint(b));
        if (old) {
          if (old.gym_id !== req.gymId || old.fingerprint !== fp)
            throw new HttpError(409, "Referencia de ingreso utilizada");
          return old;
        }
        const data = await lookupAccess(
          tx,
          req.gymId,
          b.identifier,
          b.activity,
        );
        const recent = (
          await tx.query(
            "SELECT * FROM checkins WHERE gym_id=$1 AND member_id=$2 AND activity=$3 AND allowed=$4 AND created_at>now()-interval '60 seconds' ORDER BY created_at DESC LIMIT 1",
            [req.gymId, data.member.id, b.activity, data.allowed],
          )
        ).rows[0];
        if (recent) return { ...recent, duplicate: true };
        return (
          await tx.query(
            "INSERT INTO checkins(id,gym_id,member_id,activity,allowed,reason,created_by,request_key,fingerprint) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
            [
              randomUUID(),
              req.gymId,
              data.member.id,
              b.activity,
              data.allowed,
              data.reason,
              req.user.id,
              b.request_key,
              fp,
            ],
          )
        ).rows[0];
      });
      res.status(201).json(result);
    },
  );
  app.get(
    "/api/access/checkins",
    permit("access.checkin"),
    async (req, res) => {
      res.json(
        (
          await db.query(
            "SELECT c.id,c.activity,c.allowed,c.reason,c.created_at,m.name,m.document,u.name operator FROM checkins c JOIN members m ON m.id=c.member_id JOIN users u ON u.id=c.created_by WHERE c.gym_id=$1 ORDER BY c.created_at DESC LIMIT 100",
            [req.gymId],
          )
        ).rows,
      );
    },
  );
}
