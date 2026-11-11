// Relógio da sidebar.
export function initClock(){
  const t = document.getElementById("clockTime");
  const d = document.getElementById("clockDate");
  const tick = () => {
    const now = new Date();
    if (t) t.textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (d) d.textContent = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  };
  tick();
  setInterval(tick, 1000);
}
