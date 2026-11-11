// Ponto de entrada do front-end.
import { state, subscribe } from "./core/state.js";
import { loadCache, connect, loadTemplatesCache, fetchTemplates } from "./core/api.js";
import { initTheme } from "./ui/theme.js";
import { initClock } from "./ui/clock.js";
import { initModals } from "./ui/modal.js";
import { initPainel } from "./views/painel.js";
import { initBoard } from "./views/board.js";
import { initDetail, openDetail } from "./views/detail.js";
import { initNewForm, openNewForm } from "./views/new-form.js";
import { initFrases, refreshFrasesView } from "./views/frases.js";
import { initTemplateEditor } from "./views/template-editor.js";
import { initDashboard, setDashboardVisible } from "./views/dashboard.js";
import { initExport, setExportVisible } from "./views/export.js";

/* ---------- navegação entre telas ---------- */
function switchView(name){
  state.activeView = name;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("is-active", b.dataset.view === name));
  document.querySelectorAll("[data-view-panel]").forEach(s => { s.hidden = s.dataset.viewPanel !== name; });
  setDashboardVisible(name === "dashboard");
  setExportVisible(name === "exportar");
  if (name === "frases") refreshFrasesView();
  try{ history.replaceState(null, "", `#${name}`); }catch{}
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- conexão ---------- */
const CONN_LABEL = { connecting: "Conectando", online: "Ao vivo", stale: "Dados em cache", offline: "Offline" };
function renderConnection(){
  const el = document.getElementById("liveStatus");
  if (!el) return;
  el.dataset.state = state.connection;
  el.querySelector("span").textContent = CONN_LABEL[state.connection] || "";
  el.title = CONN_LABEL[state.connection] || "";
}

/* ---------- splash ---------- */
let splashDone = false;
function hideSplash(){
  if (splashDone) return;
  splashDone = true;
  const s = document.getElementById("splash");
  s?.classList.add("is-hidden");
  setTimeout(() => s?.remove(), 350);
}

/* ---------- boot ---------- */
loadTemplatesCache(); // templates próprios já aparecem antes da resposta do servidor
initTheme();
initClock();
initModals();
initPainel();
initBoard({ onOpen: openDetail, onNew: (day) => openNewForm({ day }) });
initDetail();
initNewForm();
initTemplateEditor();
initFrases({ onUse: (template, tipo) => openNewForm({ template, tipo }) });
initDashboard();
initExport();

document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
const initial = (location.hash || "").replace("#", "");
switchView(["painel", "dashboard", "frases", "exportar"].includes(initial) ? initial : "painel");

subscribe((_, reason) => {
  if (reason === "connection") renderConnection();
  if (reason === "records") hideSplash();
});
renderConnection();

if (loadCache()) hideSplash();
setTimeout(hideSplash, 1500);
connect();
fetchTemplates().catch(() => {});
setInterval(() => { if (!document.hidden) fetchTemplates().catch(() => {}); }, 60000);
