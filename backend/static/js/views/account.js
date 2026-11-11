// Login, menu da conta (alterar senha / sair).
import { state } from "../core/state.js";
import { login, logout, changePassword, initials } from "../core/auth.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);

function showError(el, msg){
  el.textContent = msg || "";
  el.hidden = !msg;
}

export function openLogin(){
  showError($("lError"), state.setupNeeded
    ? "Nenhum usuário cadastrado ainda. Configure ADMIN_LOGIN e ADMIN_PASSWORD no servidor para criar o primeiro acesso."
    : "");
  openModal($("loginModal"));
  setTimeout(() => $("lLogin").focus(), 40);
}

function initPasswordToggles(){
  document.querySelectorAll("[data-pw-toggle]").forEach(btn => btn.addEventListener("click", () => {
    const input = $(btn.dataset.pwToggle);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.classList.toggle("is-on", show);
    btn.setAttribute("aria-label", show ? "Esconder senha" : "Mostrar senha");
    input.focus();
  }));
}

function renderUserChip(){
  const u = state.user;
  if (!u) return;
  $("userAvatar").textContent = initials(u.nome || u.login);
  $("userName").textContent = u.nome || u.login;
  $("userRole").textContent = u.papel === "admin" ? "Administrador" : "Operador";
  $("userChip").title = u.login;
}

export function initAccount(){
  initPasswordToggles();

  // ---- login ----
  document.querySelectorAll('[data-action="login"]').forEach(b => b.addEventListener("click", openLogin));
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("lLogin").value.trim();
    const senha = $("lSenha").value;
    if (!user || !senha){ showError($("lError"), "Informe o login e a senha."); return; }
    const btn = $("lSubmit");
    btn.disabled = true; btn.textContent = "Entrando…";
    try{
      const { user: u } = await login(user, senha, $("lLembrar").checked);
      try{ localStorage.setItem("painel_logged", "1"); }catch{}
      toast(`Bem-vindo(a), ${u.nome || u.login}!`, "ok", 1500);
      // recarrega de verdade (trocar só o "#" do endereço não recarregaria a página)
      setTimeout(() => { history.replaceState(null, "", location.pathname + "#painel"); location.reload(); }, 400);
    }catch(err){
      showError($("lError"), err.message || "Não foi possível entrar.");
      $("lSenha").select();
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });
  if (!state.user && location.hash === "#login") openLogin();

  if (!state.user) return;

  // ---- conta logada ----
  renderUserChip();
  const chip = $("userChip"), menu = $("userMenu");
  const toggleMenu = (open) => { menu.hidden = !open; chip.setAttribute("aria-expanded", open ? "true" : "false"); };
  chip.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(menu.hidden); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !e.target.closest("#userBox")) toggleMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) toggleMenu(false); });

  $("btnLogout").addEventListener("click", async () => {
    toggleMenu(false);
    try{ await logout(); }catch{}
    try{ localStorage.removeItem("painel_logged"); }catch{}
    history.replaceState(null, "", location.pathname + "#painel");
    location.reload();
  });

  $("btnChangePassword").addEventListener("click", () => {
    toggleMenu(false);
    $("passwordForm").reset();
    showError($("pError"), "");
    openModal($("passwordModal"));
    setTimeout(() => $("pAtual").focus(), 40);
  });
  $("passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const atual = $("pAtual").value, nova = $("pNova").value, conf = $("pConfirma").value;
    if (!atual || !nova){ showError($("pError"), "Preencha a senha atual e a nova."); return; }
    if (nova.length < 8){ showError($("pError"), "A nova senha precisa ter pelo menos 8 caracteres."); return; }
    if (nova !== conf){ showError($("pError"), "A confirmação não confere com a nova senha."); return; }
    const btn = $("pSubmit"); btn.disabled = true;
    try{
      await changePassword(atual, nova);
      closeModal($("passwordModal"));
      toast("Senha alterada com sucesso.", "ok");
    }catch(err){
      showError($("pError"), err.message || "Não consegui alterar a senha.");
    }finally{
      btn.disabled = false;
    }
  });
}
