import type { Member } from "./types";
export function memberStatusFor(m: Member, day: string, activity = "all") {
  const subs = m.subscriptions.filter(
    (s) => activity === "all" || s.activity === activity,
  );
  return subs.some((s) => s.starts_on <= day && s.ends_on > day)
    ? "Activo"
    : subs.some((s) => s.starts_on > day)
      ? "Programado"
      : subs.length
        ? "Vencido"
        : "Sin cuota";
}
