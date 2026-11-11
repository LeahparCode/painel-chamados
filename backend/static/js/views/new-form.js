// Modal "Novo disparo".
import { HORARIOS, TAGS, TIPOS } from "../core/config.js";
import { state } from "../core/state.js";
import { costOf } from "../core/records.js";
import { fmtMoney, escapeHtml } from "../core/format.js";
import { fraseByKey, fillFraseSelect } from "../core/frases.js";
import { addRecord } from "../core/actions.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";
import { phraseMetaHtml } from "./detail.js";

const $ = (id) => document.getElementById(id);

function fill(select, options, emptyLabel){
  select.innerHTML = "";
  if (emptyLabel) select.append(new Option(emptyLabel, ""));
  options.forEach(o => select.append(new Option(o, o)));
}

function updatePreview(){
  const frase = fraseByKey($("nTemplate").value);
  const box = $("nPreview");
  box.hidden = !frase;
  if (frase) box.innerHTML = `<div class="phrase-meta">${phraseMetaHtml(frase)}</div>${escapeHtml(frase.texto)}`;
}

function updateEstimate(){
  const valor = costOf({ volume: Number($("nVolume").value || 0), tipoDisparo: $("nTipo").value });
  $("nEstimate").textContent = fmtMoney(valor);
}

/** Abre o formulário. Opções: { day, template } */
export function openNewForm({ day, template } = {}){
  const form = $("newForm");
  form.reset();
  $("nData").value = day || state.view.ref;
  $("nHorario").value = HORARIOS[0];
  $("nTemplate").value = template || "";
  updatePreview();
  updateEstimate();
  openModal($("newModal"));
  setTimeout(() => $("nNome").focus(), 40);
}

export function initNewForm(){
  fill($("nHorario"), HORARIOS);
  fill($("nTag"), TAGS, "Sem tag");
  fill($("nTipo"), TIPOS, "Sem tipo");
  fillFraseSelect($("nTemplate"), { emptyLabel: "Selecione uma frase…" });

  $("nTemplate").addEventListener("change", updatePreview);
  $("nVolume").addEventListener("input", updateEstimate);
  $("nTipo").addEventListener("change", updateEstimate);

  $("newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("nNome").value.trim();
    const template = $("nTemplate").value;
    const data = $("nData").value;
    let horas = parseInt($("nHoras").value || "0", 10);
    let minutos = parseInt($("nMinutos").value || "0", 10);
    horas = Number.isNaN(horas) ? 0 : Math.max(0, horas);
    minutos = Number.isNaN(minutos) ? 0 : minutos;

    if (!data){ toast("Informe a data do disparo.", "warn"); return; }
    if (!nome && !template){ toast("Preencha o nome ou escolha uma frase.", "warn"); return; }
    if (minutos < 0 || minutos > 59){ toast("Minutos devem estar entre 0 e 59.", "warn"); return; }
    const tempo = horas * 60 + minutos;
    if (tempo <= 0){ toast("Informe um tempo médio válido.", "warn"); return; }

    const payload = {
      tipo: nome,
      template,
      data,
      horario: $("nHorario").value,
      tag: $("nTag").value,
      tipoDisparo: $("nTipo").value,
      volume: Number($("nVolume").value || 0),
      potes: Number($("nPotes").value || 0),
      tempo,
      status: "Em andamento",
    };

    const submit = e.target.querySelector('[type="submit"]');
    submit.disabled = true;
    closeModal($("newModal"));
    const ok = await addRecord(payload);
    submit.disabled = false;
    if (!ok) openModal($("newModal"));
  });

  document.querySelectorAll('[data-action="new"]').forEach(btn =>
    btn.addEventListener("click", () => openNewForm()));
}
