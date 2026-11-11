// Login, menu da conta (alterar senha / sair).
import { state } from "../core/state.js";
import { login, logout, signup, changePassword, initials } from "../core/auth.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);

function showError(el, msg){
  el.textContent = msg || "";
  el.hidden = !msg;
}

const ROLE_LABEL = { admin: "Administrador", operador: "Operador", pendente: "Aguardando liberação" };

/** Alterna entre as abas "Entrar" e "Criar conta" do modal. */
function setTab(tab){
  if (tab === "signup" && !state.allowSignup) tab = "login";
  const signupTab = tab === "signup";
  $("loginForm").hidden = signupTab;
  $("signupForm").hidden = !signupTab;
  document.querySelectorAll("#authTabs [data-auth-tab]").forEach(b => b.classList.toggle("is-active", b.dataset.authTab === tab));
  $("lTitle").textContent = signupTab ? "Criar conta" : "Entrar no painel";
  $("lSub").textContent = signupTab ? "Escolha o seu usuário e a sua senha." : "Use o seu usuário e senha.";
  setTimeout(() => (signupTab ? $("sNome") : $("lLogin")).focus(), 40);
}

export function openLogin(tab = "login"){
  showError($("lError"), state.setupNeeded && !state.allowSignup
    ? "Nenhum usuário cadastrado ainda. Configure ADMIN_LOGIN e ADMIN_PASSWORD no servidor para criar o primeiro acesso."
    : "");
  showError($("sError"), "");
  openModal($("loginModal"));
  setTab(tab);
}

const reloadToPanel = () => setTimeout(() => { history.replaceState(null, "", location.pathname + "#painel"); location.reload(); }, 500);

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
  $("userRole").textContent = ROLE_LABEL[u.papel] || u.papel;
  $("userChip").title = u.login;
}

export function initAccount(){
  initPasswordToggles();

  // ---- login / criar conta ----
  document.documentElement.classList.toggle("no-signup", !state.allowSignup);
  document.querySelectorAll('[data-action="login"]').forEach(b => b.addEventListener("click", () => openLogin()));
  document.querySelectorAll("#loginModal [data-auth-tab]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.authTab)));

  $("signupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nome = $("sNome").value.trim();
    const user = $("sLogin").value.trim().toLowerCase();
    const senha = $("sSenha").value, conf = $("sConfirma").value;
    if (!nome){ showError($("sError"), "Informe o seu nome."); $("sNome").focus(); return; }
    if (!/^[a-z0-9._@+\-]{3,120}$/.test(user)){
      showError($("sError"), "Usuário inválido: use 3 ou mais letras, números, ponto, hífen ou e-mail, sem espaços.");
      $("sLogin").focus(); return;
    }
    if (senha.length < 8){ showError($("sError"), "A senha precisa ter pelo menos 8 caracteres."); $("sSenha").focus(); return; }
    if (senha !== conf){ showError($("sError"), "A confirmação não confere com a senha."); $("sConfirma").focus(); return; }
    const btn = $("sSubmit");
    btn.disabled = true; btn.textContent = "Criando conta…";
    try{
      const { user: u } = await signup(nome, user, senha);
      toast(u.papel === "pendente"
        ? "Conta criada! Aguarde um administrador liberar o seu acesso."
        : `Conta criada! Bem-vindo(a), ${u.nome}.`, "ok", 3000);
      reloadToPanel();
    }catch(err){
      showError($("sError"), err.message || "Não foi possível criar a conta.");
      btn.disabled = false; btn.textContent = "Criar conta";
    }
  });
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
      reloadToPanel();
    }catch(err){
      showError($("lError"), err.message || "Não foi possível entrar.");
      $("lSenha").select();
      btn.disabled = false; btn.textContent = "Entrar";
    }
  });
  if (!state.user && location.hash === "#login") openLogin();
  if (!state.user && location.hash === "#criar-conta") openLogin("signup");

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
