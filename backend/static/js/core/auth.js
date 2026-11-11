// Sessão do usuário no front-end (o controle de acesso de verdade fica no servidor).
import { state } from "./state.js";
import { setPrices } from "./config.js";

const HINT_KEY = "painel_logged";

export const isLogged = () => !!state.user;                       // tem sessão
export const canEdit = () => ["admin", "operador"].includes(state.user?.papel); // pode editar
export const isPending = () => state.user?.papel === "pendente";   // conta aguardando liberação
export const isAdmin = () => state.user?.papel === "admin";

async function call(method, path, body){
  const resp = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok){
    const err = new Error(data?.message || `HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

/** Descobre quem está logado (ou se é visitante). */
export async function fetchMe(){
  try{
    const data = await call("GET", "/api/auth/me");
    state.user = data.user || null;
    state.setupNeeded = !!data.setupNeeded;
    state.allowSignup = data.allowSignup !== false;
  }catch{
    state.user = null;
  }
  applyAuthMode();
  return state.user;
}

/** Aplica as classes de modo na página (visitante / logado / administrador). */
export function applyAuthMode(){
  const root = document.documentElement;
  root.classList.toggle("is-public", !canEdit());          // visitante ou conta pendente: só o painel
  root.classList.toggle("has-session", !!state.user);
  root.classList.toggle("is-pending", isPending());
  root.classList.toggle("is-admin", isAdmin());
  try{
    if (canEdit()) localStorage.setItem(HINT_KEY, "1");
    else localStorage.removeItem(HINT_KEY);
  }catch{}
}

/** Preços por tipo (só para quem está logado). */
export async function fetchConfig(){
  const data = await call("GET", "/api/config");
  setPrices(data.precos);
  return data;
}

export const login = (login, senha, lembrar) => call("POST", "/api/auth/login", { login, senha, lembrar });
export const logout = () => call("POST", "/api/auth/logout");
export const signup = (nome, login, senha) => call("POST", "/api/auth/signup", { nome, login, senha });
export const changePassword = (atual, nova) => call("POST", "/api/auth/password", { atual, nova });

export const usersApi = {
  list: () => call("GET", "/api/users"),
  create: (data) => call("POST", "/api/users", data),
  update: (id, data) => call("PATCH", `/api/users/${encodeURIComponent(id)}`, data),
  remove: (id) => call("DELETE", `/api/users/${encodeURIComponent(id)}`),
};

export function initials(nome = ""){
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
