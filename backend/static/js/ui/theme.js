// Tema claro/escuro + paletas de cores, com preferência salva no navegador.
import { THEME_KEY } from "../core/config.js";

const PALETTE_KEY = "painel_palette";
export const PALETTES = ["violeta", "vermelho", "azul-dourado", "azul"];

const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

const listeners = new Set();
/** Avisa quando o tema (claro/escuro) ou a paleta mudarem — usado pelos gráficos. */
export const onThemeChange = (fn) => listeners.add(fn);
export const isDark = () => document.documentElement.classList.contains("dark");
const notify = () => listeners.forEach(fn => fn());

const save = (key, value) => { try{ localStorage.setItem(key, value); }catch{} };

/** Liga transições de cor só durante a troca (evita animar tudo o tempo todo). */
function smoothSwitch(change){
  const root = document.documentElement;
  root.classList.add("palette-switching");
  change();
  clearTimeout(smoothSwitch.t);
  smoothSwitch.t = setTimeout(() => root.classList.remove("palette-switching"), 450);
}

/* ---------- claro / escuro ---------- */
function applyMode(mode){
  document.documentElement.classList.toggle("dark", mode === "dark");
  const btn = document.getElementById("themeToggle");
  if (btn) btn.innerHTML = mode === "dark" ? SUN : MOON;
}

/* ---------- paletas ---------- */
export const currentPalette = () => document.documentElement.getAttribute("data-palette") || "violeta";

function applyPalette(name){
  const palette = PALETTES.includes(name) ? name : "violeta";
  if (palette === "violeta") document.documentElement.removeAttribute("data-palette");
  else document.documentElement.setAttribute("data-palette", palette);
  document.querySelectorAll("#palettePop [data-palette]").forEach(b =>
    b.setAttribute("aria-checked", b.dataset.palette === palette ? "true" : "false"));
}

function initPalettePicker(){
  const btn = document.getElementById("paletteBtn");
  const pop = document.getElementById("palettePop");
  if (!btn || !pop) return;

  const open = (state) => {
    pop.hidden = !state;
    btn.setAttribute("aria-expanded", state ? "true" : "false");
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); open(pop.hidden); });
  pop.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-palette]");
    if (!opt) return;
    smoothSwitch(() => applyPalette(opt.dataset.palette));
    save(PALETTE_KEY, opt.dataset.palette);
    notify();
    open(false);
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest(".palette-wrap")) open(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden){ open(false); btn.focus(); } });
}

export function initTheme(){
  applyMode(isDark() ? "dark" : "light");
  applyPalette(currentPalette());
  initPalettePicker();
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    save(THEME_KEY, next);
    smoothSwitch(() => applyMode(next));
    notify();
  });
}
