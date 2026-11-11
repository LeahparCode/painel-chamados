// Configurações e listas fixas do painel.

export const STATUS = ["Em andamento", "Finalizado", "Insucesso"];

export const HORARIOS = ["08:00", "12:00", "16:00", "20:00"];

export const TAGS = ["Vendas", "Conciliação", "SAC", "Recup de Crédito"];

// Custo unitário por tipo de disparo (R$ por mensagem)
export const COST_PER_TIPO = {
  "Marketing": 0.62,
  "Marketing Lite": 0.54,
  "Utilidade": 0.09,
  "Autenticação": 0.09,
};
export const TIPOS = Object.keys(COST_PER_TIPO);

// API
export const API_BASE = "";
const params = new URLSearchParams(location.search);
export const OFFLINE = location.protocol === "file:" || params.get("offline") === "1";

export const CACHE_KEY = "painel_snapshot_v3";
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
export const THEME_KEY = "painel_theme";
