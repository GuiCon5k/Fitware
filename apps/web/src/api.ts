let gymId = "";
export const setGym = (id: string) => {
  gymId = id;
};
export async function downloadApi(path: string, filename: string) {
  const res = await fetch("/api" + path, {
    credentials: "same-origin",
    headers: {
      "X-Fitware-Client": "web",
      ...(gymId ? { "X-Gym-Id": gymId } : {}),
    },
  }).catch(() => {
    throw new Error(
      "No pudimos conectar con el servidor. Revisá tu conexión e intentá nuevamente; los datos del formulario se conservan.",
    );
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "No se pudo descargar el archivo" }));
    throw new Error(data.error);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch("/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Fitware-Client": "web",
      ...(gymId ? { "X-Gym-Id": gymId } : {}),
      ...options.headers,
    },
  }).catch(() => {
    throw new Error(
      "No pudimos conectar con el servidor. Revisá tu conexión e intentá nuevamente; los datos del formulario se conservan.",
    );
  });
  if (!res.ok) {
    const data = await res
      .json()
      .catch(() => ({ error: "No se pudo conectar con el servidor" }));
    if (res.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(data.error || "No se pudo completar la operación");
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export const money = (cents: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export const shortDate = (value: string) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value.length === 10 ? value + "T12:00:00" : value));
export const localDay = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
export function exportCSV(filename: string, rows: unknown[][]) {
  const escape = (v: unknown) =>
    '"' +
    (/^[\s\u0000-\u001f]*[=+@\-]/u.test(String(v)) ? "'" : "") +
    String(v ?? "").replace(/"/g, '""') +
    '"';
  const blob = new Blob(
    ["\uFEFF" + rows.map((r) => r.map(escape).join(";")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
