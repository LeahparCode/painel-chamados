// Regras de negócio sobre os registros de disparo.
import { COST_PER_TIPO } from "./config.js";
import { toISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDay, fmtLong, fmtShort, fmtMonth } from "./dates.js";
import { capitalize } from "./format.js";

/** "run" | "ok" | "err" */
export function statusKey(status){
  const s = (status || "").toLowerCase();
  if (s.includes("final")) return "ok";
  if (s.includes("insu")) return "err";
  return "run";
}

export function costOf(r){
  const volume = Number(r?.volume || 0) || 0;
  const unit = COST_PER_TIPO[(r?.tipoDisparo || "").trim()] || 0;
  return volume * unit;
}

/** Dia do disparo: campo Data; se vazio, usa a data de atualização (fuso local). */
export function dayOf(r){
  const d = (r?.data || "").slice(0, 10);
  if (d) return d;
  const ts = r?.atualizadoEm ? Date.parse(r.atualizadoEm) : NaN;
  return Number.isNaN(ts) ? "" : toISO(new Date(ts));
}

export function remainingMs(r){
  const mins = Number(r?.tempo || 0);
  const ts = r?.atualizadoEm ? Date.parse(r.atualizadoEm) : NaN;
  if (!mins || Number.isNaN(ts)) return null;
  return ts + mins * 60000 - Date.now();
}

export const byHorario = (a, b) => (a.horario || "").localeCompare(b.horario || "") || (a.tipo || "").localeCompare(b.tipo || "");

/** Soma de indicadores para uma lista de registros */
export function summarize(list){
  const out = { total: 0, volume: 0, valor: 0, run: 0, ok: 0, err: 0 };
  for (const r of list){
    out.total++;
    out.volume += Number(r?.volume || 0) || 0;
    out.valor += costOf(r);
    out[statusKey(r.status)]++;
  }
  return out;
}

/** Agrupa registros por dia (Map iso -> registros[]) */
export function groupByDay(records){
  const map = new Map();
  for (const r of records){
    const d = dayOf(r);
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(r);
  }
  return map;
}

export const inRange = (iso, from, to) => !!iso && iso >= from && iso <= to;

/**
 * Escopo do cálculo conforme a visão escolhida.
 * - dia: só o dia de referência (padrão — cálculo do dia a dia)
 * - semana / mes: semana ou mês do dia de referência
 * - periodo: intervalo livre
 */
export function scopeOf(view){
  const { mode, ref } = view;
  if (mode === "semana") return { from: startOfWeek(ref), to: endOfWeek(ref) };
  if (mode === "mes") return { from: startOfMonth(ref), to: endOfMonth(ref) };
  if (mode === "periodo"){
    let from = view.from || ref, to = view.to || from;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: ref, to: ref };
}

/** Dias exibidos no painel */
export function boardDaysOf(view){
  if (view.mode === "dia" || view.mode === "semana") return eachDay(startOfWeek(view.ref), endOfWeek(view.ref));
  const { from, to } = scopeOf(view);
  return eachDay(from, to, view.mode === "periodo" ? 93 : 31);
}

export function scopeLabel(view, today){
  const { from, to } = scopeOf(view);
  if (view.mode === "dia") return (view.ref === today ? "Hoje · " : "") + capitalize(fmtLong(view.ref));
  if (view.mode === "mes") return capitalize(fmtMonth(view.ref));
  if (from === to) return capitalize(fmtLong(from));
  return `${fmtShort(from)} – ${fmtShort(to)}`;
}
