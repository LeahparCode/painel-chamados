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
import { initImport, setIoTab } from "./views/import.js";
import { initAccount } from "./views/account.js";
import { initUsers, setUsersVisible } from "./views/users.js";
import { initBulkDelete } from "./views/bulk-delete.js";
import { fetchMe, fetchConfig, canEdit, isAdmin, isLogged, applyAuthMode } from "./core/auth.js";
import { fetchInstancias, pickInstance } from "./core/instance.js";
import { toast } from "./ui/toast.js";
import { initInstanceSwitcher, initInstancesAdmin, setInstancesVisible } from "./views/instances.js";

/* ---------- navegação entre telas ---------- */
const LOGGED_VIEWS = ["painel", "dashboard", "frases", "exportar"];

function allowedViews(){
  if (!canEdit()) return ["painel"];                 // visitante: só o painel
  if (!isAdmin()) return LOGGED_VIEWS;
  return state.gerenciarInst ? [...LOGGED_VIEWS, "usuarios", "instancias"] : [...LOGGED_VIEWS, "usuarios"];
}

function switchView(name){
  // "#importar" abre a tela Importar/Exportar já na aba de importação
  const ioTab = name === "importar" ? "importar" : (name === "exportar" ? "exportar" : null);
  if (name === "importar") name = "exportar";
  if (!allowedViews().includes(name)) name = "painel";
  state.activeView = name;
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("is-active", b.dataset.view === name));
  document.querySelectorAll("[data-view-panel]").forEach(s => { s.hidden = s.dataset.viewPanel !== name; });
  if (canEdit()){
    setDashboardVisible(name === "dashboard");
    setExportVisible(name === "exportar");
    if (name === "exportar") setIoTab(ioTab || "exportar");
    if (name === "frases") refreshFrasesView();
    if (name === "usuarios") setUsersVisible(true);
    if (name === "instancias") setInstancesVisible(true);
  }
  if (name !== "exportar"){ try{ history.replaceState(null, "", `#${name}`); }catch{} }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- conexão ---------- */
// Só dois estados visíveis: "Conectado" (dados em tempo real) ou "Conectando" (abrindo / tentando de novo)
const CONN_LABEL = { connecting: "Conectando", online: "Conectado", stale: "Conectando", offline: "Conectando" };
function renderConnection(){
  const el = document.getElementById("liveStatus");
  if (!el) return;
  el.dataset.state = state.connection;
  el.querySelector(":scope > span").textContent = CONN_LABEL[state.connection] || "";
  el.title = state.connection === "online" ? "Conectado: dados atualizados em tempo real" : "Conectando ao servidor…";
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

/* ---------- aviso no console do navegador ---------- */
try{
  console.log("%cPare!", "color:#d7263d;font-size:42px;font-weight:800;");
  console.log("%cEste sistema é propriedade da Leahpar Code. Todos os direitos reservados.\n" +
    "Copiar, reproduzir ou redistribuir o código ou o design sem autorização é proibido.",
    "font-size:14px;");
}catch{}

/* ---------- boot ---------- */
await fetchMe();      // visitante ou logado? (o servidor confirma; o resto da tela depende disso)
await fetchInstancias();  // instâncias que esta pessoa pode ver
pickInstance();       // ?i= na URL → última aberta → primeira; aplica cores e recursos da instância
applyAuthMode();      // editar depende da instância aberta
const logged = canEdit();   // admin, ou operador com acesso a esta instância (os demais só visualizam)
if (logged) await fetchConfig().catch(err => console.error("Não consegui carregar os preços", err));
if (logged) loadTemplatesCache(); // templates próprios já aparecem antes da resposta do servidor
else{ try{ localStorage.removeItem("painel_templates_v1"); }catch{} }

initTheme();
initClock();
initModals();
initAccount();
initInstanceSwitcher({ onManage: () => switchView("instancias") });
initPainel();
initBoard({ onOpen: openDetail, onNew: (day) => openNewForm({ day }) });
initDetail();
if (logged){
  initNewForm();
  initTemplateEditor();
  initFrases({ onUse: (template, tipo) => openNewForm({ template, tipo }) });
  initDashboard();
  initExport();
  initImport();
  if (isAdmin()){
    initUsers();
    initBulkDelete();
    if (state.gerenciarInst) initInstancesAdmin();
  }
}

document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));
const initial = (location.hash || "").replace("#", "");
switchView(initial === "login" ? "painel" : initial);

subscribe((_, reason) => {
  if (reason === "connection") renderConnection();
  if (reason === "records") hideSplash();
});
renderConnection();

setTimeout(hideSplash, 1500);
if (state.inst){
  if (loadCache()) hideSplash();
  connect();
  if (state.instNegada){
    // link de uma instância que esta pessoa não pode ver
    if (isLogged()) toast("Você não tem acesso à instância deste link.", "warn", 4000);
    else{
      toast("Entre para ver a instância deste link.", "warn", 4000);
      document.querySelector('[data-action="login"]')?.click();
    }
  }
}else{
  // nenhuma instância disponível: visitante sem painel público, ou conta sem acesso liberado
  const txt = document.getElementById("noInstText");
  if (txt) txt.innerHTML = isLogged()
    ? "<b>Você ainda não tem acesso a nenhuma instância.</b> Peça a um administrador para liberar."
    : "<b>Entre para ver os disparos.</b> Este painel só aparece para quem tem acesso.";
  hideSplash();
  if (!isLogged()) document.querySelector('[data-action="login"]')?.click();
}
if (logged){
  fetchTemplates().catch(() => {});
  setInterval(() => { if (!document.hidden) fetchTemplates().catch(() => {}); }, 60000);
}
