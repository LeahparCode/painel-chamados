// Tema claro/escuro com preferência salva.
import { THEME_KEY } from "../core/config.js";

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const listeners = new Set();
export const onThemeChange = (fn) => listeners.add(fn);
export const isDark = () => document.documentElement.classList.contains("dark");

function apply(theme){
  document.documentElement.classList.toggle("dark", theme === "dark");
  const btn = document.getElementById("themeToggle");
  if (btn) btn.innerHTML = theme === "dark" ? SUN : MOON;
  listeners.forEach(fn => fn(theme));
}

export function initTheme(){
  apply(isDark() ? "dark" : "light");
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    try{ localStorage.setItem(THEME_KEY, next); }catch{}
    apply(next);
  });
}
