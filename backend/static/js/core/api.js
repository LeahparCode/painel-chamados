// Comunicação com o backend: REST + SSE (com fallback para polling) + cache local.
import { API_BASE, OFFLINE, CACHE_KEY, CACHE_TTL_MS } from "./config.js";
import { state, setRecords, setConnection, setTemplates } from "./state.js";

const url = (p) => `${API_BASE.replace(/\/+$/, "")}${p}`;

function hashOf(records){
  try{ return JSON.stringify(records); }
  catch{ return String(Math.random()); }
}
let lastHash = "";

function applySnapshot(records, stale = false){
  const list = Array.isArray(records) ? records : [];
  const h = hashOf(list);
  if (h === lastHash && state.stale === stale) return;
  lastHash = h;
  setRecords(list, { stale });
  if (list.length) saveCache(list);
}

/* ---------- cache ---------- */
export function loadCache(){
  try{
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const { ts, data } = JSON.parse(raw);
    if (!Array.isArray(data) || Date.now() - ts > CACHE_TTL_MS) return false;
    applySnapshot(data);
    return true;
  }catch{ return false; }
}
function saveCache(records){
  const write = () => { try{ localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: records })); }catch{} };
  (window.requestIdleCallback || setTimeout)(write);
}

/* ---------- REST ---------- */
async function request(method, path, body){
  const resp = await fetch(url(path), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await resp.text().catch(() => "");
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{}
  if (!resp.ok){
    const err = new Error(data?.error?.message || data?.message || data?.error || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return { data, resp };
}

export async function fetchRecords(){
  const { data, resp } = await request("GET", "/api/disparos");
  applySnapshot(data, resp.headers.get("X-Data-Stale") === "1");
  return data;
}

export const createRecord = (payload) => request("POST", "/api/disparos", payload).then(r => r.data);
export const updateRecord = (id, patch) => request("PATCH", `/api/disparos/${encodeURIComponent(id)}`, patch).then(r => r.data);
export const deleteRecord = (id) => request("DELETE", `/api/disparos/${encodeURIComponent(id)}`).then(r => r.data);

/* ---------- templates próprios ---------- */
const TPL_CACHE_KEY = "painel_templates_v1";

export async function fetchTemplates(){
  if (OFFLINE) return state.templates;
  const { data } = await request("GET", "/api/templates");
  setTemplates(data || []);
  try{ localStorage.setItem(TPL_CACHE_KEY, JSON.stringify(data || [])); }catch{}
  return data;
}

export function loadTemplatesCache(){
  try{
    const raw = localStorage.getItem(TPL_CACHE_KEY);
    if (raw) setTemplates(JSON.parse(raw));
  }catch{}
}

export async function saveTemplate(id, payload){
  const { data } = id
    ? await request("PATCH", `/api/templates/${encodeURIComponent(id)}`, payload)
    : await request("POST", "/api/templates", payload);
  await fetchTemplates().catch(() => {});
  return data;
}

export async function removeTemplate(id){
  await request("DELETE", `/api/templates/${encodeURIComponent(id)}`);
  await fetchTemplates().catch(() => {});
}

export function refreshSoon(delay = 300){
  if (OFFLINE) return;
  setTimeout(() => fetchRecords().catch(() => {}), delay);
}

/* ---------- tempo real ---------- */
let sse = null;
let pollTimer = null;
let pollDelay = 5000;

function startPolling(){
  if (pollTimer) return;
  const tick = async () => {
    try{
      await fetchRecords();
      setConnection(state.stale ? "stale" : "online");
      pollDelay = 5000;
    }catch{
      setConnection("offline");
      pollDelay = Math.min(pollDelay * 2, 30000);
    }
    pollTimer = setTimeout(tick, pollDelay);
  };
  pollTimer = setTimeout(tick, pollDelay);
}
function stopPolling(){
  if (pollTimer){ clearTimeout(pollTimer); pollTimer = null; }
}

export function connect(){
  if (OFFLINE){ setConnection("offline"); return; }
  fetchRecords()
    .then(() => setConnection(state.stale ? "stale" : "online"))
    .catch(() => setConnection("offline"));

  try{
    sse = new EventSource(url("/api/stream"));
    sse.onopen = () => { stopPolling(); };
    sse.onmessage = (evt) => {
      try{
        const payload = JSON.parse(evt.data);
        if (payload.type === "snapshot"){
          applySnapshot(payload.records || [], !!payload.stale);
          setConnection(payload.stale ? "stale" : "online");
        }
      }catch{}
    };
    sse.addEventListener("ping", () => setConnection(state.stale ? "stale" : "online"));
    sse.onerror = () => { setConnection("connecting"); startPolling(); };
  }catch{
    startPolling();
  }
}
