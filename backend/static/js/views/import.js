// Importação do calendário de ações (.json) → disparos do painel. Prévia antes de gravar.
import { fetchRecords } from "../core/api.js";
import { chipClass } from "../core/frases.js";
import { fmtInt, escapeHtml } from "../core/format.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
let calendario = null;
let arquivo = "";

const fmtBR = (iso) => iso ? iso.split("-").reverse().join("/") : "—";

async function enviar(confirmar){
  const resp = await fetch(`/api/import/calendario${confirmar ? "?confirmar=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(calendario),
    credentials: "same-origin",
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
  return data;
}

function renderPrevia(r){
  const box = $("importResult");
  const tipos = Object.entries(r.porTipo || {}).map(([t, n]) => `<span class="chip ${chipClass(t)}">${escapeHtml(t)}: ${fmtInt(n)}</span>`).join("");
  const linhas = (r.amostra || []).map(a => `
    <tr><td>${fmtBR(a.data)}</td><td><span class="chip ${chipClass(a.tipoDisparo)}">${escapeHtml(a.tipoDisparo)}</span></td>
    <td class="wrap">${escapeHtml(a.tipo)}</td><td>${escapeHtml(a.status)}</td><td class="num">${a.volume ? fmtInt(a.volume) : "—"}</td></tr>`).join("");
  box.innerHTML = `
    <p class="import-file">Arquivo: <b>${escapeHtml(arquivo)}</b> · ${fmtBR(r.de)} a ${fmtBR(r.ate)}</p>
    <div class="import-kpis">
      <div class="kpi"><span>Ações no arquivo</span><b>${fmtInt(r.total)}</b></div>
      <div class="kpi kpi-brand"><span>Novas</span><b>${fmtInt(r.novos)}</b></div>
      <div class="kpi"><span>Já importadas</span><b>${fmtInt(r.duplicados)}</b><small>serão ignoradas</small></div>
      <div class="kpi"><span>Já passadas</span><b>${fmtInt(r.finalizados)}</b><small>entram como Finalizado</small></div>
    </div>
    ${tipos ? `<div class="import-chips">Novas por tipo: ${tipos}</div>` : ""}
    <p class="import-rules">
      <b>Como cada ação entra:</b> data e canal do calendário · nome = resumo do texto · texto completo em <b>Observações</b> ·
      horário <b>08:00</b> (o calendário não tem horário) · dias anteriores a hoje como <b>Finalizado</b>, hoje e os próximos como
      <b>Em andamento</b> · volume quando houver "Qtd" · E-mail com valor <b>R$ 0,00</b>. Tudo pode ser editado depois em cada disparo.
    </p>
    ${(r.avisos || []).length ? `<p class="import-rules">Avisos: ${r.avisos.map(escapeHtml).join(" · ")}</p>` : ""}
    ${linhas ? `<div class="table-wrap"><table class="data-table import-table">
      <thead><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Status</th><th class="num">Volume</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
      ${r.novos > (r.amostra || []).length ? `<p class="import-file">… e mais ${fmtInt(r.novos - r.amostra.length)} ação(ões).</p>` : ""}` : ""}
    <div class="import-actions">
      <button type="button" class="btn btn-ghost" data-import="cancelar">Cancelar</button>
      <button type="button" class="btn btn-primary" data-import="confirmar" ${r.novos ? "" : "disabled"}>
        ${r.novos ? `Importar ${fmtInt(r.novos)} disparo(s)` : "Nada novo para importar"}
      </button>
    </div>`;
  box.hidden = false;
}

function limpar(){
  calendario = null; arquivo = "";
  $("importFile").value = "";
  $("importResult").hidden = true;
  $("importResult").innerHTML = "";
}

export function initImport(){
  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024){ toast("Arquivo grande demais (máx. 15 MB).", "warn"); limpar(); return; }
    try{
      calendario = JSON.parse(await file.text());
    }catch{
      toast("Esse arquivo não é um JSON válido.", "error"); limpar(); return;
    }
    arquivo = file.name;
    try{
      renderPrevia(await enviar(false));
    }catch(err){
      toast(err.message || "Não consegui ler o calendário.", "error", 4000); limpar();
    }
  });

  $("importResult").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-import]");
    if (!b) return;
    if (b.dataset.import === "cancelar"){ limpar(); return; }
    b.disabled = true; b.textContent = "Importando…";
    try{
      const r = await enviar(true);
      toast(`${fmtInt(r.criados)} disparo(s) importado(s) para o painel.`, "ok", 3500);
      limpar();
      fetchRecords().catch(() => {});
    }catch(err){
      toast(err.message || "Não consegui importar.", "error", 4000);
      b.disabled = false; b.textContent = "Tentar de novo";
    }
  });
}
