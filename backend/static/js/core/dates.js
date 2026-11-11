// Utilitários de data — sempre trabalhando com strings ISO "AAAA-MM-DD" no fuso local.

const pad = (n) => String(n).padStart(2, "0");

export function toISO(date){
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseISO(iso){
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n){
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso, n){
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

/** Semana começando na segunda-feira */
export function startOfWeek(iso){
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // seg=0 ... dom=6
  d.setDate(d.getDate() - dow);
  return toISO(d);
}
export const endOfWeek = (iso) => addDays(startOfWeek(iso), 6);

export function startOfMonth(iso){
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth(), 1));
}
export function endOfMonth(iso){
  const d = parseISO(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function eachDay(from, to, limit = 400){
  const out = [];
  let cur = from;
  while (cur <= to && out.length < limit){
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export const weekdayIndex = (iso) => (parseISO(iso).getDay() + 6) % 7;

export function fmtDate(iso, opts){
  try{ return parseISO(iso).toLocaleDateString("pt-BR", opts); }
  catch{ return iso; }
}

export const fmtShort = (iso) => fmtDate(iso, { day: "2-digit", month: "short" }).replace(".", "");
export const fmtLong = (iso) => fmtDate(iso, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
export const fmtMonth = (iso) => fmtDate(iso, { month: "long", year: "numeric" });
