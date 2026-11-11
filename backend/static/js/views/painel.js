// Painel: barra de visão (Dia/Semana/Mês/Período), navegação de datas e métricas.
//
// Regra de cálculo: por padrão as métricas são do DIA (hoje) e acompanham a virada
// do dia automaticamente. O escopo só aumenta/diminui quando alguém muda a visão.
import { state, subscribe, setView, emit } from "../core/state.js";
import { scopeOf, summarize, scopeLabel, inRange, dayOf } from "../core/records.js";
import { todayISO, addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDay } from "../core/dates.js";
import { fmtInt, fmtMoney } from "../core/format.js";

const $ = (id) => document.getElementById(id);
const VALUE_LABEL = { dia: "Valor do dia", semana: "Valor da semana", mes: "Valor do mês", periodo: "Valor do período" };

let lastValues = {};

function setNum(id, text){
  const el = $(id);
  if (!el) return;
  if (lastValues[id] !== undefined && lastValues[id] !== text){
    const card = el.closest(".metric");
    card?.classList.remove("is-bump");
    void card?.offsetWidth;
    card?.classList.add("is-bump");
  }
  lastValues[id] = text;
  el.textContent = text;
}

function renderMetrics(){
  const { view, records } = state;
  const scope = scopeOf(view);
  const list = records.filter(r => inRange(dayOf(r), scope.from, scope.to));
  const s = summarize(list);

  const month = { from: startOfMonth(view.ref), to: endOfMonth(view.ref) };
  const monthValor = summarize(records.filter(r => inRange(dayOf(r), month.from, month.to))).valor;

  setNum("mValor", fmtMoney(s.valor));
  setNum("mTotal", fmtInt(s.total));
  setNum("mAndamento", fmtInt(s.run));
  setNum("mFinalizado", fmtInt(s.ok));
  setNum("mInsucesso", fmtInt(s.err));
  $("mVolume").textContent = fmtInt(s.volume);
  $("mValorMes").textContent = fmtMoney(monthValor);
  document.querySelector(".metric-value .metric-label").textContent = VALUE_LABEL[view.mode];

  const pct = (n) => s.total ? `${(n / s.total) * 100}%` : "0%";
  $("barAndamento").style.width = pct(s.run);
  $("barFinalizado").style.width = pct(s.ok);
  $("barInsucesso").style.width = pct(s.err);
}

function renderToolbar(){
  const { view } = state;
  document.querySelectorAll("#modeSwitch [data-mode]").forEach(b => {
    const on = b.dataset.mode === view.mode;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("refDate").value = view.ref;
  const isPeriodo = view.mode === "periodo";
  $("rangeInputs").hidden = !isPeriodo;
  $("dateNav").querySelector(".date-pill").hidden = isPeriodo;
  if (isPeriodo){
    const { from, to } = scopeOf(view);
    $("rangeFrom").value = from;
    $("rangeTo").value = to;
  }
  $("scopeLabel").textContent = scopeLabel(view, todayISO());
  $("btnToday").disabled = view.mode !== "periodo" && view.ref === todayISO();
}

function shift(dir){
  const { view } = state;
  let ref = view.ref;
  if (view.mode === "dia") ref = addDays(ref, dir);
  else if (view.mode === "semana") ref = addDays(ref, 7 * dir);
  else if (view.mode === "mes") ref = addMonths(ref, dir);
  else{
    const { from, to } = scopeOf(view);
    const len = eachDay(from, to).length;
    const nf = addDays(from, len * dir), nt = addDays(to, len * dir);
    setView({ from: nf, to: nt, ref: nf, followToday: false });
    return;
  }
  setView({ ref, followToday: ref === todayISO() });
}

function bind(){
  $("modeSwitch").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    const mode = btn.dataset.mode;
    const patch = { mode };
    if (mode === "periodo" && (!state.view.from || !state.view.to)){
      patch.from = startOfWeek(state.view.ref);
      patch.to = endOfWeek(state.view.ref);
    }
    setView(patch);
  });

  $("dateNav").addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) shift(Number(nav.dataset.nav));
  });

  $("refDate").addEventListener("change", (e) => {
    const ref = e.target.value || todayISO();
    setView({ ref, followToday: ref === todayISO() });
  });

  $("btnToday").addEventListener("click", () => {
    const today = todayISO();
    setView({ ref: today, followToday: true, ...(state.view.mode === "periodo" ? { mode: "dia" } : {}) });
  });

  const onRange = () => {
    let from = $("rangeFrom").value, to = $("rangeTo").value;
    if (!from && !to) return;
    from = from || to; to = to || from;
    if (from > to) [from, to] = [to, from];
    setView({ from, to, ref: from, followToday: false });
  };
  $("rangeFrom").addEventListener("change", onRange);
  $("rangeTo").addEventListener("change", onRange);
}

/** Virada de dia: se a visão acompanha "hoje", avança sozinha para o novo dia. */
function watchDayChange(){
  let current = todayISO();
  setInterval(() => {
    const now = todayISO();
    if (now === current) return;
    current = now;
    if (state.view.followToday) setView({ ref: now });
    else emit("day");
  }, 20000);
}

export function initPainel(){
  bind();
  subscribe((_, reason) => {
    if (reason === "records" || reason === "view" || reason === "day"){
      renderMetrics();
      if (reason !== "records") renderToolbar();
    }
  });
  watchDayChange();
  renderToolbar();
  renderMetrics();
}
