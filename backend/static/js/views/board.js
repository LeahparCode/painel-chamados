// Quadro do painel: colunas por dia, cards de disparo, arrastar-e-soltar e contagem regressiva.
import { state, subscribe, setView, findRecord } from "../core/state.js";
import { boardDaysOf, scopeOf, groupByDay, summarize, statusKey, costOf, remainingMs, byHorario } from "../core/records.js";
import { todayISO, weekdayIndex, fmtDate, fmtShort } from "../core/dates.js";
import { fmtInt, fmtMoney, fmtMoneyCompact, fmtTempo, fmtRemaining, escapeHtml, capitalize } from "../core/format.js";
import { fraseByKey, chipClass } from "../core/frases.js";
import { moveToDay, setStatus, deleteWithUndo } from "../core/actions.js";
import { toast } from "../ui/toast.js";
import { isLogged } from "../core/auth.js";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const STATUS_LABEL = { run: "Andamento", ok: "Finalizado", err: "Insucesso" };
const CLOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

let boardEl = null;
let handlers = { onOpen: () => {}, onNew: () => {} };
let dragId = null;
let pendingRender = false;
let dragDay = null;          // coluna do dia de onde saiu o card arrastado (só ela mostra a lixeira)
let lastViewKey = null;
let enterTimer = null;
const autoFinalized = new Set();

/* ------------------------------------------------------------------ */
function cardHtml(r){
  const key = statusKey(r.status);
  const frase = fraseByKey(r.template);
  const title = r.tipo || (frase ? frase.name : "(sem nome)");
  const ms = remainingMs(r);
  const showCountdown = key === "run" && ms !== null;
  const meta = [
    `<span>Vol. <b>${fmtInt(r.volume)}</b></span>`,
    isLogged() && costOf(r) ? `<span class="money"><b>${fmtMoney(costOf(r))}</b></span>` : "",
    showCountdown
      ? `<span class="dcard-countdown">Restante <b data-countdown="${escapeHtml(r.id)}">${fmtRemaining(ms)}</b></span>`
      : (r.tempo ? `<span>Tempo <b>${fmtTempo(r.tempo)}</b></span>` : ""),
  ].join("");
  const pills = [
    frase ? `<span class="chip ${frase.custom ? "chip-own" : chipClass(frase.canal)}">${escapeHtml(frase.custom ? "Próprio" : `${frase.code} ${frase.canal}`)}</span>` : "",
    r.tipoDisparo ? `<span class="chip chip-brand">${escapeHtml(r.tipoDisparo)}</span>` : "",
  ].join("");
  const time = escapeHtml(r.horario || "--:--");
  return `
    <article class="dcard ${key}" data-id="${escapeHtml(r.id)}" draggable="${isLogged() ? "true" : "false"}" tabindex="0" aria-label="${escapeHtml(title)}">
      <div class="dcard-top">
        <span class="dcard-time">${CLOCK_ICON}${time}</span>
        <span class="dcard-status">${STATUS_LABEL[key]}</span>
      </div>
      <div class="dcard-title" data-time="${time}">${escapeHtml(title)}</div>
      <div class="dcard-meta">${meta}</div>
      ${pills ? `<div class="dcard-pills">${pills}</div>` : ""}
    </article>`;
}

function dayHtml(day, records, { today, focus, scope, mode }){
  const s = summarize(records);
  const classes = ["day"];
  if (day === today) classes.push("is-today");
  if (mode === "dia"){
    classes.push(day === focus ? "is-focus" : "is-dim");
  }else if (day < scope.from || day > scope.to){
    classes.push("is-dim");
  }
  if (weekdayIndex(day) >= 5) classes.push("is-weekend");
  if (!records.length) classes.push("is-empty");

  const bar = s.total
    ? ["run", "ok", "err"].filter(k => s[k]).map(k => `<i class="${k}" style="flex:${s[k]}"></i>`).join("")
    : "";
  const cards = records.length
    ? records.slice().sort(byHorario).map(cardHtml).join("")
    : `<div class="day-empty">Sem disparos</div>`;
  const longName = mode === "dia" && day === focus;
  const weekday = capitalize(fmtDate(day, { weekday: longName ? "long" : "short" }).replace(".", ""));

  return `
    <section class="${classes.join(" ")}" data-day="${day}">
      <header class="day-head" data-focus title="Focar neste dia">
        <div class="day-title">
          <span class="day-num">${Number(day.slice(8, 10))}</span>
          <span class="day-name"><strong>${weekday}</strong><small>${fmtShort(day)}</small></span>
          <span class="day-mini">${s.total || ""}</span>
          <button type="button" class="day-add" data-add title="Novo disparo neste dia" aria-label="Novo disparo em ${fmtShort(day)}">${PLUS_ICON}</button>
        </div>
        <div class="day-stats">
          <span>${s.total} ${s.total === 1 ? "disparo" : "disparos"}</span>
          ${isLogged() ? `<b class="money" title="${fmtMoney(s.valor)}">${fmtMoneyCompact(s.valor)}</b>` : ""}
        </div>
        <div class="day-bar">${bar}</div>
      </header>
      <div class="day-body">${cards}</div>
      <div class="day-trash" data-trash title="Solte aqui para excluir" aria-hidden="true"><span class="day-trash-ico">${TRASH_ICON}</span></div>
    </section>`;
}

export function renderBoard(){
  if (!boardEl) return;
  if (dragId){ pendingRender = true; return; }
  dragDay = null;
  const { view } = state;
  const today = todayISO();
  const days = boardDaysOf(view);
  const scope = scopeOf(view);
  const grouped = groupByDay(state.records);

  boardEl.dataset.mode = view.mode;
  let html = "";
  if (view.mode === "mes"){
    html += WEEKDAYS.map(w => `<div class="board-weekday">${w}</div>`).join("");
    html += '<div class="board-blank"></div>'.repeat(weekdayIndex(days[0]));
  }
  html += days.map(d => dayHtml(d, grouped.get(d) || [], { today, focus: view.ref, scope, mode: view.mode })).join("");
  if (!days.length) html = `<div class="board-empty">Selecione um período válido.</div>`;
  boardEl.innerHTML = html;

  // Animação de entrada: só quando muda o conjunto de dias exibido (Dia/Semana/Mês/Período
  // ou navegação de datas). Atualizações em tempo real não reanimam o quadro.
  const viewKey = `${view.mode}|${days[0]}|${days.length}`;
  if (viewKey !== lastViewKey){
    lastViewKey = viewKey;
    playEnter();
  }

  // Na visão "Dia" a coluna em foco ganha mais espaço
  if (view.mode === "dia"){
    boardEl.style.gridTemplateColumns = days.map(d => d === view.ref ? "minmax(230px, 1.9fr)" : "minmax(135px, 1fr)").join(" ");
  }else{
    boardEl.style.gridTemplateColumns = "";
  }
}

/** Os dias sobem em sequência, um após o outro. */
function playEnter(){
  const items = [...boardEl.children];
  if (!items.length) return;
  const step = Math.min(45, Math.round(650 / items.length)); // mês inteiro termina em ~0,65s
  items.forEach((el, i) => el.style.setProperty("--enter-delay", `${i * step}ms`));
  boardEl.classList.remove("is-entering");
  void boardEl.offsetWidth; // reinicia a animação
  boardEl.classList.add("is-entering");
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => boardEl.classList.remove("is-entering"), items.length * step + 700);
}

/** Card solto na lixeira: some na hora, com "Desfazer" por alguns segundos. */
function trashCard(id){
  const rec = findRecord(id);
  if (!rec) return;
  const nome = rec.tipo || fraseByKey(rec.template)?.name || "Disparo";
  deleteWithUndo(id, { label: `"${nome}" excluído.` });
}

/**
 * Encerra o estado de arraste (lixeira some com transição, destaques saem).
 * Chamado em TODOS os finais possíveis: soltar no dia, na lixeira, fora do quadro, cancelar (Esc)
 * e, por segurança, no primeiro movimento do mouse depois do arraste.
 */
function endDrag(){
  if (!boardEl) return;
  boardEl.querySelectorAll(".is-trash-active, .is-drop, .is-over, .dcard.is-dragging")
    .forEach(el => el.classList.remove("is-trash-active", "is-drop", "is-over", "is-dragging"));
  dragDay = null;
}

function finishDrag(){
  endDrag();
  dragId = null;
  if (pendingRender){ pendingRender = false; renderBoard(); }
}

/* ------------------------------------------------------------------ */
function bindEvents(){
  // redes de segurança: se o navegador não avisar o fim do arraste ao quadro
  // (card solto fora da página, quadro redesenhado no meio do caminho etc.)
  document.addEventListener("dragend", () => { if (dragId) finishDrag(); }, true);
  document.addEventListener("drop", (e) => { if (dragId && !boardEl.contains(e.target)) finishDrag(); }, true);
  document.addEventListener("mousemove", (e) => { if (e.buttons === 0 && (dragId || dragDay)) finishDrag(); });
  window.addEventListener("blur", () => { if (dragId) finishDrag(); });

  boardEl.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add && isLogged()){
      e.stopPropagation();
      handlers.onNew(add.closest(".day")?.dataset.day);
      return;
    }
    const card = e.target.closest(".dcard");
    if (card){ handlers.onOpen(card.dataset.id); return; }
    const head = e.target.closest("[data-focus]");
    if (head){
      const day = head.closest(".day")?.dataset.day;
      if (day) setView({ mode: "dia", ref: day, followToday: day === todayISO() });
    }
  });

  boardEl.addEventListener("keydown", (e) => {
    const card = e.target.closest?.(".dcard");
    if (e.target.closest("button")) return;
    if (card && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); handlers.onOpen(card.dataset.id); }
  });

  boardEl.addEventListener("dragstart", (e) => {
    if (!isLogged()){ e.preventDefault(); return; }
    const card = e.target.closest(".dcard");
    if (!card) return;
    dragId = card.dataset.id;
    dragDay = card.closest(".day");
    card.classList.add("is-dragging");
    try{ e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); }catch{}
    // a lixeira surge (com transição) só no fim do dia de onde o card saiu
    requestAnimationFrame(() => { if (dragId) dragDay?.classList.add("is-trash-active"); });
  });
  boardEl.addEventListener("dragend", finishDrag);
  boardEl.addEventListener("dragover", (e) => {
    const day = e.target.closest(".day");
    if (!day || !dragId) return;
    e.preventDefault();
    const trash = e.target.closest("[data-trash]");
    try{ e.dataTransfer.dropEffect = "move"; }catch{}
    if (trash && trash.closest(".day")?.classList.contains("is-trash-active")){
      if (!trash.classList.contains("is-over")){
        boardEl.querySelectorAll(".is-drop, .is-over").forEach(el => el.classList.remove("is-drop", "is-over"));
        trash.classList.add("is-over");
      }
      return;
    }
    boardEl.querySelectorAll(".is-over").forEach(el => el.classList.remove("is-over"));
    if (!day.classList.contains("is-drop")){
      boardEl.querySelectorAll(".is-drop").forEach(el => el.classList.remove("is-drop"));
      day.classList.add("is-drop");
    }
  });
  boardEl.addEventListener("dragleave", (e) => {
    const trash = e.target.closest("[data-trash]");
    if (trash && !trash.contains(e.relatedTarget)) trash.classList.remove("is-over");
    const day = e.target.closest(".day");
    if (day && !day.contains(e.relatedTarget)) day.classList.remove("is-drop");
  });
  boardEl.addEventListener("drop", (e) => {
    const dayEl = e.target.closest(".day");
    if (!dayEl || !dragId) return;
    e.preventDefault();
    const id = dragId;
    const onTrash = !!e.target.closest("[data-trash]") && dayEl.classList.contains("is-trash-active");
    // limpa o arraste ANTES de atualizar o quadro (antes, soltar em outro dia deixava as lixeiras na tela)
    endDrag();
    dragId = null;
    pendingRender = false;
    if (onTrash){ trashCard(id); return; }
    const target = dayEl.dataset.day;
    const rec = findRecord(id);
    if (!rec || rec.data === target){ renderBoard(); return; }
    moveToDay(id, target);
  });
}

/* ---------- contagem regressiva + finalização automática ---------- */
function tick(){
  if (!boardEl) return;
  boardEl.querySelectorAll("[data-countdown]").forEach(el => {
    const id = el.dataset.countdown;
    const rec = findRecord(id);
    if (!rec) return;
    const ms = remainingMs(rec);
    el.textContent = fmtRemaining(ms);
    // só quem está logado grava a finalização automática (visitantes só veem o tempo zerar)
    if (isLogged() && ms !== null && ms <= 0 && statusKey(rec.status) === "run" && !autoFinalized.has(id)){
      autoFinalized.add(id);
      setStatus(id, "Finalizado", { quiet: true }).then(ok => {
        if (ok) toast(`"${rec.tipo || "Disparo"}" finalizado automaticamente.`, "ok", 2600);
      });
    }
  });
}

export function initBoard(opts){
  boardEl = document.getElementById("board");
  handlers = { ...handlers, ...opts };
  bindEvents();
  subscribe((_, reason) => { if (reason === "records" || reason === "view" || reason === "day" || reason === "templates") renderBoard(); });
  setInterval(tick, 1000);
  renderBoard();
}
