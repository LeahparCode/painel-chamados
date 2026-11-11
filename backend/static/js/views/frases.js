// Biblioteca de frases Safra (busca, filtros, copiar e usar em disparo).
import { FRASES, TONS, keyOf, smsParts } from "../core/frases.js";
import { escapeHtml } from "../core/format.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
const filters = { q: "", canal: "", tom: "" };
let onUse = () => {};

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function highlight(text, q){
  const safe = escapeHtml(text);
  if (!q) return safe;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try{ return safe.replace(new RegExp(`(${escapeHtml(esc)})`, "gi"), "<mark>$1</mark>"); }
  catch{ return safe; }
}

function render(){
  const q = norm(filters.q.trim());
  const list = FRASES.filter(f => {
    if (filters.canal && f.canal !== filters.canal) return false;
    if (filters.tom && f.tom !== filters.tom) return false;
    if (!q) return true;
    return norm(f.texto).includes(q) || norm(f.tom).includes(q) || String(f.id) === q.replace("#", "");
  });

  $("frasesCount").textContent = `${list.length} de ${FRASES.length} frases · ${FRASES.filter(f => f.canal === "SMS").length} SMS · ${FRASES.filter(f => f.canal === "WhatsApp").length} WhatsApp`;

  if (!list.length){
    $("frasesGrid").innerHTML = `<div class="frases-empty">Nenhuma frase encontrada com esses filtros.</div>`;
    return;
  }
  const rawQ = filters.q.trim();
  $("frasesGrid").innerHTML = list.map(f => {
    const len = [...f.texto].length;
    const parts = f.canal === "SMS" ? smsParts(f.texto) : 0;
    return `
      <article class="frase" data-key="${keyOf(f)}">
        <div class="frase-head">
          <span class="frase-id">#${String(f.id).padStart(2, "0")}</span>
          <span class="chip">${escapeHtml(f.tom)}</span>
          <span class="chip ${f.canal === "SMS" ? "chip-sms" : "chip-wpp"}">${f.canal}</span>
          <span class="frase-len ${parts > 1 ? "is-over" : ""}" title="${parts > 1 ? "Acima de 160 caracteres: será cobrado como mais de 1 SMS" : ""}">${len} caract.${parts ? ` · ${parts} SMS` : ""}</span>
        </div>
        <p class="frase-text">${highlight(f.texto, rawQ)}</p>
        <div class="frase-actions">
          <button type="button" class="btn btn-soft btn-sm" data-copy>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copiar
          </button>
          <button type="button" class="btn btn-ghost btn-sm" data-use>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
            Usar em disparo
          </button>
        </div>
      </article>`;
  }).join("");
}

export function initFrases(opts = {}){
  onUse = opts.onUse || onUse;
  const tom = $("frasesTom");
  TONS.forEach(t => tom.append(new Option(t, t)));

  $("frasesSearch").addEventListener("input", (e) => { filters.q = e.target.value; render(); });
  tom.addEventListener("change", (e) => { filters.tom = e.target.value; render(); });
  $("frasesCanal").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-canal]");
    if (!btn) return;
    filters.canal = btn.dataset.canal;
    $("frasesCanal").querySelectorAll("button").forEach(b => b.classList.toggle("is-active", b === btn));
    render();
  });

  $("frasesGrid").addEventListener("click", async (e) => {
    const card = e.target.closest(".frase");
    if (!card) return;
    const frase = FRASES.find(f => keyOf(f) === card.dataset.key);
    if (!frase) return;
    if (e.target.closest("[data-copy]")){
      try{
        await navigator.clipboard.writeText(frase.texto);
        toast(`Frase #${String(frase.id).padStart(2, "0")} copiada!`, "ok", 1600, "copy");
      }catch{
        toast("Não consegui copiar.", "error");
      }
    }else if (e.target.closest("[data-use]")){
      onUse(card.dataset.key);
    }
  });

  render();
}
