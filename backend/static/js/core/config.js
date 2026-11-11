// Configurações e listas fixas do painel.

export const STATUS = ["Em andamento", "Finalizado", "Insucesso"];

export const HORARIOS = ["08:00", "12:00", "16:00", "20:00"];

// Tipo do disparo → valor de cada envio (R$ por mensagem).
// Para mudar preços ou incluir um tipo novo, altere aqui e em VALID_TIPO_DISPARO (backend/app.py).
export const COST_PER_TIPO = {
  "SMS": 0.07,
  "RCS": 0.07,
  "WhatsApp": 0.12,
};
export const TIPOS = Object.keys(COST_PER_TIPO);

// API
export const API_BASE = "";
const params = new URLSearchParams(location.search);
export const OFFLINE = location.protocol === "file:" || params.get("offline") === "1";

export const CACHE_KEY = "painel_snapshot_v3";
export const CACHE_TTL_MS = 1000 * 60 * 60 * 6; // 6h
export const THEME_KEY = "painel_theme";
