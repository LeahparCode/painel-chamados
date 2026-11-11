// Frases disponíveis para os disparos: fraseologia Safra (fixa) + templates próprios (salvos na planilha).
//
// Todas as frases são representadas no mesmo formato:
//   { key, custom, code, name, tom, tipo, texto }
//   - key:   valor gravado no campo Template do disparo (safra_07 ou o ID do template próprio)
//   - tipo:  tipo de disparo a que a frase pertence (SMS, RCS ou WhatsApp)
import { FRASES_SAFRA } from "../data/frases-safra.js";
import { TIPOS } from "./config.js";
import { state } from "./state.js";

const pad2 = (n) => String(n).padStart(2, "0");
export const keyOf = (f) => `safra_${pad2(f.id)}`;

/**
 * Quais canais da fraseologia Safra servem para cada tipo de disparo.
 * Não há frases Safra próprias de RCS; como o RCS também é entregue como mensagem de texto,
 * ele usa as frases de SMS (além dos templates próprios de RCS).
 */
export const SAFRA_CANAIS_POR_TIPO = { SMS: ["SMS"], RCS: ["SMS"], WhatsApp: ["WhatsApp"] };

const SAFRA = FRASES_SAFRA.map(f => ({
  key: keyOf(f),
  custom: false,
  code: `#${pad2(f.id)}`,
  name: `Safra #${pad2(f.id)} · ${f.tom}`,
  tom: f.tom,
  tipo: f.canal,      // SMS ou WhatsApp
  canal: f.canal,
  texto: f.texto,
  num: f.id,
}));
const SAFRA_BY_KEY = new Map(SAFRA.map(f => [f.key, f]));

export const FRASES = SAFRA;

function fromTemplate(t){
  return {
    key: t.id,
    custom: true,
    code: "Próprio",
    name: t.nome || "Template",
    tom: "Template próprio",
    tipo: t.tipo,
    canal: t.tipo,
    texto: t.texto || "",
    atualizadoEm: t.atualizadoEm || "",
  };
}

/** Templates próprios (já no formato comum), mais recentes primeiro */
export const customFrases = () => (state.templates || []).map(fromTemplate);

/** Todas as frases (próprias + Safra) */
export const allFrases = () => [...customFrases(), ...SAFRA];

export function fraseByKey(key){
  const k = (key || "").trim();
  if (!k) return null;
  if (SAFRA_BY_KEY.has(k)) return SAFRA_BY_KEY.get(k);
  const t = (state.templates || []).find(x => x.id === k);
  return t ? fromTemplate(t) : null;
}

/** A frase serve para esse tipo de disparo? */
export function fraseFitsTipo(f, tipo){
  if (!f || !tipo) return true;
  if (f.custom) return f.tipo === tipo;
  return (SAFRA_CANAIS_POR_TIPO[tipo] || []).includes(f.canal);
}

/** Frases disponíveis para um tipo de disparo */
export function frasesForTipo(tipo){
  return allFrases().filter(f => fraseFitsTipo(f, tipo));
}

/** Texto curto para listas: "#07 · Importante · SMS" ou "Nome · RCS" */
export const fraseLabel = (f) => f.custom ? `${f.name} · ${f.tipo}` : `${f.code} · ${f.tom} · ${f.canal}`;

/** Nome amigável para o campo Template de um disparo */
export function templateLabel(key){
  const f = fraseByKey(key);
  if (f) return fraseLabel(f);
  return (key || "").trim() || "Sem frase";
}

/** Classe do chip de acordo com o tipo/canal */
export const chipClass = (tipo) => ({ SMS: "chip-sms", WhatsApp: "chip-wpp", RCS: "chip-rcs" }[tipo] || "");

export const TONS = [...new Set(SAFRA.map(f => f.tom))].sort((a, b) => a.localeCompare(b, "pt-BR"));
export { TIPOS };

/** Quantidade de SMS (160 caracteres p/ 1 SMS, 153 por parte quando concatenado) */
export function smsParts(text){
  const len = [...(text || "")].length;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

const preview = (texto) => texto.replace(/\s+/g, " ").replace(/^Banco Safra:\s*/i, "").slice(0, 60);

/**
 * Preenche o <select> de frases com as opções do tipo escolhido.
 * Sem tipo, o campo fica desabilitado pedindo para escolher o tipo primeiro.
 * Se o disparo já tinha uma frase que não é do tipo (ou antiga), ela continua visível.
 */
export function fillFraseSelect(select, { tipo = "", current = "", emptyLabel = "Selecione uma frase…" } = {}){
  select.innerHTML = "";
  if (!tipo){
    select.append(new Option("Escolha o tipo primeiro", ""));
    select.disabled = true;
    if (current) select.append(new Option(`${templateLabel(current)} (atual)`, current));
    select.value = current || "";
    return;
  }
  select.disabled = false;
  select.append(new Option(emptyLabel, ""));

  const proprios = customFrases().filter(f => f.tipo === tipo);
  if (proprios.length){
    const g = document.createElement("optgroup");
    g.label = `Meus templates · ${tipo}`;
    proprios.forEach(f => g.append(new Option(`${f.name} — ${preview(f.texto)}…`, f.key)));
    select.append(g);
  }
  const canais = SAFRA_CANAIS_POR_TIPO[tipo] || [];
  canais.forEach(canal => {
    const g = document.createElement("optgroup");
    g.label = `Frases Safra · ${canal}${tipo !== canal ? ` (para ${tipo})` : ""}`;
    SAFRA.filter(f => f.canal === canal).forEach(f => g.append(new Option(`${f.code} · ${f.tom} — ${preview(f.texto)}…`, f.key)));
    select.append(g);
  });

  const cur = (current || "").trim();
  if (cur && ![...select.options].some(o => o.value === cur)){
    const f = fraseByKey(cur);
    select.append(new Option(`${f ? fraseLabel(f) : cur} (atual, de outro tipo)`, cur));
  }
  select.value = cur;
}
