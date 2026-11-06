import { z } from "zod";
export class InputError extends Error {
  constructor(
    message: string,
    public field: string,
  ) {
    super(message);
  }
}
const forbidden =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const secretKey = /(password|token|secret|signature)/i;
// Passwords and provider signatures must keep their exact original bytes.
export function normalizeInput(
  value: unknown,
  key = "",
  path = "",
  depth = 0,
): any {
  if (depth > 12)
    throw new InputError("Los datos tienen demasiados niveles.", path);
  if (typeof value === "string") {
    if (secretKey.test(key)) return value;
    if (value.length > 10000 || forbidden.test(value))
      throw new InputError(
        "Quitá los caracteres de control o acortá el texto.",
        path,
      );
    const cleaned = value.normalize("NFC").trim();
    return /email$/i.test(key) ? cleaned.toLowerCase() : cleaned;
  }
  if (typeof value === "number" && !Number.isFinite(value))
    throw new InputError("Ingresá un número válido.", path);
  if (Array.isArray(value)) {
    if (value.length > 1000)
      throw new InputError("Hay demasiados elementos.", path);
    return value.map((v, i) =>
      normalizeInput(v, key, path + "." + i, depth + 1),
    );
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(k))
        throw new InputError(
          "El formulario contiene una propiedad no permitida.",
          path,
        );
      result[k] = normalizeInput(v, k, path ? path + "." + k : k, depth + 1);
    }
    return result;
  }
  return value;
}
export const plainString = z.string().transform((value, ctx) => {
  try {
    return normalizeInput(value);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Quitá los caracteres de control del texto.",
    });
    return z.NEVER;
  }
});
const labels: Record<string, string> = {
  name: "Nombre",
  email: "Email",
  password: "Contraseña",
  confirm_password: "Confirmación de contraseña",
  new_password: "Nueva contraseña",
  current_password: "Contraseña actual",
  business_name: "Organización",
  gym_name: "Gimnasio",
  document: "DNI",
  phone: "Teléfono",
  address: "Dirección",
  emergency_name: "Contacto de emergencia",
  emergency_phone: "Teléfono de emergencia",
  notes: "Observaciones",
  plan_ids: "Actividades",
  member_id: "Socio",
  partner_id: "Segundo socio",
  promotion_id: "Promoción",
  price_cents: "Precio",
  cost_cents: "Costo",
  amount_cents: "Importe",
  discount_cents: "Descuento",
  stock: "Stock",
  quantity: "Cantidad",
  reason: "Motivo",
  from: "Desde",
  to: "Hasta",
  method: "Medio de pago",
  category: "Categoría",
  description: "Descripción",
  value: "Valor",
  role: "Rol",
  gym_ids: "Gimnasios",
};
export function validationErrors(error: z.ZodError) {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join("."),
      leaf = String(issue.path.at(-1) || "formulario");
    let detail = "Revisá este dato.";
    if (issue.code === "custom") detail = issue.message;
    else if (issue.code === "too_small")
      detail =
        issue.origin === "string"
          ? `Ingresá al menos ${issue.minimum} caracteres.`
          : issue.origin === "array"
            ? `Seleccioná al menos ${issue.minimum} opción(es).`
            : `Ingresá un valor mayor o igual a ${issue.minimum}.`;
    else if (issue.code === "too_big")
      detail =
        issue.origin === "string"
          ? `Usá hasta ${issue.maximum} caracteres.`
          : issue.origin === "array"
            ? `Seleccioná hasta ${issue.maximum} opciones.`
            : `Ingresá un valor menor o igual a ${issue.maximum}.`;
    else if (leaf === "email")
      detail = "Ingresá un email válido, por ejemplo nombre@correo.com.";
    else if (leaf === "document")
      detail = "Ingresá entre 6 y 12 números, sin puntos ni espacios.";
    else if (issue.code === "invalid_value")
      detail = "Seleccioná una opción válida.";
    else if (issue.code === "invalid_type")
      detail = "Completá el campo con un valor válido.";
    else if (issue.code === "invalid_format")
      detail = "Revisá el formato del dato.";
    fields[key] = (labels[leaf] || "Campo") + ": " + detail;
  }
  return { error: Object.values(fields).join(" "), fields };
}
