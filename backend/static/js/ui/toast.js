// Notificações rápidas.
const ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
};

const active = new Map();

export function toast(message, type = "ok", ms = 2600, key = null){
  const host = document.getElementById("toasts");
  if (!host) return;
  if (key && active.has(key)) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${ICONS[type] || ""}<span></span><button type="button" aria-label="Fechar">×</button>`;
  el.querySelector("span").textContent = message;

  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    if (key) active.delete(key);
  };
  el.querySelector("button").addEventListener("click", remove);
  host.appendChild(el);
  if (key) active.set(key, el);
  setTimeout(remove, ms);
}
