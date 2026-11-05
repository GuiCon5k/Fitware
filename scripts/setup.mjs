import { randomBytes } from "node:crypto";
import { writeFile, access } from "node:fs/promises";
try {
  await access(".env");
  console.log("Ya existe .env. No se modificó tu configuración.");
  process.exit(0);
} catch {}
const owner = randomBytes(15).toString("base64url");
const reception = randomBytes(15).toString("base64url");
await writeFile(
  ".env",
  `PORT=3001\nAPP_ORIGIN=http://localhost:5173\nADMIN_EMAIL=dueno@fitware.local\nADMIN_PASSWORD=${owner}\nRECEPTION_EMAIL=recepcion@fitware.local\nRECEPTION_PASSWORD=${reception}\nSEED_DEMO=true\nREQUIRE_SUBSCRIPTION=false\nMAIL_MODE=local\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Configuración local creada. Guardá estas credenciales en un lugar seguro.",
);
console.log(
  `Dueño: dueno@fitware.local\nContraseña: ${owner}\n\nRecepción: recepcion@fitware.local\nContraseña: ${reception}`,
);
console.log(
  "\nEjecutá npm run dev y abrí http://localhost:5173.\nLas contraseñas solo inicializan las cuentas al crear la base por primera vez.",
);
