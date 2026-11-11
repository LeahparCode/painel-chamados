// Formatação de números, moeda, tempo e HTML seguro.

export function fmtInt(value){
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : "0";
}

export function fmtMoney(value){
  const n = Number(value || 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function fmtMoneyCompact(value){
  const n = Number(value || 0);
  if (Math.abs(n) >= 100000){
    return "R$ " + n.toLocaleString("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
  }
  return fmtMoney(n);
}

export function fmtTempo(totalMinutes){
  const mins = Math.max(0, Number(totalMinutes) || 0);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h && !m) return "0min";
  return [h ? `${h}h` : "", m ? `${m}min` : ""].filter(Boolean).join(" ");
}

export function fmtRemaining(ms){
  if (ms === null || ms === undefined) return "—";
  if (ms <= 0) return "Concluído";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h ? `${h}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}

export function escapeHtml(str){
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export const capitalize = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
