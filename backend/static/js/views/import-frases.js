// Importar frases (templates) de uma planilha Excel/CSV — colunas Tipo, Frase e Caracteres.
// A instância de destino é escolhida aqui: aparecem só as que a pessoa pode EDITAR
// (o servidor confere de novo a cada envio).
import { state } from "../core/state.js";
import { fetchTemplates } from "../core/api.js";
import { chipClass } from "../core/frases.js";
import { fmtInt, escapeHtml } from "../core/format.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
let arquivo = null; // File escolhido (reenviado ao confirmar)

const editaveis = () => (state.instancias || []).filter(i => i.podeEditar);

async function enviar(confirmar){
  const fd = new FormData();
  fd.append("arquivo", arquivo, arquivo.name);
  const resp = await fetch(`/api/import/frases${confirmar ? "?confirmar=1" : ""}`, {
    method: "POST", body: fd, credentials: "same-origin",
    headers: { "X-Instancia": $("ifInst").value },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.message || `HTTP ${resp.status}`);
  return data;
}

function renderPrevia(r){
  const box = $("ifResult");
  const tipos = Object.entries(r.porTipo || {}).map(([t, n]) => `<span class="chip ${chipClass(t)}">${escapeHtml(t)}: ${fmtInt(n)}</span>`).join("");
  const linhas = (r.amostra || []).map(a => `
    <tr><td class="num">${a.linha}</td><td><span class="chip ${chipClass(a.tipo)}">${escapeHtml(a.tipo)}</span></td>
    <td class="wrap">${escapeHtml(a.texto)}${a.limpa ? '<span class="if-clean" title="Acentos e caracteres especiais removidos (SMS)">limpa</span>' : ""}</td>
    <td class="num">${fmtInt([...a.texto].length)}</td></tr>`).join("");
  box.innerHTML = `
    <p class="import-file">Arquivo: <b>${escapeHtml(arquivo.name)}</b> · instância <b>${escapeHtml(r.instancia)}</b></p>
    <div class="import-kpis">
      <div class="kpi"><span>Linhas lidas</span><b>${fmtInt(r.total)}</b></div>
      <div class="kpi kpi-brand"><span>Novas</span><b>${fmtInt(r.novas)}</b></div>
      <div class="kpi"><span>Já existem</span><b>${fmtInt(r.repetidas)}</b><small>ou repetidas · ignoradas</small></div>
      <div class="kpi"><span>Com problema</span><b>${fmtInt(r.invalidas)}</b><small>não entram</small></div>
    </div>
    ${tipos ? `<div class="import-chips">Novas por tipo: ${tipos}</div>` : ""}
    ${r.smsLimpas ? `<p class="import-rules"><b>${fmtInt(r.smsLimpas)}</b> frase(s) de SMS terão acentos, cedilha, emojis e outros caracteres especiais removidos (mesma regra do cadastro de templates). A coluna Caracteres é recalculada.</p>` : ""}
    ${(r.avisos || []).length ? `<ul class="if-avisos">${r.avisos.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>` : ""}
    ${linhas ? `<div class="table-wrap"><table class="data-table import-table if-table">
      <thead><tr><th class="num">Linha</th><th>Tipo</th><th>Frase</th><th class="num">Caracteres</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>
      ${r.novas > (r.amostra || []).length ? `<p class="import-file">… e mais ${fmtInt(r.novas - r.amostra.length)} frase(s).</p>` : ""}` : ""}
    <div class="import-actions">
      <button type="button" class="btn btn-ghost" data-if="cancelar">Cancelar</button>
      <button type="button" class="btn btn-primary" data-if="confirmar" ${r.novas ? "" : "disabled"}>
        ${r.novas ? `Importar ${fmtInt(r.novas)} frase${r.novas === 1 ? "" : "s"}` : "Nada novo para importar"}
      </button>
    </div>`;
  box.hidden = false;
}

function limpar(){
  arquivo = null;
  $("ifFile").value = "";
  $("ifResult").hidden = true;
  $("ifResult").innerHTML = "";
}

async function previa(){
  if (!arquivo) return;
  try{
    renderPrevia(await enviar(false));
  }catch(err){
    toast(err.message || "Não consegui ler a planilha.", "error", 4500);
    limpar();
  }
}

async function baixarModelo(){
  try{
    const resp = await fetch("/api/import/frases/modelo", { credentials: "same-origin" });
    if (!resp.ok) throw new Error();
    const url = URL.createObjectURL(await resp.blob());
    const a = Object.assign(document.createElement("a"), { href: url, download: "modelo_importar_frases.xlsx" });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }catch{
    toast("Não consegui baixar o modelo.", "error");
  }
}

export function initImportFrases(){
  const lista = editaveis();
  if (!lista.length){ $("ifPanel").hidden = true; return; }
  lista.forEach(i => $("ifInst").append(new Option(i.nome, i.id)));
  if (state.inst?.podeEditar) $("ifInst").value = state.inst.id; // começa na instância aberta

  $("ifModelo").addEventListener("click", baixarModelo);
  $("ifInst").addEventListener("change", previa); // trocou a instância: refaz a prévia (repetidas mudam)
  $("ifFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!/\.(xlsx|csv)$/i.test(f.name)){ toast("Envie um arquivo .xlsx (Excel) ou .csv.", "warn"); limpar(); return; }
    if (f.size > 5 * 1024 * 1024){ toast("Arquivo grande demais (máx. 5 MB).", "warn"); limpar(); return; }
    arquivo = f;
    previa();
  });

  $("ifResult").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-if]");
    if (!b) return;
    if (b.dataset.if === "cancelar"){ limpar(); return; }
    b.disabled = true; b.textContent = "Importando…";
    try{
      const r = await enviar(true);
      toast(`${fmtInt(r.criados)} frase(s) importada(s) em ${r.instancia}.`, "ok", 3500);
      if ($("ifInst").value === state.inst?.id) fetchTemplates().catch(() => {}); // já aparecem em Frases
      limpar();
    }catch(err){
      toast(err.message || "Não consegui importar.", "error", 4500);
      b.disabled = false; b.textContent = "Tentar de novo";
    }
  });
}
