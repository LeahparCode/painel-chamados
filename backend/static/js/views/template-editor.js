// Modal para escrever, editar e excluir templates próprios.
import { TIPOS } from "../core/config.js";
import { state } from "../core/state.js";
import { saveTemplate, removeTemplate } from "../core/api.js";
import { smsParts } from "../core/frases.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
let editing = null;      // template sendo editado (ou null para novo)
let onSaved = null;      // callback(templateSalvo)

function updateCount(){
  const texto = $("tTexto").value;
  const len = [...texto].length;
  const tipo = $("tTipo").value;
  const sms = tipo === "SMS" || tipo === "RCS";
  const parts = sms ? smsParts(texto) : 0;
  const el = $("tCount");
  el.textContent = `${len} caracteres${sms && len ? ` · ${parts} SMS` : ""}`;
  el.classList.toggle("is-over", sms && parts > 1);
  el.title = sms && parts > 1 ? "Acima de 160 caracteres: será cobrado como mais de 1 SMS" : "";
}

/** Abre o editor. Opções: { template, tipo, onSaved } */
export function openTemplateEditor({ template = null, tipo = "", onSaved: cb = null } = {}){
  editing = template;
  onSaved = cb;
  $("tTitle").textContent = template ? "Editar template" : "Novo template";
  $("tNome").value = template?.nome || "";
  $("tTipo").value = template?.tipo || tipo || "";
  $("tTexto").value = template?.texto || "";
  $("tDelete").hidden = !template;
  updateCount();
  openModal($("tplModal"));
  setTimeout(() => $("tNome").focus(), 40);
}

function insertAtCursor(textarea, text){
  const { selectionStart: a, selectionEnd: b, value } = textarea;
  textarea.value = value.slice(0, a) + text + value.slice(b);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = a + text.length;
  updateCount();
}

export function initTemplateEditor(){
  const tipo = $("tTipo");
  tipo.append(new Option("Selecione o tipo…", ""));
  TIPOS.forEach(t => tipo.append(new Option(t, t)));

  $("tTexto").addEventListener("input", updateCount);
  tipo.addEventListener("change", updateCount);
  document.querySelectorAll("#tplModal [data-var]").forEach(b =>
    b.addEventListener("click", () => insertAtCursor($("tTexto"), b.dataset.var)));

  $("tplForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = { nome: $("tNome").value.trim(), tipo: $("tTipo").value, texto: $("tTexto").value.trim() };
    if (!payload.nome){ toast("Dê um nome ao template.", "warn"); $("tNome").focus(); return; }
    if (!payload.tipo){ toast("Escolha o tipo do template.", "warn"); $("tTipo").focus(); return; }
    if (!payload.texto){ toast("Escreva o texto do template.", "warn"); $("tTexto").focus(); return; }

    const btn = $("tSave");
    btn.disabled = true;
    try{
      const saved = await saveTemplate(editing?.id || null, payload);
      toast(editing ? "Template atualizado." : "Template salvo! Já aparece para esse tipo.", "ok", 2600);
      const cb = onSaved;
      closeModal($("tplModal"));
      cb && cb(saved);
    }catch(err){
      console.error("Falha ao salvar template", err);
      toast(err?.message && !/^HTTP/.test(err.message) ? err.message : "Não consegui salvar o template.", "error", 4000);
    }finally{
      btn.disabled = false;
    }
  });

  $("tDelete").addEventListener("click", async () => {
    if (!editing) return;
    const usados = state.records.filter(r => r.template === editing.id).length;
    const aviso = usados
      ? `\n\n${usados} disparo(s) usam este template. Eles continuam salvos, mas sem o texto da frase.`
      : "";
    if (!confirm(`Excluir o template "${editing.nome}"?${aviso}`)) return;
    try{
      await removeTemplate(editing.id);
      toast("Template excluído.", "ok");
      closeModal($("tplModal"));
    }catch(err){
      console.error("Falha ao excluir template", err);
      toast("Não consegui excluir o template.", "error");
    }
  });
}
