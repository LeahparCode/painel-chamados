// Modal de detalhes/edição de um disparo.
import { HORARIOS, TIPOS } from "../core/config.js";
import { subscribe, findRecord } from "../core/state.js";
import { statusKey, costOf, remainingMs, dayOf } from "../core/records.js";
import { fmtInt, fmtMoney, fmtTempo, fmtRemaining, capitalize } from "../core/format.js";
import { fmtLong } from "../core/dates.js";
import { fraseByKey, fillFraseSelect, templateLabel, smsParts } from "../core/frases.js";
import { saveRecord, setStatus, removeRecord } from "../core/actions.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
const modal = () => $("detailModal");

let currentId = null;
let timer = null;

function fillSelect(select, options, emptyLabel, current){
  select.innerHTML = "";
  if (emptyLabel !== null) select.append(new Option(emptyLabel, ""));
  const list = current && !options.includes(current) ? [...options, current] : options;
  list.forEach(o => select.append(new Option(o, o)));
  select.value = current || "";
}

export function phraseMetaHtml(frase){
  if (!frase) return "";
  const len = [...frase.texto].length;
  const parts = frase.canal === "SMS" ? smsParts(frase.texto) : 0;
  return [
    `<span class="chip chip-brand">#${String(frase.id).padStart(2, "0")}</span>`,
    `<span class="chip">${frase.tom}</span>`,
    `<span class="chip ${frase.canal === "SMS" ? "chip-sms" : "chip-wpp"}">${frase.canal}</span>`,
    `<span class="chip ${parts > 1 ? "chip-warn" : ""}">${len} caract.${parts ? ` · ${parts} SMS` : ""}</span>`,
  ].join("");
}

function renderPhrase(templateKey){
  const frase = fraseByKey(templateKey);
  const text = $("dPhrase");
  $("dPhraseMeta").innerHTML = frase ? phraseMetaHtml(frase) : `<span class="chip">${templateLabel(templateKey)}</span>`;
  text.textContent = frase ? frase.texto : "Nenhuma frase Safra associada a este disparo.";
  text.classList.toggle("is-empty", !frase);
  $("dCopy").disabled = !frase;
}

function renderStatic(r){
  const key = statusKey(r.status);
  const chip = $("dStatus");
  chip.className = `status-chip ${key === "run" ? "" : key}`;
  chip.textContent = r.status || "Em andamento";
  $("dTitle").textContent = r.tipo || templateLabel(r.template);
  const day = dayOf(r);
  $("dSub").textContent = [day ? capitalize(fmtLong(day)) : "", r.horario].filter(Boolean).join(" · ");

  document.querySelectorAll("#dStatusActions [data-status]").forEach(b => {
    b.classList.toggle("is-active", statusKey(b.dataset.status) === key);
  });

  $("dVolume").textContent = fmtInt(r.volume);
  $("dValor").textContent = fmtMoney(costOf(r));
  $("dPotes").textContent = fmtInt(r.potes);
  $("dTempo").textContent = fmtTempo(r.tempo);
  $("dAtualizado").textContent = r.atualizadoEm
    ? new Date(r.atualizadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : "—";
  renderRemaining(r);
}

function renderRemaining(r){
  const key = statusKey(r.status);
  $("dRestante").textContent = key === "ok" ? "Finalizado" : key === "err" ? "—" : fmtRemaining(remainingMs(r));
}

function fillForm(r){
  $("eNome").value = r.tipo || "";
  $("eVolume").value = r.volume ?? "";
  $("ePotes").value = r.potes ?? "";
  $("eData").value = dayOf(r) || "";
  fillSelect($("eHorario"), HORARIOS, null, r.horario || HORARIOS[0]);
  fillSelect($("eTipo"), TIPOS, "Sem tipo", r.tipoDisparo || "");
  const tplSelect = $("eTemplate");
  fillFraseSelect(tplSelect);
  const tpl = (r.template || "").trim();
  if (tpl && !fraseByKey(tpl)) tplSelect.append(new Option(`${tpl} (antigo)`, tpl));
  tplSelect.value = tpl;
}

export function openDetail(id){
  const r = findRecord(id);
  if (!r) return;
  currentId = id;
  renderStatic(r);
  fillForm(r);
  renderPhrase(r.template);
  clearInterval(timer);
  timer = setInterval(() => {
    const cur = findRecord(currentId);
    if (cur) renderRemaining(cur);
  }, 1000);
  openModal(modal(), { onClose: () => { clearInterval(timer); currentId = null; } });
}

export function initDetail(){
  $("dStatusActions").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-status]");
    if (!btn || !currentId) return;
    const r = findRecord(currentId);
    if (!r || statusKey(r.status) === statusKey(btn.dataset.status)) return;
    await setStatus(currentId, btn.dataset.status);
  });

  $("eTemplate").addEventListener("change", (e) => renderPhrase(e.target.value));

  $("dEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = findRecord(currentId);
    if (!r) return;
    const next = {
      tipo: $("eNome").value.trim(),
      volume: Number($("eVolume").value || 0),
      potes: Number($("ePotes").value || 0),
      data: $("eData").value,
      horario: $("eHorario").value,
      tipoDisparo: $("eTipo").value,
      template: $("eTemplate").value,
    };
    if (!next.data){ toast("Informe a data do disparo.", "warn"); return; }
    const patch = {};
    for (const [k, v] of Object.entries(next)){
      const old = k === "data" ? dayOf(r) : (r[k] ?? "");
      if (String(old) !== String(v)) patch[k] = v;
    }
    if (!Object.keys(patch).length){ toast("Nada para salvar.", "warn", 1600, "nothing"); return; }
    const btn = $("dSave");
    btn.disabled = true;
    const ok = await saveRecord(currentId, patch, { success: "Alterações salvas." });
    btn.disabled = false;
    if (ok) closeModal(modal());
  });

  $("dDelete").addEventListener("click", async () => {
    if (!currentId) return;
    if (!confirm("Deseja excluir este disparo?")) return;
    const id = currentId;
    closeModal(modal());
    await removeRecord(id);
  });

  $("dCopy").addEventListener("click", async () => {
    try{
      await navigator.clipboard.writeText($("dPhrase").textContent || "");
      toast("Frase copiada!", "ok", 1600, "copy");
    }catch{
      toast("Não consegui copiar.", "error");
    }
  });

  // Mantém o modal sincronizado com atualizações em tempo real
  subscribe((_, reason) => {
    if (reason !== "records" || !currentId) return;
    const r = findRecord(currentId);
    if (!r){ closeModal(modal()); return; }
    renderStatic(r);
  });
}
