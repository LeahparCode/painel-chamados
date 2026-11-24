// Importação do calendário de ações (.json) → disparos do painel. Prévia antes de gravar.
import { fetchRecords } from "../core/api.js";
import { chipClass } from "../core/frases.js";
import { fmtInt, escapeHtml } from "../core/format.js";
import { toast } from "../ui/toast.js";
import { todayISO } from "../core/dates.js";
import { instHeaders } from "../core/instance.js";

const $ = (id) => document.getElementById(id);
let calendario = null;
let arquivo = "";

const fmtBR = (iso) => iso ? iso.split("-").reverse().join("/") : "—";

async function enviar(confirmar){
  // "hoje" do navegador de quem importa define o que é passado, hoje e futuro
  const params = new URLSearchParams({ hoje: todayISO() });
  if (confirmar) params.set("confirmar", "1");
  const resp = await fetch(`/api/import/calendario?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...instHeaders() },
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
  const STATUS_CLS = { "Finalizado": "ok", "Em andamento": "", "Programado": "sched", "Em andamento (10 min)": "" };
  const chipsStatus = (obj) => ["Finalizado", "Em andamento", "Em andamento (10 min)", "Programado"]
    .filter(k => obj?.[k]).map(k => `<span class="status-chip ${STATUS_CLS[k]}">${escapeHtml(k)}: ${fmtInt(obj[k])}</span>`).join(" ");
  const temAlgo = r.novos || r.atualizar;
  const linhas = (r.amostra || []).map(a => `
    <tr><td>${fmtBR(a.data)}</td><td><span class="chip ${chipClass(a.tipoDisparo)}">${escapeHtml(a.tipoDisparo)}</span></td>
    <td class="wrap">${escapeHtml(a.tipo)}</td><td>${escapeHtml(a.status)}</td><td class="num">${a.volume ? fmtInt(a.volume) : "—"}</td></tr>`).join("");
  box.innerHTML = `
    <p class="import-file">Arquivo: <b>${escapeHtml(arquivo)}</b> · ${fmtBR(r.de)} a ${fmtBR(r.ate)}</p>
    <div class="import-kpis">
      <div class="kpi"><span>Ações no arquivo</span><b>${fmtInt(r.total)}</b></div>
      <div class="kpi kpi-brand"><span>Novas</span><b>${fmtInt(r.novos)}</b></div>
      <div class="kpi"><span>Já importadas</span><b>${fmtInt(r.duplicados)}</b><small>serão ignoradas</small></div>
      <div class="kpi"><span>A corrigir</span><b>${fmtInt(r.atualizar)}</b><small>já importadas, status pela regra nova</small></div>
    </div>
    ${tipos ? `<div class="import-chips">Novas por tipo: ${tipos}</div>` : ""}
    ${r.novos ? `<div class="import-chips">Novas por status: ${chipsStatus(r.porStatus)}</div>` : ""}
    ${r.atualizar ? `<div class="import-chips">Já importadas que serão corrigidas: ${chipsStatus(r.atualizarPorStatus)}</div>` : ""}
    <p class="import-rules">
      <b>Como cada ação entra:</b> data e canal do calendário · nome = resumo do texto · texto completo em <b>Observações</b> ·
      horário <b>08:00</b> (o calendário não tem horário) · dias anteriores a hoje como <b>Finalizado</b> · hoje como
      <b>Em andamento</b> com <b>10 minutos</b> para finalizar · dias futuros como <b>Programado</b> · volume quando houver "Qtd" ·
      E-mail sem custo. Ações já importadas que ainda estão "Em andamento" são corrigidas pela mesma regra; o que foi mudado
      à mão não é alterado. Tudo pode ser editado depois em cada disparo.
    </p>
    ${(r.avisos || []).length ? `<p class="import-rules">Avisos: ${r.avisos.map(escapeHtml).join(" · ")}</p>` : ""}
    ${linhas ? `<div class="table-wrap"><table class="data-table import-table">
      <thead><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>Status</th><th class="num">Volume</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
      ${r.novos > (r.amostra || []).length ? `<p class="import-file">… e mais ${fmtInt(r.novos - r.amostra.length)} ação(ões).</p>` : ""}` : ""}
    <div class="import-actions">
      <button type="button" class="btn btn-ghost" data-import="cancelar">Cancelar</button>
      <button type="button" class="btn btn-primary" data-import="confirmar" ${temAlgo ? "" : "disabled"}>
        ${!temAlgo ? "Nada novo para importar"
          : [r.novos ? `Importar ${fmtInt(r.novos)}` : "", r.atualizar ? `corrigir ${fmtInt(r.atualizar)}` : ""].filter(Boolean).join(" e ")
            .replace(/^c/, "C") + " disparo(s)"}
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

/** Alterna entre as abas "Exportar" e "Importar" da tela Importar/Exportar. */
export function setIoTab(tab){
  const importar = tab === "importar";
  $("ioExport").hidden = importar;
  $("ioImport").hidden = !importar;
  $("expLabel").hidden = importar;
  $("importLabel").hidden = !importar;
  document.querySelectorAll("#ioTabs [data-io]").forEach(b => {
    const on = b.dataset.io === (importar ? "importar" : "exportar");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  try{ history.replaceState(null, "", importar ? "#importar" : "#exportar"); }catch{}
}

export function initImport(){
  $("ioTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-io]");
    if (b) setIoTab(b.dataset.io);
  });

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
      toast([r.criados ? `${fmtInt(r.criados)} disparo(s) importado(s)` : "", r.atualizados ? `${fmtInt(r.atualizados)} corrigido(s)` : ""]
        .filter(Boolean).join(" e ") + ".", "ok", 3500);
      limpar();
      fetchRecords().catch(() => {});
    }catch(err){
      toast(err.message || "Não consegui importar.", "error", 4000);
      b.disabled = false; b.textContent = "Tentar de novo";
    }
  });
}
