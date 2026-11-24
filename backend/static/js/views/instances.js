// Instâncias: seletor na barra lateral (todos) e tela de gerenciamento (administradores).
import { state } from "../core/state.js";
import { TEMA_NOMES, TEMA_CORES, openInstance, fetchInstancias, instanciasApi } from "../core/instance.js";
import { usersApi } from "../core/auth.js";
import { escapeHtml } from "../core/format.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
const swatchStyle = (tema) => { const [a, b] = TEMA_CORES[tema] || TEMA_CORES.azul; return `--a:${a};--b:${b}`; };
const MODELO_NOME = { padrao: "Padrão", safra: "Safra" };
const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

/* ---------------- seletor na barra lateral ---------------- */
export function initInstanceSwitcher({ onManage } = {}){
  const wrap = $("instWrap");
  const inst = state.inst;
  if (!inst){ wrap.hidden = true; return; }
  const list = state.instancias || [];
  const many = list.length > 1;
  const manage = state.gerenciarInst;
  wrap.hidden = false;
  $("instName").textContent = inst.nome;
  $("instSwatch").setAttribute("style", swatchStyle(inst.tema));
  const btn = $("instBtn");
  btn.classList.toggle("is-static", !many && !manage);
  btn.title = many ? "Trocar de instância" : inst.nome;
  if (!many && !manage) return;

  const pop = $("instPop");
  pop.innerHTML = `<p class="palette-title">Instâncias</p>` + list.map(i => `
    <button type="button" role="menuitemradio" data-open="${escapeHtml(i.slug)}" aria-checked="${i.id === inst.id}">
      <span class="swatch" style="${swatchStyle(i.tema)}"></span>
      <span>${escapeHtml(i.nome)}<small>${i.podeEditar ? "Pode editar" : "Somente leitura"}</small></span>
    </button>`).join("")
    + (manage ? `<button type="button" class="inst-manage" data-manage>${ICON_GEAR}<span>Gerenciar instâncias</span></button>` : "");

  const open = (v) => { pop.hidden = !v; btn.setAttribute("aria-expanded", v ? "true" : "false"); };
  btn.addEventListener("click", (e) => { e.stopPropagation(); open(pop.hidden); });
  pop.addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o){ if (o.dataset.open !== inst.slug) openInstance(o.dataset.open); else open(false); return; }
    if (e.target.closest("[data-manage]")){ open(false); onManage?.(); }
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest(".inst-wrap")) open(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden){ open(false); btn.focus(); } });
}

/* ---------------- tela de gerenciamento (admin) ---------------- */
let users = [];
let editing = null;
let temaEscolhido = "azul";
let logoAtual = ""; // data URL da marca d'água no formulário ("" = sem logo)

/* ---------------- logo (marca d'água) ----------------
   Só a FORMA da logo é usada (vira máscara pintada com a cor do tema), então o arquivo é convertido
   para um PNG preto com transparência: fundo branco/liso some, a logo é recortada nas bordas e
   reduzida até caber numa célula da planilha. */
const LOGO_MAX_CHARS = 44000;

function loadImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não consegui ler a imagem.")); };
    img.src = url;
  });
}

function toMask(img, maxSide){
  let w = img.naturalWidth || 600, h = img.naturalHeight || 600;
  const k = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  const px = data.data;
  let transp = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 250) transp++;
  const temAlfa = transp > (w * h) * 0.02;
  // cor do fundo = média dos 4 cantos (para imagens sem transparência)
  const at = (x, y) => (y * w + x) * 4;
  const cantos = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const bg = [0, 1, 2].map(c => cantos.reduce((s, i) => s + px[i + c], 0) / 4);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const i = at(x, y);
    let a = px[i + 3];
    if (!temAlfa){
      const d = Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2]));
      a = Math.max(0, Math.min(255, (d - 24) * 3));
    }
    px[i] = px[i + 1] = px[i + 2] = 0;
    px[i + 3] = a;
    if (a > 12){ if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) throw new Error("A imagem parece vazia (nenhuma forma encontrada).");
  g.putImageData(data, 0, 0);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = Object.assign(document.createElement("canvas"), { width: cw, height: ch });
  out.getContext("2d").drawImage(cv, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

async function prepareLogo(file){
  if (!/^image\/(png|svg\+xml|jpeg|webp)$/.test(file.type)) throw new Error("Envie um arquivo PNG, SVG, JPG ou WebP.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Arquivo grande demais (máx. 8 MB).");
  const { img, url } = await loadImage(file);
  try{
    for (let lado = 720; lado >= 120; lado = Math.round(lado * 0.8)){
      const dataUrl = toMask(img, lado);
      if (dataUrl.length <= LOGO_MAX_CHARS) return dataUrl;
    }
    throw new Error("Logo detalhada demais. Tente uma versão mais simples (SVG ou PNG).");
  }finally{
    URL.revokeObjectURL(url);
  }
}

function renderLogoPreview(){
  const box = $("iLogoPreview");
  box.classList.toggle("has-logo", !!logoAtual);
  box.style.setProperty("--logo", logoAtual ? `url("${logoAtual}")` : "none");
  box.innerHTML = logoAtual ? "<i></i>" : "<em>Sem logo</em>";
  $("iLogoRemove").hidden = !logoAtual;
}

async function loadUsers(){
  try{ users = await usersApi.list(); }catch{ users = []; }
}

function render(){
  const list = state.instancias || [];
  $("instCount").textContent = `${list.length} instância${list.length === 1 ? "" : "s"}`;
  $("instGrid").innerHTML = list.map(i => {
    const acesso = users.filter(u => u.papel !== "admin" && (u.instancias || []).includes(i.id)).length;
    const atual = i.id === state.inst?.id;
    return `
    <article class="inst-card ${atual ? "is-current" : ""}" style="${swatchStyle(i.tema)}">
      <div class="inst-card-top">
        <span class="swatch"></span>
        <div class="inst-card-title"><h3>${escapeHtml(i.nome)}</h3><small>?i=${escapeHtml(i.slug)}</small></div>
        ${atual ? '<span class="chip chip-brand">Aberta</span>' : ""}
      </div>
      <div class="inst-card-chips">
        <span class="chip">${escapeHtml(TEMA_NOMES[i.tema] || i.tema)}</span>
        <span class="chip">Modelo ${escapeHtml(MODELO_NOME[i.modelo] || i.modelo)}</span>
        ${i.logo || i.modelo === "safra" ? '<span class="chip">Com marca d\'água</span>' : ""}
        <span class="chip ${i.publico ? "chip-warn" : ""}">${i.publico ? "Visível para todos os operadores" : "Só quem tem acesso"}</span>
      </div>
      <p class="inst-card-meta">${acesso} operador(es) com acesso · abas <b>${escapeHtml(i.abaDisparos || "")}</b> e <b>${escapeHtml(i.abaTemplates || "")}</b></p>
      <div class="inst-card-actions">
        ${atual ? "" : `<button type="button" class="btn btn-soft btn-sm" data-open="${escapeHtml(i.slug)}">Abrir</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-edit="${escapeHtml(i.id)}">Editar</button>
      </div>
    </article>`;
  }).join("");
}

export async function setInstancesVisible(v){
  if (!v) return;
  render();
  await loadUsers();
  render();
}

function renderTemaPicker(){
  $("iTema").innerHTML = Object.keys(TEMA_NOMES).map(t => `
    <button type="button" role="radio" aria-checked="${t === temaEscolhido}" data-tema="${t}">
      <span class="swatch" style="${swatchStyle(t)}"></span><span>${TEMA_NOMES[t]}${t === "azul" ? "<small>Padrão do app</small>" : ""}</span>
    </button>`).join("");
}

function showError(msg){ $("iError").textContent = msg || ""; $("iError").hidden = !msg; }

function openEditor(inst = null){
  editing = inst;
  temaEscolhido = inst?.tema || "azul";
  logoAtual = inst?.logo || "";
  $("iLogoFile").value = "";
  renderLogoPreview();
  $("iTitle").textContent = inst ? "Editar instância" : "Nova instância";
  $("iSub").textContent = inst ? `Endereço: ?i=${inst.slug}` : "Um painel separado, com disparos, templates e cores próprios.";
  $("iNome").value = inst?.nome || "";
  $("iModelo").value = inst?.modelo || "padrao";
  $("iPublico").checked = !!inst?.publico;
  $("iAbas").hidden = !inst;
  $("iAbas").innerHTML = inst ? `Dados nas abas <b>${escapeHtml(inst.abaDisparos)}</b> e <b>${escapeHtml(inst.abaTemplates)}</b> da planilha.` : "";
  $("iDelete").hidden = !inst || (state.instancias || []).length <= 1;
  $("iSave").textContent = inst ? "Salvar" : "Criar instância";
  renderTemaPicker();
  showError("");
  openModal($("instModal"));
  setTimeout(() => $("iNome").focus(), 40);
}

async function reloadList(){
  await fetchInstancias();
  state.inst = (state.instancias || []).find(i => i.id === state.inst?.id) || state.inst;
  render();
}

export function initInstancesAdmin(){
  $("btnNewInst").addEventListener("click", () => openEditor());
  $("instGrid").addEventListener("click", (e) => {
    const o = e.target.closest("[data-open]");
    if (o){ openInstance(o.dataset.open); return; }
    const ed = e.target.closest("[data-edit]");
    if (ed) openEditor((state.instancias || []).find(i => i.id === ed.dataset.edit));
  });
  $("iLogoFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showError("");
    try{
      logoAtual = await prepareLogo(file);
      renderLogoPreview();
    }catch(err){
      showError(err.message || "Não consegui usar essa imagem.");
    }finally{
      e.target.value = "";
    }
  });
  $("iLogoRemove").addEventListener("click", () => { logoAtual = ""; renderLogoPreview(); });
  $("iTema").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tema]");
    if (!b) return;
    temaEscolhido = b.dataset.tema;
    renderTemaPicker();
  });

  $("instForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = { nome: $("iNome").value.trim(), tema: temaEscolhido, modelo: $("iModelo").value, publico: $("iPublico").checked, logo: logoAtual };
    if (!data.nome){ showError("Dê um nome à instância."); return; }
    const btn = $("iSave"); btn.disabled = true;
    try{
      const res = editing ? await instanciasApi.update(editing.id, data) : await instanciasApi.create(data);
      closeModal($("instModal"));
      const atual = editing && editing.id === state.inst?.id;
      if (atual){ toast("Instância atualizada.", "ok"); setTimeout(() => location.reload(), 600); return; }
      toast(editing ? "Instância atualizada." : `Instância "${res.nome}" criada. Libere o acesso das pessoas em Usuários.`, "ok", 4000);
      await reloadList();
    }catch(err){
      showError(err.message || "Não consegui salvar.");
    }finally{
      btn.disabled = false;
    }
  });

  $("iDelete").addEventListener("click", async () => {
    if (!editing) return;
    const msg = `Excluir a instância "${editing.nome}"?\n\nEla some do painel e ninguém mais acessa. ` +
      `Os dados NÃO são apagados: as abas "${editing.abaDisparos}" e "${editing.abaTemplates}" continuam na planilha.`;
    if (!confirm(msg)) return;
    try{
      await instanciasApi.remove(editing.id);
      closeModal($("instModal"));
      toast("Instância excluída. As abas continuam na planilha.", "ok", 4000);
      if (editing.id === state.inst?.id){ setTimeout(() => { location.href = location.pathname; }, 800); return; }
      await reloadList();
      await loadUsers();
      render();
    }catch(err){
      showError(err.message || "Não consegui excluir.");
    }
  });
}
