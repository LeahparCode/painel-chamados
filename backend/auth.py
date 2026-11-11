"""Login do painel: sessão por cookie, usuários e permissões.

- Visitantes (sem login) só leem o painel (GET /api/disparos e /api/stream).
- Usuários logados podem criar, editar e excluir disparos, templates e exportar.
- Administradores também gerenciam os usuários (tela "Usuários").

Primeiro acesso: defina ADMIN_LOGIN e ADMIN_PASSWORD (e opcionalmente ADMIN_NOME) nas
variáveis de ambiente. Se esse login ainda não existir, ele é criado como administrador.
A senha nunca é guardada em texto: só o hash (werkzeug/scrypt).
"""
import os
import re
import time
import hashlib
import secrets
import logging
import threading
from functools import wraps
from datetime import timedelta
from urllib.parse import urlparse

from flask import Blueprint, jsonify, request, session, g
from werkzeug.security import generate_password_hash, check_password_hash

from storage import StoreError
from storage.base import now_iso, USER_ROLES

log = logging.getLogger("auth")
bp = Blueprint("auth", __name__)

MIN_PASSWORD, MAX_PASSWORD = 8, 200
LOGIN_RE = re.compile(r"^[a-z0-9._@+\-]{3,120}$")
USERS_TTL = 30.0
MAX_FAILS, FAIL_WINDOW = 8, 600  # 8 tentativas erradas a cada 10 min (por IP + login)

_get_store = None
_cache = {"users": None, "ts": 0.0}
_cache_lock = threading.Lock()
_bootstrap_done = False
_fails = {}
_fails_lock = threading.Lock()
_DUMMY_HASH = generate_password_hash(secrets.token_hex(16))


# ---------------------------------------------------------------- setup
def init_auth(app, get_store):
    global _get_store
    _get_store = get_store
    secret = os.getenv("APP_SECRET") or os.getenv("SECRET_KEY")
    if not secret:
        log.warning("APP_SECRET não definido: usando uma chave temporária (logins caem a cada reinício).")
        secret = secrets.token_hex(32)
    app.config.update(
        SECRET_KEY=secret,
        SESSION_COOKIE_NAME="painel_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("COOKIE_SECURE", "1") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(days=int(os.getenv("SESSION_DAYS", "14"))),
    )
    app.before_request(_check_origin)
    app.register_blueprint(bp)


def _check_origin():
    """Bloqueia escrita vinda de outro site (defesa extra além do cookie SameSite)."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.path.startswith("/api/"):
        origin = request.headers.get("Origin")
        if origin and urlparse(origin).netloc != request.host:
            return jsonify({"error": "forbidden_origin"}), 403
    return None


# ---------------------------------------------------------------- usuários
def _invalidate():
    with _cache_lock:
        _cache["users"] = None


def _bootstrap(users):
    """Cria o administrador inicial a partir de ADMIN_LOGIN / ADMIN_PASSWORD, se ainda não existir."""
    global _bootstrap_done
    if _bootstrap_done:
        return False
    _bootstrap_done = True
    login = (os.getenv("ADMIN_LOGIN") or "").strip().lower()
    senha = os.getenv("ADMIN_PASSWORD") or ""
    if not login or not senha:
        return False
    if any(u["login"] == login for u in users):
        return False
    if not LOGIN_RE.match(login) or len(senha) < MIN_PASSWORD:
        log.error("ADMIN_LOGIN/ADMIN_PASSWORD inválidos (login de 3+ caracteres e senha de %d+).", MIN_PASSWORD)
        return False
    _get_store().create_user({
        "nome": (os.getenv("ADMIN_NOME") or login.split("@")[0]).strip()[:80],
        "login": login,
        "senhaHash": generate_password_hash(senha),
        "papel": "admin",
        "ativo": True,
        "criadoEm": now_iso(),
    })
    log.info("Administrador inicial criado: %s", login)
    return True


def list_users(force=False):
    with _cache_lock:
        cached, ts = _cache["users"], _cache["ts"]
    if not force and cached is not None and time.time() - ts < USERS_TTL:
        return cached
    try:
        users = _get_store().list_users()
        if _bootstrap(users):
            users = _get_store().list_users()
    except Exception as e:
        if cached is not None:  # planilha fora do ar: usa a última lista conhecida
            log.warning("Falha ao ler usuários (usando cache): %s", e)
            return cached
        raise
    with _cache_lock:
        _cache.update(users=users, ts=time.time())
    return users


def public_user(u):
    return {k: u.get(k) for k in ("id", "nome", "login", "papel", "ativo", "criadoEm")}


def _fingerprint(u):
    """Muda quando a senha muda: derruba as outras sessões daquele usuário."""
    return hashlib.sha256((u.get("senhaHash") or "").encode()).hexdigest()[:16]


def current_user():
    if "user" in g:
        return g.user
    user = None
    uid = session.get("uid")
    if uid:
        try:
            user = next((u for u in list_users() if u["id"] == uid), None)
        except Exception:
            user = None
        if user and (not user["ativo"] or session.get("fp") != _fingerprint(user)):
            user = None
        if not user:
            session.clear()
    g.user = user
    return user


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return jsonify({"error": "unauthorized", "message": "Faça login para continuar."}), 401
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = current_user()
        if not user:
            return jsonify({"error": "unauthorized", "message": "Faça login para continuar."}), 401
        if user["papel"] != "admin":
            return jsonify({"error": "forbidden", "message": "Apenas administradores."}), 403
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------- validação
def _err(message, status=400, code="invalid"):
    return jsonify({"error": code, "message": message}), status


def _valid_password(senha):
    return isinstance(senha, str) and MIN_PASSWORD <= len(senha) <= MAX_PASSWORD


def _store_error(e):
    log.error("Erro no armazenamento de usuários: %s", e)
    return _err(str(e), getattr(e, "status", 502), "storage_error")


def _too_many(key):
    now = time.time()
    with _fails_lock:
        recent = [t for t in _fails.get(key, []) if now - t < FAIL_WINDOW]
        _fails[key] = recent
        return len(recent) >= MAX_FAILS


def _register_fail(key):
    with _fails_lock:
        _fails.setdefault(key, []).append(time.time())


def _active_admins(users, exclude_id=None):
    return [u for u in users if u["papel"] == "admin" and u["ativo"] and u["id"] != exclude_id]


# ---------------------------------------------------------------- rotas: sessão
@bp.get("/api/auth/me")
def me():
    user = current_user()
    setup_needed = False
    if not user:
        try:
            setup_needed = not list_users()
        except Exception:
            setup_needed = False
    return jsonify({"user": public_user(user) if user else None, "setupNeeded": setup_needed})


@bp.post("/api/auth/login")
def login():
    b = request.get_json(silent=True) or {}
    login_ = str(b.get("login") or "").strip().lower()
    senha = str(b.get("senha") or "")
    key = f"{request.remote_addr}|{login_}"
    if _too_many(key):
        return _err("Muitas tentativas. Aguarde alguns minutos e tente de novo.", 429, "too_many_attempts")
    try:
        users = list_users(force=True)
    except Exception as e:
        return _store_error(e)
    user = next((u for u in users if u["login"] == login_ and u["ativo"]), None)
    ok = check_password_hash(user["senhaHash"] if user else _DUMMY_HASH, senha) if senha else False
    if not user or not ok:
        _register_fail(key)
        return _err("Usuário ou senha inválidos.", 401, "invalid_credentials")
    session.clear()
    session["uid"] = user["id"]
    session["fp"] = _fingerprint(user)
    session.permanent = bool(b.get("lembrar", True))
    log.info("Login: %s", user["login"])
    return jsonify({"user": public_user(user)})


@bp.post("/api/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.post("/api/auth/password")
@login_required
def change_password():
    b = request.get_json(silent=True) or {}
    user = current_user()
    if not check_password_hash(user["senhaHash"], str(b.get("atual") or "")):
        return _err("Senha atual incorreta.", 400, "wrong_password")
    nova = b.get("nova")
    if not _valid_password(nova):
        return _err(f"A nova senha precisa ter pelo menos {MIN_PASSWORD} caracteres.")
    new_hash = generate_password_hash(nova)
    try:
        _get_store().update_user(user["id"], {"senhaHash": new_hash})
    except StoreError as e:
        return _store_error(e)
    _invalidate()
    session["fp"] = _fingerprint({"senhaHash": new_hash})
    return jsonify({"ok": True})


# ---------------------------------------------------------------- rotas: usuários (admin)
@bp.get("/api/users")
@admin_required
def users_list():
    try:
        users = list_users(force=True)
    except Exception as e:
        return _store_error(e)
    return jsonify(sorted((public_user(u) for u in users), key=lambda u: (u["nome"] or u["login"]).lower()))


def _parse_user(b, partial, users, editing_id=None):
    out = {}
    if "nome" in b or not partial:
        nome = " ".join(str(b.get("nome") or "").split())
        if not nome or len(nome) > 80:
            return None, _err("Informe o nome (até 80 caracteres).")
        out["nome"] = nome
    if "login" in b or not partial:
        login_ = str(b.get("login") or "").strip().lower()
        if not LOGIN_RE.match(login_):
            return None, _err("Login inválido: use e-mail ou usuário (3+ caracteres, sem espaços).")
        if any(u["login"] == login_ and u["id"] != editing_id for u in users):
            return None, _err("Já existe um usuário com esse login.", 409, "login_taken")
        out["login"] = login_
    if "papel" in b or not partial:
        papel = str(b.get("papel") or "operador").strip().lower()
        if papel not in USER_ROLES:
            return None, _err("Papel inválido.")
        out["papel"] = papel
    if "ativo" in b:
        out["ativo"] = bool(b.get("ativo"))
    senha = b.get("senha")
    if senha or not partial:
        if not _valid_password(senha):
            return None, _err(f"A senha precisa ter pelo menos {MIN_PASSWORD} caracteres.")
        out["senhaHash"] = generate_password_hash(senha)
    return out, None


@bp.post("/api/users")
@admin_required
def users_create():
    try:
        users = list_users(force=True)
    except Exception as e:
        return _store_error(e)
    data, err = _parse_user(request.get_json(silent=True) or {}, False, users)
    if err:
        return err
    data.update(ativo=True, criadoEm=now_iso())
    try:
        user = _get_store().create_user(data)
    except StoreError as e:
        return _store_error(e)
    _invalidate()
    log.info("Usuário criado: %s (%s) por %s", user["login"], user["papel"], current_user()["login"])
    return jsonify(public_user(user)), 201


@bp.patch("/api/users/<uid>")
@admin_required
def users_update(uid):
    try:
        users = list_users(force=True)
    except Exception as e:
        return _store_error(e)
    target = next((u for u in users if u["id"] == uid), None)
    if not target:
        return _err("Usuário não encontrado.", 404, "not_found")
    data, err = _parse_user(request.get_json(silent=True) or {}, True, users, editing_id=uid)
    if err:
        return err
    if not data:
        return _err("Nada para alterar.")
    me_ = current_user()
    if uid == me_["id"] and (data.get("ativo") is False or data.get("papel") == "operador"):
        return _err("Você não pode desativar nem rebaixar o seu próprio usuário.")
    loses_admin = target["papel"] == "admin" and (data.get("papel") == "operador" or data.get("ativo") is False)
    if loses_admin and not _active_admins(users, exclude_id=uid):
        return _err("É preciso manter pelo menos um administrador ativo.")
    try:
        _get_store().update_user(uid, data)
    except StoreError as e:
        return _store_error(e)
    _invalidate()
    return jsonify(public_user({**target, **data}))


@bp.delete("/api/users/<uid>")
@admin_required
def users_delete(uid):
    if uid == current_user()["id"]:
        return _err("Você não pode excluir o seu próprio usuário.")
    try:
        users = list_users(force=True)
    except Exception as e:
        return _store_error(e)
    target = next((u for u in users if u["id"] == uid), None)
    if not target:
        return _err("Usuário não encontrado.", 404, "not_found")
    if target["papel"] == "admin" and target["ativo"] and not _active_admins(users, exclude_id=uid):
        return _err("É preciso manter pelo menos um administrador ativo.")
    try:
        _get_store().delete_user(uid)
    except StoreError as e:
        return _store_error(e)
    _invalidate()
    return jsonify({"deleted": True, "id": uid})
