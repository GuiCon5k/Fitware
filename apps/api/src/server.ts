import { connectDatabase, migrate } from "./db.js";
import { seed } from "./seed.js";
import { createApp } from "./app.js";
import { createBackupService } from "./backups.js";
import express from "express";
import { fileURLToPath } from "node:url";
const production = process.env.NODE_ENV === "production";
if (production && !process.env.DATABASE_URL)
  throw new Error(
    "Producción requiere DATABASE_URL de PostgreSQL persistente.",
  );
if (process.env.RENDER_EXTERNAL_URL && !process.env.APP_ORIGIN)
  process.env.APP_ORIGIN = process.env.RENDER_EXTERNAL_URL;
const db = await connectDatabase();
await migrate(db);
if (!production || process.env.ADMIN_PASSWORD) await seed(db);
const backups = createBackupService(db);
const stopBackups = backups.start();
const app = createApp(db, { backups });
if (production) {
  const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
  app.use(express.static(webRoot));
  app.get("/{*path}", (req, res, next) => {
    if (req.accepts("html")) res.sendFile("index.html", { root: webRoot });
    else next();
  });
}
const server = app.listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1"),
  () => console.log("FITWare iniciado en puerto " + (process.env.PORT || 3001)),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      stopBackups();
      void db.close().then(() => process.exit(0));
    }),
  );
