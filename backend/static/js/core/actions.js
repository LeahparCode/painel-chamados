// Ações de escrita com atualização otimista + rollback em caso de erro.
import { OFFLINE } from "./config.js";
import { findRecord, patchLocal, addLocal, removeLocal } from "./state.js";
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
