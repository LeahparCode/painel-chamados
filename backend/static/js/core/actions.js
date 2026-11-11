// Ações de escrita com atualização otimista + rollback em caso de erro.
import { OFFLINE } from "./config.js";
import { findRecord, patchLocal, addLocal, removeLocal, pendingDeletes } from "./state.js";
import { API_BASE } from "./config.js";
import { createRecord, updateRecord, deleteRecord, refreshSoon } from "./api.js";
import { toast } from "../ui/toast.js";

const isTemp = (id) => !id || String(id).startsWith("tmp_");
export const tempId = () => "tmp_" + Math.random().toString(36).slice(2);

/** Altera campos de um disparo. Retorna true se salvou. */
export async function saveRecord(id, patch, { success = "Disparo atualizado.", quiet = false } = {}){
  const before = findRecord(id);
  if (!before) return false;
  const previous = Object.fromEntries(Object.keys(patch).map(k => [k, before[k]]));
  patchLocal(id, patch);

  if (OFFLINE || isTemp(id)){
    if (!quiet) toast("Alteração aplicada localmente (offline).", "warn", 2400, "offline-save");
    return true;
  }
  try{
    await updateRecord(id, patch);
    if (!quiet && success) toast(success, "ok", 1800);
    refreshSoon();
    return true;
  }catch(err){
    console.error("Falha ao atualizar disparo", err);
    patchLocal(id, previous);
    toast("Não consegui salvar a alteração.", "error", 3000, "save-error");
    return false;
  }
}

export const setStatus = (id, status, opts) => saveRecord(id, { status }, { success: `Status: ${status}`, ...opts });

export const moveToDay = (id, data) => saveRecord(id, { data }, { success: "Disparo remarcado." });

export async function addRecord(payload){
  const optimistic = { id: tempId(), status: "Em andamento", atualizadoEm: new Date().toISOString(), ...payload };
  addLocal(optimistic);
  if (OFFLINE){
    toast("Disparo adicionado localmente (offline).", "warn");
    return true;
  }
  try{
    await createRecord(payload);
    toast("Disparo adicionado!", "ok");
    refreshSoon(200);
    return true;
  }catch(err){
    console.error("Falha ao criar disparo", err);
    removeLocal(optimistic.id);
    toast(err?.message && !/^HTTP/.test(err.message) ? err.message : "Não consegui salvar no servidor.", "error", 3800);
    return false;
  }
}

export async function removeRecord(id){
  const rec = findRecord(id);
  if (!rec) return false;
  removeLocal(id);
  if (OFFLINE || isTemp(id)){
    toast("Disparo removido.", "ok", 1800);
    return true;
  }
  try{
    await deleteRecord(id);
    toast("Disparo excluído.", "ok", 1800);
    refreshSoon();
    return true;
  }catch(err){
    console.error("Falha ao excluir", err);
    addLocal(rec);
    toast("Não consegui excluir o disparo.", "error", 3000);
    return false;
  }
}

/**
 * Exclusão com "Desfazer": o disparo some na hora e só é apagado no servidor depois de alguns
 * segundos. Se a pessoa clicar em "Desfazer" nesse intervalo, ele volta como estava.
 */
const scheduled = new Map(); // id -> { timer, rec }

async function commitDelete(id){
  const item = scheduled.get(id);
  if (!item) return;
  scheduled.delete(id);
  if (OFFLINE || isTemp(id)){ pendingDeletes.delete(id); return; }
  try{
    await deleteRecord(id);
    refreshSoon();
  }catch(err){
    console.error("Falha ao excluir", err);
    addLocal(item.rec);
    toast("Não consegui excluir o disparo.", "error", 3000);
  }finally{
    pendingDeletes.delete(id);
  }
}

export function deleteWithUndo(id, { label = "Disparo excluído.", delay = 6000 } = {}){
  const rec = findRecord(id);
  if (!rec || scheduled.has(id)) return;
  pendingDeletes.add(`${id}`);
  removeLocal(id);
  const timer = setTimeout(() => commitDelete(id), delay);
  scheduled.set(id, { timer, rec });
  toast(label, "ok", delay, null, {
    label: "Desfazer",
    onClick: () => {
      const item = scheduled.get(id);
      if (!item) return;
      clearTimeout(item.timer);
      scheduled.delete(id);
      pendingDeletes.delete(`${id}`);
      addLocal(item.rec);
      toast("Exclusão desfeita.", "ok", 1800);
    },
  });
}

// se a página for fechada durante o "Desfazer", conclui as exclusões pendentes
window.addEventListener("pagehide", () => {
  scheduled.forEach((item, id) => {
    clearTimeout(item.timer);
    if (OFFLINE || isTemp(id)) return;
    try{ fetch(`${API_BASE}/api/disparos/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }); }catch{}
  });
  scheduled.clear();
});
