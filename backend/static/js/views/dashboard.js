// Dashboard: KPIs + gráficos (Chart.js) por período e tipo.
import { TIPOS, COST_PER_TIPO } from "../core/config.js";
import { state, subscribe } from "../core/state.js";
import { summarize, costOf, dayOf, inRange, statusKey } from "../core/records.js";
import { todayISO, addDays, startOfMonth, endOfMonth, eachDay, fmtShort } from "../core/dates.js";
import { fmtInt, fmtMoney } from "../core/format.js";
import { onThemeChange } from "../ui/theme.js";

const $ = (id) => document.getElementById(id);
const filters = { from: "", to: "", tipo: "", preset: "mes" };
const charts = {};
let visible = false;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function applyPreset(preset){
  const today = todayISO();
  filters.preset = preset;
  if (preset === "7"){ filters.from = addDays(today, -6); filters.to = today; }
  else if (preset === "30"){ filters.from = addDays(today, -29); filters.to = today; }
  else { filters.from = startOfMonth(today); filters.to = endOfMonth(today); }
  $("dashFrom").value = filters.from;
  $("dashTo").value = filters.to;
  $("dashPresets").querySelectorAll("button").forEach(b => b.classList.toggle("is-active", b.dataset.preset === preset));
}

function filtered(){
  return state.records.filter(r => {
    if (!inRange(dayOf(r), filters.from, filters.to)) return false;
    if (filters.tipo && (r.tipoDisparo || "") !== filters.tipo) return false;
    return true;
  });
}

function renderKpis(list){
  const s = summarize(list);
  const decided = s.ok + s.err;
  const taxa = decided ? Math.round((s.ok / decided) * 100) : null;
  const custoMedio = s.volume ? s.valor / s.volume : 0;
  const days = eachDay(filters.from, filters.to).length || 1;
  $("dashKpis").innerHTML = [
    `<div class="kpi kpi-brand"><span>Valor no período</span><b>${fmtMoney(s.valor)}</b><small>Média/dia: ${fmtMoney(s.valor / days)}</small></div>`,
    `<div class="kpi"><span>Disparos</span><b>${fmtInt(s.total)}</b><small>${fmtInt(s.run)} em andamento</small></div>`,
    `<div class="kpi"><span>Volume</span><b>${fmtInt(s.volume)}</b><small>mensagens enviadas</small></div>`,
    `<div class="kpi"><span>Taxa de sucesso</span><b>${taxa === null ? "—" : taxa + "%"}</b><small>${fmtInt(s.ok)} finalizados · ${fmtInt(s.err)} insucessos</small></div>`,
    `<div class="kpi"><span>Custo médio</span><b>${custoMedio.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 3 })}</b><small>por mensagem</small></div>`,
  ].join("");
}

/* ---------------- gráficos ---------------- */
function baseOptions({ money = false, horizontal = false } = {}){
  const text = css("--muted"), grid = css("--border");
  const fmt = (v) => money ? fmtMoney(v) : fmtInt(v);
  const valueAxis = {
    beginAtZero: true,
    grid: { color: grid, drawTicks: false },
    border: { display: false },
    ticks: { color: text, padding: 8, maxRotation: 0, autoSkipPadding: 16, callback: (v) => money ? "R$ " + Number(v).toLocaleString("pt-BR", { notation: "compact" }) : Number(v).toLocaleString("pt-BR", { notation: "compact" }) },
  };
  const catAxis = {
    grid: { display: false },
    border: { color: grid },
    ticks: { color: text, autoSkip: true, maxRotation: 0, padding: 6 },
  };
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? "y" : "x",
    interaction: { intersect: false, mode: "index" },
    animation: { duration: 400 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css("--text"), titleColor: css("--bg"), bodyColor: css("--bg"),
        padding: 10, cornerRadius: 10, displayColors: false,
        titleFont: { family: css("--font"), weight: "700" },
        bodyFont: { family: css("--font") },
        callbacks: { label: (ctx) => fmt(horizontal ? ctx.parsed.x : ctx.parsed.y) },
      },
    },
    scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
  };
}

function ensureCharts(){
  if (typeof window.Chart === "undefined") return false;
  if (charts.volume) return true;
  const Chart = window.Chart;
  Chart.defaults.font.family = css("--font");
  const bar = { borderRadius: 4, borderSkipped: "start", maxBarThickness: 28, categoryPercentage: .8, barPercentage: .9 };

  charts.volume = new Chart($("chartVolume"), {
    type: "bar",
    data: { labels: [], datasets: [{ label: "Volume", data: [], ...bar }] },
    options: baseOptions(),
  });
  charts.valor = new Chart($("chartValor"), {
    type: "line",
    data: { labels: [], datasets: [{ label: "Valor", data: [], borderWidth: 2, cubicInterpolationMode: "monotone", fill: true, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12 }] },
    options: baseOptions({ money: true }),
  });
  charts.status = new Chart($("chartStatus"), {
    type: "bar",
    data: { labels: ["Em andamento", "Finalizado", "Insucesso"], datasets: [{ label: "Disparos", data: [], ...bar, maxBarThickness: 34 }] },
    options: baseOptions({ horizontal: true }),
  });
  charts.tipo = new Chart($("chartTipo"), {
    type: "bar",
    data: { labels: [], datasets: [{ label: "Valor", data: [], ...bar, maxBarThickness: 34 }] },
    options: baseOptions({ money: true, horizontal: true }),
  });
  applyPalette();
  return true;
}

function applyPalette(){
  if (!charts.volume) return;
  const brand = css("--brand"), accent = css("--accent");
  charts.volume.data.datasets[0].backgroundColor = brand;
  charts.volume.data.datasets[0].hoverBackgroundColor = css("--brand-2");
  const v = charts.valor.data.datasets[0];
  v.borderColor = accent;
  v.pointBackgroundColor = accent;
  v.backgroundColor = (ctx) => {
    const { chart } = ctx;
    if (!chart.chartArea) return "transparent";
    const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
    g.addColorStop(0, accent + "40");
    g.addColorStop(1, accent + "00");
    return g;
  };
  charts.status.data.datasets[0].backgroundColor = [css("--run"), css("--ok"), css("--err")];
  charts.tipo.data.datasets[0].backgroundColor = brand;
  // eixos/tooltip seguem o tema
  charts.volume.options = baseOptions();
  charts.valor.options = baseOptions({ money: true });
  charts.status.options = baseOptions({ horizontal: true });
  charts.tipo.options = baseOptions({ money: true, horizontal: true });
  Object.values(charts).forEach(c => c.update("none"));
}

function setEmpty(id, empty){ $(id).hidden = !empty; }

function renderCharts(list){
  if (!ensureCharts()){
    ["chartVolumeEmpty", "chartValorEmpty", "chartStatusEmpty", "chartTipoEmpty"].forEach(id => {
      $(id).textContent = "Gráficos indisponíveis (biblioteca não carregou).";
      setEmpty(id, true);
    });
    return;
  }
  const days = eachDay(filters.from, filters.to);
  const byDay = new Map(days.map(d => [d, { volume: 0, valor: 0 }]));
  list.forEach(r => {
    const e = byDay.get(dayOf(r));
    if (!e) return;
    e.volume += Number(r.volume || 0) || 0;
    e.valor += costOf(r);
  });
  const labels = days.map(fmtShort);
  charts.volume.data.labels = labels;
  charts.volume.data.datasets[0].data = days.map(d => byDay.get(d).volume);
  charts.valor.data.labels = labels;
  charts.valor.data.datasets[0].data = days.map(d => Number(byDay.get(d).valor.toFixed(2)));

  const s = summarize(list);
  charts.status.data.datasets[0].data = [s.run, s.ok, s.err];

  const tipos = TIPOS.filter(t => COST_PER_TIPO[t]);
  const valorTipo = tipos.map(t => list.filter(r => r.tipoDisparo === t).reduce((acc, r) => acc + costOf(r), 0));
  charts.tipo.data.labels = tipos;
  charts.tipo.data.datasets[0].data = valorTipo.map(v => Number(v.toFixed(2)));

  setEmpty("chartVolumeEmpty", !list.length);
  setEmpty("chartValorEmpty", !list.length);
  setEmpty("chartStatusEmpty", !list.length);
  setEmpty("chartTipoEmpty", !valorTipo.some(Boolean));
  Object.values(charts).forEach(c => c.update());
}

export function renderDashboard(){
  if (!visible) return;
  const list = filtered();
  $("dashLabel").textContent = `${fmtShort(filters.from)} – ${fmtShort(filters.to)}${filters.tipo ? " · " + filters.tipo : ""}`;
  renderKpis(list);
  renderCharts(list);
}

export function setDashboardVisible(v){
  visible = v;
  if (v) requestAnimationFrame(renderDashboard);
}

export function initDashboard(){
  TIPOS.forEach(t => $("dashTipo").append(new Option(t, t)));
  applyPreset("mes");

  $("dashPresets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    applyPreset(b.dataset.preset);
    renderDashboard();
  });
  const onRange = () => {
    let from = $("dashFrom").value || $("dashTo").value;
    let to = $("dashTo").value || from;
    if (!from) return;
    if (from > to) [from, to] = [to, from];
    Object.assign(filters, { from, to, preset: "" });
    $("dashPresets").querySelectorAll("button").forEach(b => b.classList.remove("is-active"));
    renderDashboard();
  };
  $("dashFrom").addEventListener("change", onRange);
  $("dashTo").addEventListener("change", onRange);
  $("dashTipo").addEventListener("change", (e) => { filters.tipo = e.target.value; renderDashboard(); });

  subscribe((_, reason) => { if (reason === "records") renderDashboard(); });
  onThemeChange(() => { applyPalette(); });
}
