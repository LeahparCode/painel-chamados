"""Instâncias: um painel separado por cliente/operação (ex.: Safra), cada um com os seus
disparos, templates, tema de cores e lista de quem pode ver.

Quem vê o quê:
  - administrador: vê e edita todas as instâncias, cria/edita instâncias e define o acesso das pessoas;
  - operador: vê e edita só as instâncias liberadas para ele (coluna "Instancias" do usuário);
  - conta pendente / visitante sem login: só vê instâncias marcadas como "visível sem login".

O navegador informa a instância em cada chamada (cabeçalho X-Instancia ou ?inst=), e o
servidor confere a permissão sempre — nada depende só da tela.

Na primeira execução, a instância "Safra" é criada apontando para as abas que já existiam
("Disparos" e "Templates"), e quem já usava o painel ganha acesso a ela. Nada é migrado.
"""
import os
import re
import time
import logging
import threading
import unicodedata

from flask import Blueprint, jsonify, request, g

from storage import StoreError
from storage.base import now_iso, split_ids, join_ids, TEMAS, MODELOS, TEMA_PADRAO
from auth import current_user, admin_required, list_users, invalidate_users

log = logging.getLogger("instances")
bp = Blueprint("instances", __name__)

CACHE_TTL = 30.0
MAX_NOME = 60
EDITOR_ROLES = ("admin", "operador")

_get_store = None
_cache = {"items": None, "ts": 0.0}
_lock = threading.Lock()
_load_lock = threading.Lock()  # uma leitura/criação inicial por vez (evita criar o Safra em dobro)
_bootstrap_done = False


def init_instances(app, get_store):
    global _get_store
    _get_store = get_store
    app.register_blueprint(bp)


def _supports():
    return getattr(_get_store(), "supports_instances", False)


# Airtable (sem cadastro de instâncias): uma instância fixa, que usa as tabelas originais
_UNICA = {"id": "principal", "nome": "Painel", "slug": "painel", "tema": os.getenv("TEMA_PADRAO", TEMA_PADRAO),
          "modelo": "safra", "publico": True, "abaDisparos": "", "abaTemplates": "", "criadoEm": "", "atualizadoEm": ""}


# ---------------------------------------------------------------- cadastro
def slugify(text: str) -> str:
    txt = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", txt).strip("-")[:40] or "instancia"


def _bootstrap(items):
    """Primeira execução: cria a instância Safra sobre as abas existentes e dá acesso a quem já usava."""
    global _bootstrap_done
    if _bootstrap_done or items:
        _bootstrap_done = True
        return False
    _bootstrap_done = True
    store = _get_store()
    inst = store.create_instance({
        "nome": "Safra", "slug": "safra", "tema": "azul-dourado", "modelo": "safra", "publico": True,
        "abaDisparos": store.default_tabs["disparos"], "abaTemplates": store.default_tabs["templates"],
        "criadoEm": now_iso(),
    })
    log.info("Instância inicial criada: Safra (abas %s / %s)", inst["abaDisparos"], inst["abaTemplates"])
    try:
        for u in store.list_users():
            if u["papel"] != "admin" and not split_ids(u.get("instancias")):
                store.update_user(u["id"], {"instancias": inst["id"]})
        invalidate_users()
    except Exception as e:  # não impede o painel de subir
        log.warning("Não consegui liberar a instância Safra para os usuários existentes: %s", e)
    return True


def list_instances(force=False):
    if not _supports():
        return [dict(_UNICA)]
    with _lock:
        cached, ts = _cache["items"], _cache["ts"]
    if not force and cached is not None and time.time() - ts < CACHE_TTL:
        return cached
    try:
        with _load_lock:
            items = _get_store().list_instances()
            if _bootstrap(items):
                items = _get_store().list_instances()
    except Exception as e:
        if cached is not None:
            log.warning("Falha ao ler instâncias (usando cache): %s", e)
            return cached
        raise
    with _lock:
        _cache.update(items=items, ts=time.time())
    return items


def _invalidate():
    with _lock:
        _cache["items"] = None


def find(key):
    key = str(key or "").strip().lower()
    if not key:
        return None
    return next((i for i in list_instances() if i["id"].lower() == key or i["slug"] == key), None)


# ---------------------------------------------------------------- permissões
def can_read(user, inst) -> bool:
    if not inst:
        return False
    if user and user["papel"] == "admin":
        return True
    if user and user["papel"] in EDITOR_ROLES and inst["id"] in split_ids(user.get("instancias")):
        return True
    return bool(inst.get("publico"))


def can_write(user, inst) -> bool:
    if not inst or not user:
        return False
    if user["papel"] == "admin":
        return True
    return user["papel"] == "operador" and inst["id"] in split_ids(user.get("instancias"))


def readable(user):
    return [i for i in list_instances() if can_read(user, i)]


def resolve(write=False):
    """Instância pedida pelo navegador, já com a permissão conferida. Devolve (inst, resposta_de_erro)."""
    if "inst" in g:
        inst = g.inst
    else:
        key = request.headers.get("X-Instancia") or request.args.get("inst") or ""
        try:
            user = current_user()
            inst = find(key) if key else next(iter(readable(user)), None)
        except Exception as e:
            log.error("Falha ao ler instâncias: %s", e)
            return None, (jsonify({"error": "storage_error", "message": str(e)}), 503)
        if inst is None or not can_read(user, inst):
            if not user:
                return None, (jsonify({"error": "unauthorized", "message": "Faça login para ver este painel."}), 401)
            return None, (jsonify({"error": "forbidden_instance", "message": "Você não tem acesso a esta instância."}), 403)
        g.inst = inst
    if write and not can_write(current_user(), inst):
        return None, (jsonify({"error": "forbidden_instance", "message": "Você não pode editar esta instância."}), 403)
    return inst, None


def public_instance(inst, user=None):
    out = {k: inst.get(k) for k in ("id", "nome", "slug", "tema", "modelo")}
    out["podeEditar"] = can_write(user, inst)
    if user and user["papel"] == "admin":
        out.update(publico=bool(inst.get("publico")), abaDisparos=inst.get("abaDisparos"),
                   abaTemplates=inst.get("abaTemplates"), criadoEm=inst.get("criadoEm"))
    return out


# ---------------------------------------------------------------- rotas
def _err(message, status=400, code="invalid"):
    return jsonify({"error": code, "message": message}), status


@bp.get("/api/instancias")
def instancias_list():
    user = current_user()
    try:
        items = readable(user)
    except Exception as e:
        return _err(str(e), getattr(e, "status", 503), "storage_error")
    return jsonify({"instancias": [public_instance(i, user) for i in items],
                    "gerenciar": _supports() and bool(user and user["papel"] == "admin")})


def _parse(b, partial):
    out = {}
    if "nome" in b or not partial:
        nome = " ".join(str(b.get("nome") or "").split())
        if not nome or len(nome) > MAX_NOME:
            return None, _err(f"Dê um nome à instância (até {MAX_NOME} caracteres).")
        out["nome"] = nome
    if "tema" in b or not partial:
        tema = str(b.get("tema") or TEMA_PADRAO).strip()
        if tema not in TEMAS:
            return None, _err("Tema inválido.")
        out["tema"] = tema
    if "modelo" in b or not partial:
        modelo = str(b.get("modelo") or "padrao").strip()
        if modelo not in MODELOS:
            return None, _err("Modelo inválido.")
        out["modelo"] = modelo
    if "publico" in b or not partial:
        out["publico"] = bool(b.get("publico"))
    return out, None


def _require_support():
    if not _supports():
        return _err("Instâncias exigem o armazenamento no Google Planilhas.", 400, "unsupported")
    return None


@bp.post("/api/instancias")
@admin_required
def instancias_create():
    err = _require_support()
    if err:
        return err
    data, err = _parse(request.get_json(silent=True) or {}, partial=False)
    if err:
        return err
    try:
        items = list_instances(force=True)
        base = slugify(data["nome"])
        slug, n = base, 2
        usados = {i["slug"] for i in items}
        while slug in usados:
            slug, n = f"{base}-{n}", n + 1
        data.update(slug=slug, abaDisparos=f"Disparos - {slug}", abaTemplates=f"Templates - {slug}", criadoEm=now_iso())
        store = _get_store()
        store.prepare_instance_tabs(data)  # cria as abas antes de registrar
        inst = store.create_instance(data)
    except StoreError as e:
        return _err(str(e), e.status, "storage_error")
    _invalidate()
    log.info("Instância criada: %s (%s) por %s", inst["nome"], inst["slug"], current_user()["login"])
    return jsonify(public_instance(inst, current_user())), 201


@bp.patch("/api/instancias/<iid>")
@admin_required
def instancias_update(iid):
    err = _require_support()
    if err:
        return err
    data, err = _parse(request.get_json(silent=True) or {}, partial=True)
    if err:
        return err
    if not data:
        return _err("Nada para alterar.")
    try:
        target = next((i for i in list_instances(force=True) if i["id"] == iid), None)
        if not target:
            return _err("Instância não encontrada.", 404, "not_found")
        _get_store().update_instance(iid, data)
    except StoreError as e:
        return _err(str(e), e.status, "storage_error")
    _invalidate()
    return jsonify(public_instance({**target, **data}, current_user()))


@bp.delete("/api/instancias/<iid>")
@admin_required
def instancias_delete(iid):
    """Remove a instância do cadastro. As abas com os dados continuam na planilha (nada é apagado)."""
    err = _require_support()
    if err:
        return err
    try:
        items = list_instances(force=True)
        target = next((i for i in items if i["id"] == iid), None)
        if not target:
            return _err("Instância não encontrada.", 404, "not_found")
        if len(items) <= 1:
            return _err("É preciso manter pelo menos uma instância.")
        _get_store().delete_instance(iid)
        # tira a instância da lista de acesso de quem a tinha
        for u in list_users(force=True):
            ids = split_ids(u.get("instancias"))
            if iid in ids:
                _get_store().update_user(u["id"], {"instancias": join_ids(i for i in ids if i != iid)})
        invalidate_users()
    except StoreError as e:
        return _err(str(e), e.status, "storage_error")
    _invalidate()
    log.info("Instância removida do cadastro: %s (abas mantidas: %s, %s)", target["nome"],
             target.get("abaDisparos"), target.get("abaTemplates"))
    return jsonify({"deleted": True, "id": iid, "abas": [target.get("abaDisparos"), target.get("abaTemplates")]})
