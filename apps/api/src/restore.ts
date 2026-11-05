import { readFile } from "node:fs/promises";
import { connectDatabase } from "./db.js";
import { restoreAccount } from "./backups.js";
const path = process.argv[2];
if (!path)
  throw new Error(
    "Uso: npm run restore -- /ruta/respaldo.json.gz. Elegí una base de destino nueva en .env.",
  );
const db = await connectDatabase();
try {
  const result = await restoreAccount(db, await readFile(path));
  console.log(
    "Restauración completada para la organización " +
      result.account_id +
      ". Ingresá con tus credenciales anteriores.",
  );
} finally {
  await db.close();
}
