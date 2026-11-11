// Tela "Exportar": filtros, prévia e exportação em Excel (.xlsx), CSV e relatório PDF.
import { TIPOS, STATUS, COST_PER_TIPO, OFFLINE } from "../core/config.js";
import { state, subscribe } from "../core/state.js";
import { dayOf, costOf, statusKey, summarize, inRange, byHorario } from "../core/records.js";
import { todayISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, eachDay, fmtDate, toISO } from "../core/dates.js";
import { fmtInt, fmtMoney, escapeHtml, capitalize } from "../core/format.js";
import { fraseByKey, fraseLabel } from "../core/frases.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
const filters = { preset: "mes", from: "", to: "", tipo: "", status: "" };
let visible = false;

/* ---------------- filtros ---------------- */
function applyPreset(preset){
  const today = todayISO();
  filters.preset = preset;
  if (preset === "hoje"){ filters.from = filters.to = today; }
  else if (preset === "semana"){ filters.from = startOfWeek(today); filters.to = endOfWeek(today); }
  else if (preset === "mes-anterior"){ const ref = addMonths(today, -1); filters.from = startOfMonth(ref); filters.to = endOfMonth(ref); }
  else { filters.from = startOfMonth(today); filters.to = endOfMonth(today); }
  $("expFrom").value = filters.from;
  $("expTo").value = filters.to;
  $("expPresets").querySelectorAll("button").forEach(b => b.classList.toggle("is-active", b.dataset.preset === preset));
}

function selected(){
  return state.records
    .filter(r => inRange(dayOf(r), filters.from, filters.to))
    .filter(r => !filters.tipo || (r.tipoDisparo || "") === filters.tipo)
    .filter(r => !filters.status || statusKey(r.status) === statusKey(filters.status))
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || byHorario(a, b));
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100; // centavos, sem "93,94000000001"
const fmtBR = (iso) => iso ? iso.split("-").reverse().join("/") : "";
const periodText = () => filters.from === filters.to ? fmtBR(filters.from) : `${fmtBR(filters.from)} a ${fmtBR(filters.to)}`;
const filterText = () => [filters.tipo || "Todos os tipos", filters.status || "Todos os status"].join(" · ");
const fileBase = () => `disparos_${filters.from}${filters.from === filters.to ? "" : "_a_" + filters.to}`;

function localDateTime(iso){
  const ts = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(ts)) return "";
  const d = new Date(ts);
  return `${toISO(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Linha "plana" com tudo que os formatos precisam */
function rowOf(r){
  const frase = fraseByKey(r.template);
  const tipo = r.tipoDisparo || "";
  const day = dayOf(r);
  return {
    data: day,
    dia: capitalize(fmtDate(day, { weekday: "long" })),
    horario: r.horario || "",
    nome: r.tipo || (frase ? `Safra #${String(frase.id).padStart(2, "0")} · ${frase.tom}` : ""),
    status: r.status || "Em andamento",
    tipo,
    unit: COST_PER_TIPO[tipo] || 0,
    volume: Number(r.volume || 0) || 0,
    valor: r2(costOf(r)),
    frase: frase ? fraseLabel(frase) : (r.template || ""),
    texto: frase ? frase.texto : "",
    potes: Number(r.potes || 0) || 0,
    tempo: Number(r.tempo || 0) || 0,
    atualizado: localDateTime(r.atualizadoEm),
    id: r.id || "",
  };
}

function byTipo(list){
  return TIPOS.map(t => {
    const items = list.filter(r => (r.tipoDisparo || "") === t);
    const s = summarize(items);
    return { tipo: t, unit: COST_PER_TIPO[t], total: s.total, volume: s.volume, valor: r2(s.valor) };
  });
}

function byDay(list){
  const map = new Map(eachDay(filters.from, filters.to).map(d => [d, []]));
  list.forEach(r => map.get(dayOf(r))?.push(r));
  return [...map.entries()].map(([day, items]) => { const s = summarize(items); return { day, ...s, valor: r2(s.valor) }; });
}

/* ---------------- tela ---------------- */
function render(){
  if (!visible) return;
  const list = selected();
  const s = summarize(list);
  const days = byDay(list).filter(d => d.total).length;
  $("expLabel").textContent = `${periodText()} · ${filterText()}`;
  $("expKpis").innerHTML = [
    `<div class="kpi"><span>Disparos</span><b>${fmtInt(s.total)}</b><small>${fmtInt(s.ok)} finalizados · ${fmtInt(s.err)} insucessos</small></div>`,
    `<div class="kpi"><span>Volume</span><b>${fmtInt(s.volume)}</b><small>mensagens</small></div>`,
    `<div class="kpi kpi-brand"><span>Valor</span><b>${fmtMoney(s.valor)}</b><small>no período</small></div>`,
    `<div class="kpi"><span>Dias com disparo</span><b>${fmtInt(days)}</b><small>de ${fmtInt(eachDay(filters.from, filters.to).length)} no período</small></div>`,
  ].join("");

  const rows = list.slice(0, 8).map(rowOf);
  $("expCount").textContent = list.length > 8 ? `mostrando 8 de ${fmtInt(list.length)} disparos` : `${fmtInt(list.length)} disparo(s)`;
  $("expTable").innerHTML = `
    <thead><tr><th>Data</th><th>Horário</th><th>Nome</th><th>Tipo</th><th>Status</th><th class="num">Volume</th><th class="num">Valor</th><th>Frase</th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `
      <tr><td>${fmtBR(r.data)}</td><td>${escapeHtml(r.horario)}</td><td class="ellipsis">${escapeHtml(r.nome)}</td>
      <td>${escapeHtml(r.tipo || "—")}</td><td>${escapeHtml(r.status)}</td><td class="num">${fmtInt(r.volume)}</td>
      <td class="num">${fmtMoney(r.valor)}</td><td class="ellipsis">${escapeHtml(r.frase || "—")}</td></tr>`).join("")
      : `<tr><td class="empty" colspan="8">Nenhum disparo com esses filtros.</td></tr>`}</tbody>`;
  document.querySelectorAll("[data-export]").forEach(b => { b.disabled = !list.length; });
}

/* ---------------- Excel ---------------- */
function xlsxSpec(list){
  const s = summarize(list);
  s.valor = r2(s.valor);
  const decided = s.ok + s.err;
  const rows = list.map(rowOf);
  const tipos = byTipo(list);
  const dias = byDay(list);
  const now = new Date();
  return {
    filename: `${fileBase()}.xlsx`,
    sheets: [
      {
        name: "Resumo",
        filter: false,
        columns: [{ title: "Indicador", type: "text", width: 26 }, { title: "Valor", type: "auto", width: 30 }],
        rows: [
          ["Período", periodText()],
          ["Filtros", filterText()],
          ["Gerado em", now.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })],
          ["Disparos", { v: s.total, t: "int" }],
          ["Volume", { v: s.volume, t: "int" }],
          ["Valor total", { v: s.valor, t: "money" }],
          ["Em andamento", { v: s.run, t: "int" }],
          ["Finalizados", { v: s.ok, t: "int" }],
          ["Insucessos", { v: s.err, t: "int" }],
          ["Taxa de sucesso", decided ? { v: s.ok / decided, t: "percent" } : "—"],
        ],
      },
      {
        name: "Por tipo",
        columns: [
          { title: "Tipo", type: "text", width: 14 }, { title: "Valor por envio", type: "money3", width: 16 },
          { title: "Disparos", type: "int", width: 12 }, { title: "Volume", type: "int", width: 14 }, { title: "Valor", type: "money", width: 16 },
        ],
        rows: tipos.map(t => [t.tipo, t.unit, t.total, t.volume, t.valor]),
        totals: ["Total", "", s.total, s.volume, s.valor],
      },
      {
        name: "Por dia",
        columns: [
          { title: "Data", type: "date", width: 12 }, { title: "Dia", type: "text", width: 16 },
          { title: "Disparos", type: "int", width: 11 }, { title: "Volume", type: "int", width: 12 }, { title: "Valor", type: "money", width: 15 },
          { title: "Em andamento", type: "int", width: 14 }, { title: "Finalizados", type: "int", width: 12 }, { title: "Insucessos", type: "int", width: 12 },
        ],
        rows: dias.map(d => [d.day, capitalize(fmtDate(d.day, { weekday: "long" })), d.total, d.volume, d.valor, d.run, d.ok, d.err]),
        totals: ["Total", "", s.total, s.volume, s.valor, s.run, s.ok, s.err],
      },
      {
        name: "Disparos",
        columns: [
          { title: "Data", type: "date", width: 12 }, { title: "Horário", type: "text", width: 9 },
          { title: "Nome", type: "text", width: 28 }, { title: "Status", type: "text", width: 14 },
          { title: "Tipo", type: "text", width: 11 }, { title: "Valor por envio", type: "money3", width: 15 },
          { title: "Volume", type: "int", width: 11 }, { title: "Valor", type: "money", width: 14 },
          { title: "Frase", type: "text", width: 30 }, { title: "Texto da frase", type: "longtext", width: 70 },
          { title: "Potes", type: "int", width: 8 }, { title: "Tempo médio (min)", type: "int", width: 12 },
          { title: "Atualizado em", type: "datetime", width: 17 }, { title: "ID", type: "text", width: 20 },
        ],
        rows: rows.map(r => [r.data, r.horario, r.nome, r.status, r.tipo, r.unit, r.volume, r.valor, r.frase, r.texto, r.potes, r.tempo, r.atualizado, r.id]),
        totals: ["Total", "", `${fmtInt(rows.length)} disparos`, "", "", "", s.volume, s.valor, "", "", "", "", "", ""],
      },
    ],
  };
}

async function exportXlsx(list){
  if (OFFLINE){ toast("Exportar em Excel precisa do servidor (modo offline).", "warn"); return; }
  const resp = await fetch("/api/export/xlsx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(xlsxSpec(list)),
  });
  if (!resp.ok){
    const msg = await resp.json().then(d => d?.message).catch(() => "");
    throw new Error(msg || `HTTP ${resp.status}`);
  }
  download(await resp.blob(), `${fileBase()}.xlsx`);
}

/* ---------------- CSV ---------------- */
function csvCell(value, { text = false } = {}){
  let v = value === null || value === undefined ? "" : String(value);
  if (text && /^[=+\-@\t\r]/.test(v)) v = "'" + v; // evita que o Excel interprete como fórmula
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const num = (v, digits = 2) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });

function exportCsv(list){
  const header = ["Data", "Horário", "Nome", "Status", "Tipo", "Valor por envio", "Volume", "Valor", "Frase", "Texto da frase", "Potes", "Tempo médio (min)", "Atualizado em", "ID"];
  const lines = [header.join(";")];
  list.map(rowOf).forEach(r => {
    lines.push([
      csvCell(fmtBR(r.data)), csvCell(r.horario), csvCell(r.nome, { text: true }), csvCell(r.status), csvCell(r.tipo),
      csvCell(num(r.unit, 3)), csvCell(r.volume), csvCell(num(r.valor)), csvCell(r.frase, { text: true }), csvCell(r.texto, { text: true }),
      csvCell(r.potes), csvCell(r.tempo), csvCell(r.atualizado ? `${fmtBR(r.atualizado.slice(0, 10))} ${r.atualizado.slice(11)}` : ""), csvCell(r.id),
    ].join(";"));
  });
  // BOM para o Excel reconhecer acentos (UTF-8)
  download(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${fileBase()}.csv`);
}

/* ---------------- Relatório PDF (impressão) ---------------- */
function reportHtml(list){
  const css = getComputedStyle(document.documentElement);
  const brand = css.getPropertyValue("--brand").trim() || "#5b4cf0";
  const s = summarize(list);
  const decided = s.ok + s.err;
  const rows = list.map(rowOf);
  const tipos = byTipo(list).filter(t => t.total);
  const dias = byDay(list).filter(d => d.total);
  const e = escapeHtml;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de disparos ${e(periodText())}</title>
  <style>
    @page{ size: A4; margin: 14mm; }
    *{ box-sizing: border-box; }
    body{ font-family: "Segoe UI", Roboto, Arial, sans-serif; color: #1f2430; font-size: 11px; margin: 0; }
    header{ display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid ${brand}; padding-bottom: 10px; margin-bottom: 14px; }
    h1{ font-size: 20px; margin: 0; } h2{ font-size: 13px; margin: 18px 0 8px; color: ${brand}; text-transform: uppercase; letter-spacing: .06em; }
    .muted{ color: #6b7280; }
    .kpis{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .kpi{ border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
    .kpi span{ display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; font-weight: 700; }
    .kpi b{ font-size: 16px; }
    table{ width: 100%; border-collapse: collapse; }
    th{ text-align: left; background: #f3f4f6; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #4b5563; padding: 6px 8px; }
    td{ padding: 5px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
    .num{ text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    tfoot td{ font-weight: 700; border-top: 2px solid #d1d5db; border-bottom: 0; }
    tr{ page-break-inside: avoid; }
    footer{ margin-top: 16px; font-size: 9px; color: #9ca3af; text-align: right; }
  </style></head><body>
  <header>
    <div><h1>Relatório de disparos</h1><div class="muted">${e(periodText())} · ${e(filterText())}</div></div>
    <div class="muted">Gerado em ${e(new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }))}</div>
  </header>
  <div class="kpis">
    <div class="kpi"><span>Valor total</span><b>${fmtMoney(s.valor)}</b></div>
    <div class="kpi"><span>Disparos</span><b>${fmtInt(s.total)}</b></div>
    <div class="kpi"><span>Volume</span><b>${fmtInt(s.volume)}</b></div>
    <div class="kpi"><span>Taxa de sucesso</span><b>${decided ? Math.round((s.ok / decided) * 100) + "%" : "—"}</b></div>
  </div>
  <p class="muted">${fmtInt(s.run)} em andamento · ${fmtInt(s.ok)} finalizados · ${fmtInt(s.err)} insucessos</p>

  <h2>Por tipo</h2>
  <table><thead><tr><th>Tipo</th><th class="num">Valor por envio</th><th class="num">Disparos</th><th class="num">Volume</th><th class="num">Valor</th></tr></thead>
  <tbody>${tipos.map(t => `<tr><td>${e(t.tipo)}</td><td class="num">${e(t.unit.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 3 }))}</td><td class="num">${fmtInt(t.total)}</td><td class="num">${fmtInt(t.volume)}</td><td class="num">${fmtMoney(t.valor)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Sem disparos com tipo definido.</td></tr>`}</tbody>
  <tfoot><tr><td>Total</td><td></td><td class="num">${fmtInt(s.total)}</td><td class="num">${fmtInt(s.volume)}</td><td class="num">${fmtMoney(s.valor)}</td></tr></tfoot></table>

  <h2>Por dia</h2>
  <table><thead><tr><th>Data</th><th>Dia</th><th class="num">Disparos</th><th class="num">Volume</th><th class="num">Valor</th><th class="num">Andamento</th><th class="num">Finalizados</th><th class="num">Insucessos</th></tr></thead>
  <tbody>${dias.map(d => `<tr><td>${fmtBR(d.day)}</td><td>${e(capitalize(fmtDate(d.day, { weekday: "long" })))}</td><td class="num">${fmtInt(d.total)}</td><td class="num">${fmtInt(d.volume)}</td><td class="num">${fmtMoney(d.valor)}</td><td class="num">${fmtInt(d.run)}</td><td class="num">${fmtInt(d.ok)}</td><td class="num">${fmtInt(d.err)}</td></tr>`).join("")}</tbody></table>

  <h2>Disparos</h2>
  <table><thead><tr><th>Data</th><th>Horário</th><th>Nome</th><th>Tipo</th><th>Status</th><th class="num">Volume</th><th class="num">Valor</th><th>Frase</th></tr></thead>
  <tbody>${rows.map(r => `<tr><td>${fmtBR(r.data)}</td><td>${e(r.horario)}</td><td>${e(r.nome)}</td><td>${e(r.tipo || "—")}</td><td>${e(r.status)}</td><td class="num">${fmtInt(r.volume)}</td><td class="num">${fmtMoney(r.valor)}</td><td>${e(r.frase || "—")}</td></tr>`).join("")}</tbody></table>
  <footer>Painel de Disparos</footer>
  </body></html>`;
}

function exportPdf(list){
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open(); doc.write(reportHtml(list)); doc.close();
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
  toast("Na janela de impressão, escolha \"Salvar como PDF\".", "ok", 4000, "pdf-hint");
}

/* ---------------- utilidades ---------------- */
function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function setExportVisible(v){
  visible = v;
  if (v) render();
}

export function initExport(){
  TIPOS.forEach(t => $("expTipo").append(new Option(t, t)));
  STATUS.forEach(s => $("expStatus").append(new Option(s, s)));
  applyPreset("mes");

  $("expPresets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    applyPreset(b.dataset.preset);
    render();
  });
  const onRange = () => {
    let from = $("expFrom").value || $("expTo").value;
    let to = $("expTo").value || from;
    if (!from) return;
    if (from > to) [from, to] = [to, from];
    Object.assign(filters, { from, to, preset: "" });
    $("expFrom").value = from; $("expTo").value = to;
    $("expPresets").querySelectorAll("button").forEach(b => b.classList.remove("is-active"));
    render();
  };
  $("expFrom").addEventListener("change", onRange);
  $("expTo").addEventListener("change", onRange);
  $("expTipo").addEventListener("change", (e) => { filters.tipo = e.target.value; render(); });
  $("expStatus").addEventListener("change", (e) => { filters.status = e.target.value; render(); });

  document.querySelectorAll("[data-export]").forEach(btn => btn.addEventListener("click", async () => {
    const list = selected();
    if (!list.length){ toast("Nenhum disparo com esses filtros.", "warn"); return; }
    const kind = btn.dataset.export;
    btn.setAttribute("aria-busy", "true");
    try{
      if (kind === "xlsx"){ await exportXlsx(list); toast(`Excel gerado com ${fmtInt(list.length)} disparos.`, "ok"); }
      else if (kind === "csv"){ exportCsv(list); toast(`CSV gerado com ${fmtInt(list.length)} disparos.`, "ok"); }
      else exportPdf(list);
    }catch(err){
      console.error("Falha na exportação", err);
      toast(`Não consegui exportar: ${err.message || "erro desconhecido"}`, "error", 4000);
    }finally{
      btn.removeAttribute("aria-busy");
    }
  }));

  subscribe((_, reason) => { if (reason === "records") render(); });
}
