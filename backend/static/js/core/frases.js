// Acesso à fraseologia Safra.
import { FRASES_SAFRA } from "../data/frases-safra.js";

export const FRASES = FRASES_SAFRA;

const pad2 = (n) => String(n).padStart(2, "0");
export const keyOf = (f) => `safra_${pad2(f.id)}`;

const BY_KEY = new Map(FRASES.map(f => [keyOf(f), f]));

export const fraseByKey = (key) => BY_KEY.get((key || "").trim()) || null;

export function fraseLabel(f){
  return `#${pad2(f.id)} · ${f.tom} · ${f.canal}`;
}

/** Nome amigável para o campo Template de um disparo */
export function templateLabel(key){
  const f = fraseByKey(key);
  if (f) return fraseLabel(f);
  return (key || "").trim() || "Sem frase";
}

export const TONS = [...new Set(FRASES.map(f => f.tom))].sort((a, b) => a.localeCompare(b, "pt-BR"));

/** Quantidade de SMS (160 caracteres p/ 1 SMS, 153 por parte quando concatenado) */
export function smsParts(text){
  const len = [...(text || "")].length;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

/** Preenche <select> com as frases agrupadas por canal */
export function fillFraseSelect(select, { emptyLabel = "Sem frase" } = {}){
  select.innerHTML = "";
  select.append(new Option(emptyLabel, ""));
  for (const canal of ["SMS", "WhatsApp"]){
    const group = document.createElement("optgroup");
    group.label = canal;
    FRASES.filter(f => f.canal === canal).forEach(f => {
      const preview = f.texto.replace(/\s+/g, " ").replace(/^Banco Safra:\s*/i, "").slice(0, 60);
      group.append(new Option(`#${pad2(f.id)} · ${f.tom} — ${preview}…`, keyOf(f)));
    });
    select.append(group);
  }
}
