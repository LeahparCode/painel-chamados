// Exclusão em massa (somente administradores): apaga todos os disparos de um dia, semana,
// mês ou período livre — com prévia, cópia em CSV e confirmação digitando "EXCLUIR".
import { TIPOS, STATUS } from "../core/config.js";
import { state, subscribe, removeManyLocal } from "../core/state.js";
import { dayOf, statusKey, inRange, summarize, byHorario } from "../core/records.js";
import { todayISO, addDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, fmtDate } from "../core/dates.js";
import { fmtInt, fmtMoney, escapeHtml, capitalize } from "../core/format.js";
import { deleteMany, fetchRecords } from "../core/api.js";
import { toast } from "../ui/toast.js";
import { downloadCsv } from "./export.js";

const $ = (id) => document.getElementById(id);
const PALAVRA = "EXCLUIR";
const STATUS_CLS = { sched: "sched", run: "", ok: "ok", err: "err" };
const sel = { scope: "dia", ref: todayISO(), from: "", to: "", tipo: "", status: "" };
let open = false;
let busy = false;

const fmtBR = (iso) => iso ? iso.split("-").reverse().join("/") : "";

function range(){
  const { scope, ref } = sel;
  if (scope === "semana") return { from: startOfWeek(ref), to: endOfWeek(ref) };
  if (scope === "mes") return { from: startOfMonth(ref), to: endOfMonth(ref) };
  if (scope === "periodo"){
    let from = sel.from || ref, to = sel.to || from;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }
  return { from: ref, to: ref };
}

function rangeText(){
  const { from, to } = range();
  if (sel.scope === "dia") return capitalize(fmtDate(from, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }));
  if (sel.scope === "mes") return capitalize(fmtDate(from, { month: "long", year: "numeric" }));
  if (sel.scope === "semana") return `Semana de ${fmtBR(from)} a ${fmtBR(to)}`;
  return from === to ? fmtBR(from) : `${fmtBR(from)} a ${fmtBR(to)}`;
}

function selected(){
  const { from, to } = range();
  return state.records
    .filter(r => inRange(dayOf(r), from, to))
    .filter(r => !sel.tipo || (r.tipoDisparo || "") === sel.tipo)
    .filter(r => !sel.status || statusKey(r.status) === statusKey(sel.status))
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || byHorario(a, b));
}

function syncInputs(){
  const { scope } = sel;
  $("bkScope").querySelectorAll("button").forEach(b => b.classList.toggle("is-active", b.dataset.scope === scope));
  $("bkRefWrap").hidden = scope === "mes" || scope === "periodo";
  $("bkMonthWrap").hidden = scope !== "mes";
  $("bkFromWrap").hidden = $("bkToWrap").hidden = scope !== "periodo";
  $("bkRefLabel").textContent = scope === "semana" ? "Semana do dia" : "Dia";
  document.querySelectorAll("[data-bk-step]").forEach(b => { b.hidden = scope === "periodo"; });
  $("bkRef").value = sel.ref;
  $("bkMonth").value = sel.ref.slice(0, 7);
  const r = range();
  $("bkFrom").value = r.from;
  $("bkTo").value = r.to;
}

function render(){
  if (!open) return;
  const list = selected();
  const s = summarize(list);
  const n = list.length;

  const porStatus = {};
  list.forEach(r => { const k = statusKey(r.status); porStatus[k] = (porStatus[k] || 0) + 1; });
  const statusChips = ["sched", "run", "ok", "err"].filter(k => porStatus[k]).map(k => {
    const nome = STATUS.find(x => statusKey(x) === k) || k;
    return `<span class="status-chip ${STATUS_CLS[k]}">${escapeHtml(nome)}: ${fmtInt(porStatus[k])}</span>`;
  }).join("");
  const porTipo = {};
  list.forEach(r => { const t = r.tipoDisparo || "Sem tipo"; porTipo[t] = (porTipo[t] || 0) + 1; });
  const tipoChips = Object.entries(porTipo).map(([t, q]) => `<span class="chip">${escapeHtml(t)}: ${fmtInt(q)}</span>`).join("");

  const AMOSTRA = 6;
  const itens = list.slice(0, AMOSTRA).map(r => `
    <li><span class="bk-when">${fmtBR(dayOf(r))} · ${escapeHtml(r.horario || "--:--")}</span>
      <span class="bk-name">${escapeHtml(r.tipo || "Sem nome")}</span>
      <span class="bk-meta">${escapeHtml(r.tipoDisparo || "")}${r.volume ? " · " + fmtInt(r.volume) : ""}</span></li>`).join("");
  const mais = n > AMOSTRA ? `<li class="bk-more">… e mais ${fmtInt(n - AMOSTRA)} disparo(s)</li>` : "";
  const andamento = porStatus.run
    ? `<p class="bk-warn">Atenção: ${porStatus.run === 1 ? "1 disparo ainda está" : `${fmtInt(porStatus.run)} disparos ainda estão`} <b>Em andamento</b>.</p>` : "";

  $("bkPreview").innerHTML = n ? `
    <div class="bk-head">
      <div><span class="bk-range">${escapeHtml(rangeText())}</span>
        <b class="bk-count">${fmtInt(n)} ${n === 1 ? "disparo será excluído" : "disparos serão excluídos"}</b></div>
      <div class="bk-totals"><span>Volume <b>${fmtInt(s.volume)}</b></span><span>Valor <b>${fmtMoney(s.valor)}</b></span></div>
    </div>
    <div class="bk-chips">${statusChips}${tipoChips}</div>
    ${andamento}
    <ul class="bk-list">${itens}${mais}</ul>` : `
    <div class="bk-empty"><span class="bk-range">${escapeHtml(rangeText())}</span>
      <b>Nenhum disparo encontrado</b><span>Escolha outro período ou ajuste os filtros.</span></div>`;

  $("bkSubmitText").textContent = n ? `Excluir ${fmtInt(n)} disparo${n === 1 ? "" : "s"}` : "Excluir";
  updateSubmit();
}

function updateSubmit(){
  const ok = $("bkConfirm").value.trim().toUpperCase() === PALAVRA;
  $("bkSubmit").disabled = busy || !ok || selected().length === 0;
}

function step(dir){
  if (sel.scope === "dia") sel.ref = addDays(sel.ref, dir);
  else if (sel.scope === "semana") sel.ref = addDays(sel.ref, 7 * dir);
  else if (sel.scope === "mes") sel.ref = addMonths(startOfMonth(sel.ref), dir);
  syncInputs();
  render();
}

/** Ao abrir a tela "Exclusão": começa no mesmo dia/semana/mês/período que está aberto no painel. */
export function setBulkVisible(visivel){
  open = !!visivel;
  if (!open) return;
  const v = state.view;
  sel.scope = ["dia", "semana", "mes", "periodo"].includes(v.mode) ? v.mode : "dia";
  sel.ref = v.ref || todayISO();
  sel.from = v.from || "";
  sel.to = v.to || "";
  sel.tipo = sel.status = "";
  $("bkTipo").value = $("bkStatus").value = "";
  $("bkConfirm").value = "";
  $("bkError").hidden = true;
  syncInputs();
  render();
}

async function submit(e){
  e.preventDefault();
  if (busy) return;
  const list = selected();
  if (!list.length || $("bkConfirm").value.trim().toUpperCase() !== PALAVRA) return updateSubmit();
  const { from, to } = range();
  const ids = list.map(r => `${r.id}`);

  if ($("bkBackup").checked){
    try{ downloadCsv(list, `backup_exclusao_${from}${from === to ? "" : "_a_" + to}.csv`); }
    catch(err){ console.error(err); toast("Não foi possível gerar a cópia em CSV.", "error"); return; }
  }

  busy = true;
  $("bkError").hidden = true;
  $("bkSubmitText").textContent = "Excluindo…";
  updateSubmit();
  try{
    const res = await deleteMany(ids);
    removeManyLocal(ids);
    $("bkConfirm").value = ""; // continua na tela, pronta para outra exclusão
    const n = res?.excluidos ?? ids.length;
    toast(`${fmtInt(n)} disparo${n === 1 ? "" : "s"} excluído${n === 1 ? "" : "s"}.`, "ok", 3500);
    fetchRecords().catch(() => {});
  }catch(err){
    $("bkError").textContent = err.message || "Não foi possível excluir.";
    $("bkError").hidden = false;
  }finally{
    busy = false;
    render();
  }
}

export function initBulkDelete(){
  TIPOS.forEach(t => $("bkTipo").append(new Option(t, t)));
  STATUS.forEach(s => $("bkStatus").append(new Option(s, s)));

  $("bkScope").addEventListener("click", (e) => {
    const b = e.target.closest("[data-scope]");
    if (!b) return;
    if (b.dataset.scope === "periodo" && sel.scope !== "periodo"){ const r = range(); sel.from = r.from; sel.to = r.to; }
    sel.scope = b.dataset.scope;
    syncInputs();
    render();
  });
  document.querySelectorAll("[data-bk-step]").forEach(b => b.addEventListener("click", () => step(Number(b.dataset.bkStep))));
  $("bkRef").addEventListener("change", (e) => { if (e.target.value){ sel.ref = e.target.value; syncInputs(); render(); } });
  $("bkMonth").addEventListener("change", (e) => { if (e.target.value){ sel.ref = `${e.target.value}-01`; syncInputs(); render(); } });
  $("bkFrom").addEventListener("change", (e) => { sel.from = e.target.value; render(); });
  $("bkTo").addEventListener("change", (e) => { sel.to = e.target.value; render(); });
  $("bkTipo").addEventListener("change", (e) => { sel.tipo = e.target.value; render(); });
  $("bkStatus").addEventListener("change", (e) => { sel.status = e.target.value; render(); });
  $("bkConfirm").addEventListener("input", updateSubmit);
  $("bulkForm").addEventListener("submit", submit);

  subscribe((_, reason) => { if (reason === "records") render(); });
}
