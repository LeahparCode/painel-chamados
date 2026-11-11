// Abertura/fechamento de modais genéricos.
const closers = new Map();

export function openModal(el, { onClose } = {}){
  if (!el) return;
  el.classList.add("is-open");
  el.setAttribute("aria-hidden", "false");
  if (onClose) closers.set(el, onClose);
  document.body.style.overflow = "hidden";
  setTimeout(() => el.querySelector("[autofocus], input, select, button")?.focus({ preventScroll: true }), 30);
}

export function closeModal(el){
  if (!el || !el.classList.contains("is-open")) return;
  el.classList.remove("is-open");
  el.setAttribute("aria-hidden", "true");
  const fn = closers.get(el);
  closers.delete(el);
  if (!document.querySelector(".modal.is-open")) document.body.style.overflow = "";
  fn && fn();
}

export function initModals(){
  document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", (e) => {
      if (e.target === m || e.target.closest("[data-close]")) closeModal(m);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll(".modal.is-open")];
    if (open.length) closeModal(open[open.length - 1]);
  });
}
