// Estado central da aplicação + pub/sub simples.
import { todayISO } from "./dates.js";

export const state = {
  records: [],
  user: null,         // usuário logado (null = visitante, só visualiza o painel)
  setupNeeded: false, // nenhum usuário cadastrado ainda
  templates: [],      // templates próprios (aba "Templates" da planilha)
  stale: false,
  connection: "connecting", // connecting | online | stale | offline
  activeView: "painel",
  // Visão do painel. followToday=true faz a referência acompanhar a virada do dia.
  view: { mode: "dia", ref: todayISO(), from: "", to: "", followToday: true },
};

const listeners = new Set();

export function subscribe(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(reason){
  listeners.forEach(fn => {
    try{ fn(state, reason); }
    catch(err){ console.error("listener falhou", err); }
  });
}

/** IDs com exclusão agendada (aguardando o "Desfazer"): ficam fora da tela mesmo se o servidor ainda os enviar. */
export const pendingDeletes = new Set();

export function setRecords(records, { stale = false } = {}){
  state.records = (Array.isArray(records) ? records : []).filter(r => !pendingDeletes.has(`${r.id}`));
  state.stale = stale;
  emit("records");
}

export function setTemplates(list){
  state.templates = Array.isArray(list) ? list : [];
  emit("templates");
}

export function setView(patch){
  Object.assign(state.view, patch);
  emit("view");
}

export function setConnection(conn){
  if (state.connection === conn) return;
  state.connection = conn;
  emit("connection");
}

export const findRecord = (id) => state.records.find(r => `${r.id}` === `${id}`) || null;

/** Atualiza localmente (otimista) e notifica */
export function patchLocal(id, patch){
  const idx = state.records.findIndex(r => `${r.id}` === `${id}`);
  if (idx < 0) return null;
  state.records[idx] = { ...state.records[idx], ...patch };
  emit("records");
  return state.records[idx];
}

export function addLocal(record){
  state.records = [...state.records, record];
  emit("records");
}

export function removeLocal(id){
  state.records = state.records.filter(r => `${r.id}` !== `${id}`);
  emit("records");
}
