import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { Database, Row } from "./db.js";
import { memberSchema } from "./validators.js";
import { HttpError } from "./domain.js";
import { audit } from "./features.js";
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const aliases: Record<string, string> = {
  nombre: "name",
  nombreyapellido: "name",
  documento: "document",
  dni: "document",
  email: "email",
  correo: "email",
  telefono: "phone",
  direccion: "address",
  contactoemergencia: "emergency_name",
  telefonoemergencia: "emergency_phone",
  actividades: "activities",
  planes: "activities",
  observaciones: "notes",
};
export async function importTemplate(db: Database, gymId: string) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Socios");
  sheet.columns = [
    { header: "Nombre", key: "name", width: 25 },
    { header: "DNI", key: "document", width: 16 },
    { header: "Email", key: "email", width: 27 },
    { header: "Teléfono", key: "phone", width: 20 },
    { header: "Dirección", key: "address", width: 30 },
    { header: "Contacto emergencia", key: "emergency", width: 25 },
    { header: "Teléfono emergencia", key: "emergency_phone", width: 23 },
    { header: "Actividades", key: "activities", width: 45 },
    { header: "Observaciones", key: "notes", width: 35 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF285B43" },
  };
  sheet.getColumn(2).numFmt = "@";
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  const instructions = book.addWorksheet("Instrucciones");
  instructions.addRow([
    "Completá la primera hoja. Máximo 500 socios por archivo. No incluyas fórmulas.",
  ]);
  instructions.addRow([
    "Nombre y DNI son obligatorios. Separá varias actividades con |. No se cargan pagos.",
  ]);
  instructions.addRow(["Los DNI existentes se omiten y no se sobrescriben."]);
  instructions.addRow(["Actividades disponibles:"]);
  for (const p of (
    await db.query(
      "SELECT name,activity FROM plans WHERE gym_id=$1 AND active ORDER BY activity,name",
      [gymId],
    )
  ).rows)
    instructions.addRow([p.activity + " - " + p.name]);
  instructions.getColumn(1).width = 100;
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function previewImport(
  db: Database,
  gymId: string,
  userId: string,
  bytes: Buffer,
  mime: string,
) {
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > 2 * 1024 * 1024
  )
    throw new HttpError(400, "Usá un archivo de hasta 2 MB");
  const book = new ExcelJS.Workbook();
  try {
    if (mime.includes("csv")) {
      const line = bytes.toString("utf8").split(/\r?\n/, 1)[0];
      await book.csv.read(Readable.from(bytes), {
        parserOptions: {
          delimiter:
            line.split(";").length > line.split(",").length ? ";" : ",",
          ignoreEmpty: true,
        },
        map: (value) => String(value ?? ""),
      });
    } else await book.xlsx.load(bytes as any);
  } catch {
    throw new HttpError(
      400,
      "No se pudo leer el archivo. Usá el formato de la plantilla .xlsx o un CSV válido.",
    );
  }
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount < 2)
    throw new HttpError(400, "La primera hoja no tiene socios para importar");
  if (sheet.rowCount > 501 || sheet.columnCount > 30)
    throw new HttpError(
      400,
      "Importá hasta 500 socios por archivo usando la plantilla",
    );
  const headers = new Map<number, string>();
  sheet.getRow(1).eachCell((cell, index) => {
    const key = aliases[normalize(cell.text)];
    if (key) {
      if ([...headers.values()].includes(key))
        throw new HttpError(
          400,
          "Hay columnas repetidas. Usá una sola columna para cada dato.",
        );
      headers.set(index, key);
    }
  });
  if (
    ![...headers.values()].includes("name") ||
    ![...headers.values()].includes("document")
  )
    throw new HttpError(400, "Faltan las columnas Nombre y DNI");
  const plans = (
    await db.query(
      "SELECT id,name,activity FROM plans WHERE gym_id=$1 AND active",
      [gymId],
    )
  ).rows;
  const existing = new Set(
    (
      await db.query("SELECT document FROM members WHERE gym_id=$1", [gymId])
    ).rows.map((m) => m.document),
  );
  const seen = new Set<string>();
  const rows: Row[] = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    if (!row.actualCellCount) continue;
    const raw: Row = {},
      errors: string[] = [];
    for (const [column, key] of headers) {
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.Formula) {
        errors.push("No se admiten fórmulas");
        continue;
      }
      if (cell.text.length > 2000) {
        errors.push("Una celda tiene demasiado texto");
        continue;
      }
      raw[key] = cell.text.trim();
    }
    const planIds: string[] = [];
    for (const name of String(raw.activities || "")
      .split("|")
      .map((v) => v.trim())
      .filter(Boolean)) {
      const matches = plans.filter(
        (p) =>
          normalize(p.name) === normalize(name) ||
          normalize(p.activity + " - " + p.name) === normalize(name),
      );
      if (matches.length !== 1)
        errors.push("Actividad no encontrada o ambigua: " + name);
      else planIds.push(matches[0].id);
    }
    const parsed = memberSchema.safeParse({
      ...raw,
      plan_ids: [...new Set(planIds)],
    });
    if (!parsed.success)
      errors.push(
        ...parsed.error.issues.map((i) =>
          i.path[0] === "document"
            ? "DNI: usá entre 6 y 12 números"
            : i.path[0] === "name"
              ? "Nombre: completá un nombre válido"
              : i.path[0] === "email"
                ? "Email: revisá el formato"
                : String(i.path[0]) + ": revisá el dato",
        ),
      );
    let status = errors.length ? "error" : "valid";
    if (
      !errors.length &&
      (existing.has(raw.document) || seen.has(raw.document))
    )
      status = "duplicate";
    seen.add(raw.document);
    rows.push({
      row: index,
      name: raw.name || "",
      document: raw.document || "",
      status,
      errors,
      member: parsed.success ? parsed.data : null,
    });
  }
  if (!rows.length)
    throw new HttpError(400, "No se encontraron filas con datos");
  const id = randomUUID();
  await db.query(
    "INSERT INTO import_batches(id,gym_id,created_by,rows,expires_at) VALUES($1,$2,$3,$4::jsonb,$5)",
    [
      id,
      gymId,
      userId,
      JSON.stringify(rows),
      new Date(Date.now() + 30 * 60000),
    ],
  );
  return {
    id,
    rows,
    valid: rows.filter((r) => r.status === "valid").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    errors: rows.filter((r) => r.status === "error").length,
  };
}
export async function commitImport(
  db: Database,
  gymId: string,
  userId: string,
  accountId: string,
  batchId: string,
) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM gyms WHERE id=$1 FOR UPDATE", [gymId]);
    const batch = (
      await tx.query(
        "SELECT * FROM import_batches WHERE id=$1 AND gym_id=$2 AND created_by=$3 FOR UPDATE",
        [batchId, gymId, userId],
      )
    ).rows[0];
    if (!batch) throw new HttpError(404, "Vista previa no encontrada");
    if (batch.status === "committed") return batch.result;
    if (new Date(batch.expires_at).getTime() <= Date.now())
      throw new HttpError(
        409,
        "La vista previa venció. Volvé a subir el archivo.",
      );
    let imported = 0,
      skipped = 0;
    const details: Row[] = [];
    for (const row of batch.rows) {
      if (row.status !== "valid") {
        skipped++;
        continue;
      }
      const b = memberSchema.parse(row.member);
      if (
        (
          await tx.query(
            "SELECT id FROM members WHERE gym_id=$1 AND document=$2",
            [gymId, b.document],
          )
        ).rows.length
      ) {
        skipped++;
        details.push({ row: row.row, reason: "El DNI ya existe" });
        continue;
      }
      let planChanged = false;
      for (const id of b.plan_ids)
        if (
          !(
            await tx.query(
              "SELECT id FROM plans WHERE id=$1 AND gym_id=$2 AND active",
              [id, gymId],
            )
          ).rows.length
        )
          planChanged = true;
      if (planChanged) {
        skipped++;
        details.push({
          row: row.row,
          reason: "Una actividad dejó de estar disponible",
        });
        continue;
      }
      const id = randomUUID();
      await tx.query(
        "INSERT INTO members(id,gym_id,name,document,email,phone,address,emergency_name,emergency_phone,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          gymId,
          b.name,
          b.document,
          b.email,
          b.phone,
          b.address,
          b.emergency_name,
          b.emergency_phone,
          b.notes,
        ],
      );
      for (const pid of b.plan_ids)
        await tx.query("INSERT INTO member_activities VALUES($1,$2)", [
          id,
          pid,
        ]);
      imported++;
    }
    const result = { imported, skipped, details };
    await tx.query(
      "UPDATE import_batches SET status='committed',result=$2::jsonb WHERE id=$1",
      [batchId, JSON.stringify(result)],
    );
    await audit(tx, accountId, userId, "members.import", result, gymId);
    return result;
  });
}
