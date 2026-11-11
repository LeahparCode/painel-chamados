// Biblioteca de frases: fraseologia Safra + templates próprios (busca, filtros, copiar, usar, editar).
import { state, subscribe } from "../core/state.js";
import { fetchTemplates, removeTemplate } from "../core/api.js";
import { FRASES, TONS, allFrases, fraseFitsTipo, fraseByKey, smsParts, chipClass } from "../core/frases.js";
import { escapeHtml } from "../core/format.js";
import { toast } from "../ui/toast.js";
import { openTemplateEditor } from "./template-editor.js";

const $ = (id) => document.getElementById(id);
const filters = { q: "", tipo: "", origem: "", tom: "" };
let onUse = () => {};

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function highlight(text, q){
  const safe = escapeHtml(text);
  if (!q) return safe;
  const esc = escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try{ return safe.replace(new RegExp(`(${esc})`, "gi"), "<mark>$1</mark>"); }
  catch{ return safe; }
}

const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_USE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

function cardHtml(f, rawQ){
  const len = [...f.texto].length;
  const sms = f.tipo === "SMS" || f.tipo === "RCS";
  const parts = sms ? smsParts(f.texto) : 0;
  // frases Safra de SMS também servem para RCS
  const tipos = f.custom ? [f.tipo] : (f.canal === "SMS" ? ["SMS", "RCS"] : [f.canal]);
  return `
    <article class="frase ${f.custom ? "is-own" : ""}" data-key="${escapeHtml(f.key)}">
      <div class="frase-head">
        <span class="frase-id ${f.custom ? "is-own" : ""}">${escapeHtml(f.custom ? "Próprio" : f.code)}</span>
        ${f.custom ? "" : `<span class="chip">${escapeHtml(f.tom)}</span>`}
        ${tipos.map(t => `<span class="chip ${chipClass(t)}">${t}</span>`).join("")}
        <span class="frase-len ${parts > 1 ? "is-over" : ""}" title="${parts > 1 ? "Acima de 160 caracteres: será cobrado como mais de 1 SMS" : ""}">${len} caract.${parts ? ` · ${parts} SMS` : ""}</span>
      </div>
      ${f.custom ? `<p class="frase-name">${highlight(f.name, rawQ)}</p>` : ""}
      <p class="frase-text">${highlight(f.texto, rawQ)}</p>
      <div class="frase-actions">
        <button type="button" class="btn btn-soft btn-sm" data-copy>${ICON_COPY}Copiar</button>
        <button type="button" class="btn btn-ghost btn-sm" data-use title="Usar em disparo">${ICON_USE}${f.custom ? "Usar" : "Usar em disparo"}</button>
        ${f.custom ? `<button type="button" class="icon-btn" data-edit title="Editar template" aria-label="Editar template">${ICON_EDIT}</button>
        <button type="button" class="icon-btn danger" data-delete title="Excluir template" aria-label="Excluir template">${ICON_DEL}</button>` : ""}
      </div>
    </article>`;
}

function render(){
  const q = norm(filters.q.trim());
  const all = allFrases();
  const proprios = all.filter(f => f.custom).length;
  const list = all.filter(f => {
    if (filters.origem === "proprios" && !f.custom) return false;
    if (filters.origem === "safra" && f.custom) return false;
    if (filters.tipo && !fraseFitsTipo(f, filters.tipo)) return false;
    if (filters.tom && (f.custom || f.tom !== filters.tom)) return false;
    if (!q) return true;
    return norm(f.texto).includes(q) || norm(f.tom).includes(q) || norm(f.name).includes(q) || (!f.custom && String(f.num) === q.replace("#", ""));
  });

  $("frasesCount").textContent = `${list.length} de ${all.length} · ${FRASES.length} frases Safra · ${proprios} template(s) próprio(s)`;
  const note = $("frasesNote");
  note.hidden = filters.tipo !== "RCS" || filters.origem === "proprios";
  note.textContent = "Não há frases Safra específicas de RCS: para RCS aparecem as frases de SMS e os seus templates de RCS.";

  if (!list.length){
    const vazioProprios = filters.origem === "proprios" && !proprios;
    $("frasesGrid").innerHTML = `<div class="frases-empty">
      ${vazioProprios ? "Você ainda não escreveu nenhum template." : "Nenhuma frase encontrada com esses filtros."}
      ${vazioProprios ? `<div><button type="button" class="btn btn-primary btn-sm" data-empty-new>Escrever meu primeiro template</button></div>` : ""}
    </div>`;
    return;
  }
  const rawQ = filters.q.trim();
  $("frasesGrid").innerHTML = list.map(f => cardHtml(f, rawQ)).join("");
}

export function initFrases(opts = {}){
  onUse = opts.onUse || onUse;
  const tom = $("frasesTom");
  TONS.forEach(t => tom.append(new Option(t, t)));

  $("frasesSearch").addEventListener("input", (e) => { filters.q = e.target.value; render(); });
  tom.addEventListener("change", (e) => { filters.tom = e.target.value; render(); });

  const segmented = (id, attr, key) => $(id).addEventListener("click", (e) => {
    const btn = e.target.closest(`[data-${attr}]`);
    if (!btn) return;
    filters[key] = btn.dataset[attr];
    $(id).querySelectorAll("button").forEach(b => b.classList.toggle("is-active", b === btn));
    render();
  });
  segmented("frasesTipo", "tipo", "tipo");
  segmented("frasesOrigem", "origem", "origem");

  const newTemplate = () => openTemplateEditor({ tipo: filters.tipo });
  $("btnNewTemplate").addEventListener("click", newTemplate);

  $("frasesGrid").addEventListener("click", async (e) => {
    if (e.target.closest("[data-empty-new]")){ newTemplate(); return; }
    const card = e.target.closest(".frase");
    if (!card) return;
    const frase = fraseByKey(card.dataset.key);
    if (!frase) return;
    const template = (state.templates || []).find(t => t.id === frase.key);

    if (e.target.closest("[data-copy]")){
      try{
        await navigator.clipboard.writeText(frase.texto);
        toast(`${frase.custom ? `"${frase.name}"` : `Frase ${frase.code}`} copiada!`, "ok", 1600, "copy");
      }catch{
        toast("Não consegui copiar.", "error");
      }
    }else if (e.target.closest("[data-use]")){
      onUse(frase.key, filters.tipo && frase.custom === false ? filters.tipo : frase.tipo);
    }else if (e.target.closest("[data-edit]") && template){
      openTemplateEditor({ template });
    }else if (e.target.closest("[data-delete]") && template){
      const usados = state.records.filter(r => r.template === template.id).length;
      const aviso = usados ? `\n\n${usados} disparo(s) usam este template. Eles continuam salvos, mas sem o texto da frase.` : "";
      if (!confirm(`Excluir o template "${template.nome}"?${aviso}`)) return;
      try{
        await removeTemplate(template.id);
        toast("Template excluído.", "ok");
      }catch(err){
        console.error("Falha ao excluir template", err);
        toast("Não consegui excluir o template.", "error");
      }
    }
  });

  subscribe((_, reason) => { if (reason === "templates") render(); });
  render();
}

/** Ao abrir a tela, busca templates atualizados (outras pessoas podem ter criado). */
export function refreshFrasesView(){
  fetchTemplates().catch(() => {});
}
