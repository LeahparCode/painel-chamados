// Tela "Usuários" (somente administradores): criar, editar, desativar e excluir logins.
import { state } from "../core/state.js";
import { usersApi, initials } from "../core/auth.js";
import { escapeHtml } from "../core/format.js";
import { openModal, closeModal } from "../ui/modal.js";
import { toast } from "../ui/toast.js";

const $ = (id) => document.getElementById(id);
let users = [];
let editing = null;

const fmtDate = (iso) => {
  const ts = Date.parse(iso || "");
  return Number.isNaN(ts) ? "—" : new Date(ts).toLocaleDateString("pt-BR");
};

function render(){
  const me = state.user?.id;
  $("usersCount").textContent = `${users.length} usuário(s) · ${users.filter(u => u.papel === "admin").length} administrador(es)`;
  $("usersTable").innerHTML = `
    <thead><tr><th>Pessoa</th><th>Papel</th><th>Criado em</th><th>Situação</th><th></th></tr></thead>
    <tbody>${users.map(u => `
      <tr>
        <td><div class="u-person"><span class="user-avatar">${escapeHtml(initials(u.nome || u.login))}</span>
          <span><b>${escapeHtml(u.nome || "—")}${u.id === me ? '<span class="you-chip">você</span>' : ""}</b><small>${escapeHtml(u.login)}</small></span></div></td>
        <td><span class="role-chip ${u.papel}">${u.papel === "admin" ? "Administrador" : "Operador"}</span></td>
        <td>${fmtDate(u.criadoEm)}</td>
        <td><span class="state-chip ${u.ativo ? "" : "off"}">${u.ativo ? "Ativo" : "Desativado"}</span></td>
        <td class="u-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit="${escapeHtml(u.id)}">Editar</button></td>
      </tr>`).join("") || `<tr><td class="empty" colspan="5">Nenhum usuário.</td></tr>`}
    </tbody>`;
}

async function load(){
  try{
    users = await usersApi.list();
    render();
  }catch(err){
    toast(err.message || "Não consegui carregar os usuários.", "error");
  }
}

function showError(msg){
  $("uError").textContent = msg || "";
  $("uError").hidden = !msg;
}

function openEditor(user = null){
  editing = user;
  const isMe = user && user.id === state.user?.id;
  $("uTitle").textContent = user ? "Editar usuário" : "Novo usuário";
  $("uSub").textContent = user ? `Login: ${user.login}` : "A pessoa entra com este login e a senha definida aqui.";
  $("uNome").value = user?.nome || "";
  $("uLogin").value = user?.login || "";
  $("uPapel").value = user?.papel || "operador";
  $("uPapel").disabled = !!isMe;
  $("uSenha").value = "";
  $("uSenha").type = "password";
  $("uSenhaLabel").textContent = user ? "Nova senha (opcional)" : "Senha";
  $("uSenha").placeholder = user ? "deixe em branco para manter" : "mín. 8 caracteres";
  $("uAtivoRow").hidden = !user || isMe;
  $("uAtivo").checked = user ? !!user.ativo : true;
  $("uDelete").hidden = !user || isMe;
  $("uSave").textContent = user ? "Salvar" : "Criar usuário";
  showError("");
  openModal($("userModal"));
  setTimeout(() => $("uNome").focus(), 40);
}

export function setUsersVisible(v){
  if (v) load();
}

export function initUsers(){
  $("btnNewUser").addEventListener("click", () => openEditor());
  $("usersTable").addEventListener("click", (e) => {
    const b = e.target.closest("[data-edit]");
    if (b) openEditor(users.find(u => u.id === b.dataset.edit));
  });

  $("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {
      nome: $("uNome").value.trim(),
      login: $("uLogin").value.trim().toLowerCase(),
      papel: $("uPapel").value,
    };
    const senha = $("uSenha").value;
    if (!data.nome){ showError("Informe o nome."); return; }
    if (!data.login){ showError("Informe o login (e-mail ou usuário)."); return; }
    if (!editing && senha.length < 8){ showError("A senha precisa ter pelo menos 8 caracteres."); return; }
    if (editing && senha && senha.length < 8){ showError("A nova senha precisa ter pelo menos 8 caracteres."); return; }
    if (senha) data.senha = senha;
    if (editing && !$("uAtivoRow").hidden) data.ativo = $("uAtivo").checked;
    if (editing && editing.id === state.user?.id) delete data.papel;

    const btn = $("uSave"); btn.disabled = true;
    try{
      if (editing) await usersApi.update(editing.id, data);
      else await usersApi.create(data);
      closeModal($("userModal"));
      toast(editing ? "Usuário atualizado." : `Usuário criado. Envie o login e a senha para ${data.nome}.`, "ok", 3500);
      load();
    }catch(err){
      showError(err.message || "Não consegui salvar.");
    }finally{
      btn.disabled = false;
    }
  });

  $("uDelete").addEventListener("click", async () => {
    if (!editing) return;
    if (!confirm(`Excluir o usuário "${editing.nome || editing.login}"? Ele não poderá mais entrar.`)) return;
    try{
      await usersApi.remove(editing.id);
      closeModal($("userModal"));
      toast("Usuário excluído.", "ok");
      load();
    }catch(err){
      showError(err.message || "Não consegui excluir.");
    }
  });
}
