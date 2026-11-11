// Configurações e listas fixas do painel.

export const STATUS = ["Em andamento", "Finalizado", "Insucesso"];

export const HORARIOS = ["08:00", "12:00", "16:00", "20:00"];

// Tipos de disparo aceitos.
export const TIPOS = ["SMS", "RCS", "WhatsApp"];

// Valor de cada envio por tipo (R$ por mensagem). Os preços NÃO ficam no código da página:
// vêm do servidor (GET /api/config) e só para quem está logado. Para visitantes fica vazio,
// então nenhum valor em R$ aparece nem pode ser calculado. Preços: backend/app.py (PRECO_POR_TIPO).
export const COST_PER_TIPO = {};
export function setPrices(precos){
  Object.keys(COST_PER_TIPO).forEach(k => delete COST_PER_TIPO[k]);
  Object.assign(COST_PER_TIPO, precos || {});
}

// API
export const API_BASE = "";
const params = new URLSearchParams(location.search);
export const OFFLINE = location.protocol === "file:" || params.get("offline") === "1";

export const CACHE_KEY = "painel_snapshot_v3";
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
export const THEME_KEY = "painel_theme";
