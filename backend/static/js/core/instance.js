// Instância atual (um painel por cliente). Define os dados, o tema de cores e os recursos da tela.
// A permissão de verdade é conferida no servidor; aqui só escolhemos o que mostrar.
import { state } from "./state.js";

const LAST_KEY = "painel_inst";        // última instância aberta neste navegador
const THEMES_KEY = "painel_inst_temas"; // slug → { tema, modelo } (aplicado antes de pintar a tela)

export const TEMA_NOMES = {
  "azul": "Azul e branco",
  "azul-dourado": "Azul e dourado",
  "vermelho": "Vermelho e branco",
  "violeta": "Violeta e grafite",
};
export const TEMA_CORES = {
  "azul": ["#1468e0", "#ffffff"],
  "azul-dourado": ["#0b1f45", "#c19a45"],
  "vermelho": ["#e00012", "#ffffff"],
  "violeta": ["#5b4cf0", "#15132a"],
};

export const instId = () => state.inst?.id || "";
export const isSafra = () => state.inst?.modelo === "safra";
/** Cabeçalho que diz ao servidor de qual instância é a chamada */
export const instHeaders = () => (state.inst ? { "X-Instancia": state.inst.id } : {});

export async function fetchInstancias(){
  try{
    const resp = await fetch("/api/instancias", { cache: "no-store", credentials: "same-origin" });
    const data = await resp.json();
    state.instancias = Array.isArray(data.instancias) ? data.instancias : [];
    state.gerenciarInst = !!data.gerenciar;
  }catch{
    state.instancias = [];
  }
  return state.instancias;
}

function readThemes(){
  try{ return JSON.parse(localStorage.getItem(THEMES_KEY) || "{}") || {}; }catch{ return {}; }
}

/** Escolhe a instância: ?i= na URL → última aberta → primeira disponível. */
export function pickInstance(){
  const list = state.instancias || [];
  const params = new URLSearchParams(location.search);
  const wanted = (params.get("i") || "").toLowerCase();
  let last = "";
  try{ last = localStorage.getItem(LAST_KEY) || ""; }catch{}
  const byKey = (k) => list.find(i => i.slug === k || i.id === k);
  // sem pedido explícito: a última aberta, senão a primeira que a pessoa pode editar
  state.inst = (wanted && byKey(wanted)) || (last && byKey(last)) || list.find(i => i.podeEditar) || list[0] || null;
  state.instNegada = !!(wanted && !byKey(wanted)); // pediu uma instância sem acesso

  if (state.inst){
    try{
      // só lembra a última instância de quem está logado (o que um visitante olhou não decide o login)
      if (state.user) localStorage.setItem(LAST_KEY, state.inst.slug);
      const themes = readThemes();
      list.forEach(i => { themes[i.slug] = { tema: i.tema, modelo: i.modelo, wm: (i.marca || "").includes("logo-safra") ? "safra" : (i.marca ? "logo" : "") }; });
      localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
    }catch{}
    // pediu uma instância sem acesso: mantém o endereço (depois de entrar, ela abre)
    if (!state.instNegada && params.get("i") !== state.inst.slug){
      params.set("i", state.inst.slug);
      try{ history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`); }catch{}
    }
  }
  applyInstance();
  return state.inst;
}

export function applyInstance(){
  const root = document.documentElement;
  const inst = state.inst;
  const tema = inst?.tema || "azul";
  if (tema === "violeta") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", tema);
  root.classList.toggle("inst-safra", isSafra());
  applyWatermark(inst);
  root.classList.toggle("no-inst", !inst);
  root.classList.toggle("multi-inst", (state.instancias || []).length > 1);
  document.title = inst ? `${inst.nome} · Painel de Disparos` : "Painel de Disparos";
}

/** Marca d'água: arquivo da instância (static/img/marcas/<slug>.svg); sem ele, brasão Safra nas instâncias Safra. */
function applyWatermark(inst){
  const root = document.documentElement;
  const wm = document.querySelector(".brand-watermark");
  if (!wm) return;
  const logo = inst?.marca || "";
  if (logo && !logo.includes("logo-safra")){
    const img = new Image();
    img.onload = () => {
      wm.style.setProperty("--wm-ratio", `${img.naturalWidth} / ${img.naturalHeight}`);
      wm.style.setProperty("--wm-image", `url("${logo}")`);
      root.classList.add("has-wm");
    };
    img.src = logo;
  }else{
    wm.style.removeProperty("--wm-image");
    wm.style.removeProperty("--wm-ratio");
    root.classList.toggle("has-wm", !!logo); // brasão Safra: imagem e proporção padrão do CSS
  }
}

/** Abre outra instância (recarrega a página para começar limpa, sem misturar dados). */
export function openInstance(slug){
  const params = new URLSearchParams(location.search);
  params.set("i", slug);
  try{ if (state.user) localStorage.setItem(LAST_KEY, slug); }catch{}
  location.href = `${location.pathname}?${params}#painel`;
}

export const instanciasApi = {
  async call(method, path, body){
    const resp = await fetch(path, {
      method, cache: "no-store", credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok){ const e = new Error(data.message || `HTTP ${resp.status}`); e.status = resp.status; throw e; }
    return data;
  },
  create(data){ return this.call("POST", "/api/instancias", data); },
  update(id, data){ return this.call("PATCH", `/api/instancias/${encodeURIComponent(id)}`, data); },
  remove(id){ return this.call("DELETE", `/api/instancias/${encodeURIComponent(id)}`); },
};
