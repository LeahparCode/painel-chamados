import os, time, json, hashlib, logging, threading
from datetime import datetime

from flask import Flask, jsonify, request, Response, render_template
from werkzeug.middleware.proxy_fix import ProxyFix

from storage import create_store, backend_name, StoreError
from export_xlsx import build_xlsx, safe_filename, ExportError
from auth import init_auth, editor_required, admin_required
from instances import init_instances, resolve as resolve_instance
from importers.calendario import parse_calendar, ajustes_existentes, ImportError_
from automacao import transicoes

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("app")

# Tipos de disparo aceitos (o valor de cada envio fica em static/js/core/config.js → COST_PER_TIPO)
# Tipo do disparo → valor de cada envio (R$). Entregue ao navegador só para quem está logado
# (GET /api/config), para que visitantes não consigam ver nem calcular valores.
PRECO_POR_TIPO = {
    "SMS": 0.07,
    "RCS": 0.07,
    "WhatsApp": 0.12,
    "E-mail": 0.0,   # sem custo informado; ajuste aqui se houver
}
VALID_TIPO_DISPARO = set(PRECO_POR_TIPO)

# Programado: disparo de dia futuro, ainda não iniciado
VALID_STATUS = {"Em andamento", "Finalizado", "Insucesso", "Programado"}

# ===== App =====
# Visitantes só leem o painel; escrita exige login (ver auth.py).
app = Flask(__name__, template_folder="templates", static_folder="static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
app.config["MAX_CONTENT_LENGTH"] = 20 * 1024 * 1024  # limite do corpo das requisições (exportação)

# Versão dos assets para "furar" cache do navegador a cada deploy/restart
ASSET_VERSION = os.getenv("ASSET_VERSION") or str(int(time.time()))


@app.context_processor
def inject_asset_version():
    return {"asset_version": ASSET_VERSION}


# ===== Armazenamento (Google Planilhas ou Airtable) =====
_STORE = None
_STORE_LOCK = threading.Lock()
_STORE_ERROR = ""
_STORE_ERROR_TS = 0.0


def get_store():
    """Cria o armazenamento sob demanda; se a configuração estiver errada, tenta de novo a cada 30s."""
    global _STORE, _STORE_ERROR, _STORE_ERROR_TS
    if _STORE is not None:
        return _STORE
    with _STORE_LOCK:
        if _STORE is not None:
            return _STORE
        if _STORE_ERROR and time.time() - _STORE_ERROR_TS < 30:
            raise StoreError(_STORE_ERROR, 503)
        try:
            _STORE = create_store()
            _STORE_ERROR = ""
            log.info("Armazenamento ativo: %s", _STORE.name)
            return _STORE
        except Exception as e:
            _STORE_ERROR, _STORE_ERROR_TS = str(e), time.time()
            log.error("Falha ao configurar o armazenamento (%s): %s", backend_name(), e)
            raise StoreError(_STORE_ERROR, 503)


init_auth(app, get_store)
init_instances(app, get_store)


def scoped(inst):
    """Armazenamento (disparos/templates) de uma instância."""
    return get_store().scope(inst)


def with_instance(write=False):
    """Descobre a instância pedida (cabeçalho X-Instancia ou ?inst=) e confere a permissão.
    A rota recebe a instância em `inst`."""
    def deco(fn):
        from functools import wraps

        @wraps(fn)
        def wrapper(*args, **kwargs):
            inst, err = resolve_instance(write=write)
            if err:
                return err
            return fn(inst, *args, **kwargs)
        return wrapper
    return deco


def md5(obj) -> str:
    return hashlib.md5(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


# cache por instância: id → {"data": [...], "ts": float, "auto": float, "lock": Lock}
_SNAPSHOTS = {}
_SNAPSHOTS_LOCK = threading.Lock()


def _slot(inst):
    with _SNAPSHOTS_LOCK:
        if inst["id"] not in _SNAPSHOTS:
            _SNAPSHOTS[inst["id"]] = {"data": [], "ts": 0.0, "auto": 0.0, "lock": threading.Lock()}
        return _SNAPSHOTS[inst["id"]]


def _snapshot_ttl() -> float:
    env = os.getenv("SNAPSHOT_TTL")
    if env:
        return float(env)
    return getattr(_STORE, "snapshot_ttl", 6.0)


def get_snapshot(inst, force: bool = False):
    """Lê os disparos da instância com cache compartilhado entre todas as conexões."""
    slot = _slot(inst)
    with slot["lock"]:
        if not force and (time.time() - slot["ts"]) < _snapshot_ttl() and slot["ts"]:
            return slot["data"], False
        try:
            data = scoped(inst).list_records()
            data = _aplicar_automacoes(inst, slot, data)
            slot["data"], slot["ts"] = data, time.time()
            return data, False
        except Exception as e:
            log.warning("Falha ao ler registros (%s): %s", inst.get("slug"), e)
            slot["ts"] = time.time()  # evita martelar a API quando ela está fora
            return slot["data"], True


AUTO_INTERVAL = float(os.getenv("AUTO_INTERVAL", "30"))


def _aplicar_automacoes(inst, slot, data):
    """Programado → Em andamento na virada do dia; Em andamento → Finalizado quando o timer acaba.
    Roda no máximo a cada AUTO_INTERVAL segundos e grava tudo numa única atualização em lote."""
    if time.time() - slot["auto"] < AUTO_INTERVAL:
        return data
    slot["auto"] = time.time()
    try:
        mudancas = transicoes(data)
        if not mudancas:
            return data
        sc = scoped(inst)
        sc.update_many([(rid, patch) for rid, patch, _ in mudancas])
        inicios = sum(1 for *_, m in mudancas if m == "inicio")
        log.info("Automação (%s): %d programado(s) iniciado(s), %d finalizado(s) pelo timer",
                 inst.get("slug"), inicios, len(mudancas) - inicios)
        return sc.list_records()
    except Exception as e:
        log.warning("Falha na automação de status: %s", e)
        return data


def _refresh_quietly(inst):
    try:
        get_snapshot(inst, force=True)
    except Exception:
        pass


def _store_error_response(e: Exception):
    status = getattr(e, "status", 502)
    log.error("Erro no armazenamento: %s", e)
    return jsonify({"error": "storage_error", "message": str(e)}), status


def _parse_fields(b: dict, partial: bool):
    """Valida o corpo da requisição e devolve (campos, erro)."""
    fields = {}
    try:
        for key in ("tempo", "potes", "volume"):
            if key in b or not partial:
                fields[key] = int(b.get(key) or 0)
    except (ValueError, TypeError):
        return None, (jsonify({"error": "invalid_data_type",
                               "message": "Os campos de tempo, potes e volume devem ser números inteiros."}), 400)

    if "status" in b or not partial:
        status = b.get("status") or "Em andamento"
        if status not in VALID_STATUS:
            return None, (jsonify({"error": "invalid_status"}), 400)
        fields["status"] = status

    if "tipoDisparo" in b or not partial:
        tipo = (b.get("tipoDisparo") or "").strip()
        if tipo not in VALID_TIPO_DISPARO and (tipo or not partial):
            return None, (jsonify({"error": "invalid_tipo_disparo",
                                   "message": "Escolha o tipo do disparo: " + ", ".join(sorted(VALID_TIPO_DISPARO))}), 400)
        fields["tipoDisparo"] = tipo

    for key in ("tipo", "template"):
        if key in b or not partial:
            fields[key] = (b.get(key) or "").strip()

    if "obs" in b:
        obs = str(b.get("obs") or "").replace("\r\n", "\n").strip()
        if len(obs) > 1000:
            return None, (jsonify({"error": "invalid_obs", "message": "Observações: no máximo 1000 caracteres."}), 400)
        fields["obs"] = obs

    if "horario" in b or not partial:
        fields["horario"] = b.get("horario") or "08:00"
    if "data" in b or not partial:
        fields["data"] = b.get("data") or datetime.now().strftime("%Y-%m-%d")
    return fields, None


# ===== Views =====
@app.after_request
def add_headers(resp):
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    # Segurança: o painel não pode ser aberto dentro de outro site (evita "clonar" a tela via iframe
    # e ataques de clique disfarçado), o navegador não adivinha tipos de arquivo e não vaza a URL completa.
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Content-Security-Policy", "frame-ancestors 'self'")
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/favicon.ico")
def favicon():
    # alguns navegadores pedem /favicon.ico direto, sem olhar o <link rel="icon">
    return app.send_static_file("img/favicon.ico")


@app.get("/healthz")
def health():
    return jsonify(ok=True, storage=backend_name())


# ---- Data ----
@app.get("/api/disparos")
@with_instance()
def api_disparos(inst):
    data, stale = get_snapshot(inst, force=False)
    resp = jsonify(data)
    resp.headers["X-Data-Stale"] = "1" if stale else "0"
    return resp


@app.post("/api/disparos")
@editor_required
@with_instance(write=True)
def create_disparo(inst):
    fields, err = _parse_fields(request.json or {}, partial=False)
    if err:
        return err
    try:
        rec = scoped(inst).create(fields)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    return jsonify(rec), 201


@app.patch("/api/disparos/<rid>")
@editor_required
@with_instance(write=True)
def update_disparo(inst, rid):
    fields, err = _parse_fields(request.json or {}, partial=True)
    if err:
        return err
    if not fields:
        return jsonify({"error": "empty_update"}), 400
    try:
        rec = scoped(inst).update(rid, fields)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    return jsonify(rec)


@app.post("/api/disparos/excluir-lote")
@admin_required
@with_instance(write=True)
def delete_disparos_lote(inst):
    """Exclusão em massa (somente administradores). Recebe exatamente os IDs mostrados na prévia."""
    b = request.get_json(silent=True) or {}
    ids = b.get("ids")
    if not isinstance(ids, list) or not ids:
        return jsonify({"error": "empty", "message": "Nenhum disparo selecionado."}), 400
    if len(ids) > 5000:
        return jsonify({"error": "too_many", "message": "No máximo 5000 disparos por vez."}), 400
    ids = list(dict.fromkeys(str(i).strip() for i in ids if str(i).strip()))
    try:
        excluidos = scoped(inst).delete_many(ids)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    log.info("Exclusão em massa (%s): %d disparo(s) excluído(s) de %d pedido(s)", inst["slug"], excluidos, len(ids))
    return jsonify({"excluidos": excluidos, "pedidos": len(ids)})


@app.delete("/api/disparos/<rid>")
@editor_required
@with_instance(write=True)
def delete_disparo(inst, rid):
    try:
        scoped(inst).delete(rid)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    return jsonify({"deleted": True, "id": rid})


# ---- Configuração (somente logados) ----
@app.get("/api/config")
@editor_required
def api_config():
    return jsonify({"precos": PRECO_POR_TIPO})


# ---- Templates personalizados ----
_TPL_CACHE = {}  # id da instância → {"data": [...], "ts": float}
_TPL_TTL = 10.0
TEMPLATE_MAX_NOME, TEMPLATE_MAX_TEXTO = 80, 4000


def _parse_template(b: dict, partial: bool):
    out = {}
    if "nome" in b or not partial:
        nome = " ".join(str(b.get("nome") or "").split())
        if not nome or len(nome) > TEMPLATE_MAX_NOME:
            return None, (jsonify({"error": "invalid_nome", "message": f"Dê um nome ao template (até {TEMPLATE_MAX_NOME} caracteres)."}), 400)
        out["nome"] = nome
    if "tipo" in b or not partial:
        tipo = str(b.get("tipo") or "").strip()
        if tipo not in VALID_TIPO_DISPARO:
            return None, (jsonify({"error": "invalid_tipo", "message": "Escolha o tipo: " + ", ".join(sorted(VALID_TIPO_DISPARO))}), 400)
        out["tipo"] = tipo
    if "texto" in b or not partial:
        texto = str(b.get("texto") or "").replace("\r\n", "\n").strip()
        if not texto or len(texto) > TEMPLATE_MAX_TEXTO:
            return None, (jsonify({"error": "invalid_texto", "message": f"Escreva o texto do template (até {TEMPLATE_MAX_TEXTO} caracteres)."}), 400)
        out["texto"] = texto
    return out, None


@app.get("/api/templates")
@editor_required
@with_instance()
def list_templates(inst):
    c = _TPL_CACHE.get(inst["id"])
    if c and time.time() - c["ts"] < _TPL_TTL:
        return jsonify(c["data"])
    try:
        data = scoped(inst).list_templates()
    except StoreError as e:
        return _store_error_response(e)
    _TPL_CACHE[inst["id"]] = {"data": data, "ts": time.time()}
    return jsonify(data)


@app.post("/api/templates")
@editor_required
@with_instance(write=True)
def create_template(inst):
    data, err = _parse_template(request.json or {}, partial=False)
    if err:
        return err
    try:
        rec = scoped(inst).create_template(data)
    except StoreError as e:
        return _store_error_response(e)
    _TPL_CACHE.pop(inst["id"], None)
    return jsonify(rec), 201


@app.patch("/api/templates/<tid>")
@editor_required
@with_instance(write=True)
def update_template(inst, tid):
    data, err = _parse_template(request.json or {}, partial=True)
    if err:
        return err
    if not data:
        return jsonify({"error": "empty_update"}), 400
    try:
        rec = scoped(inst).update_template(tid, data)
    except StoreError as e:
        return _store_error_response(e)
    _TPL_CACHE.pop(inst["id"], None)
    return jsonify(rec)


@app.delete("/api/templates/<tid>")
@editor_required
@with_instance(write=True)
def delete_template(inst, tid):
    try:
        scoped(inst).delete_template(tid)
    except StoreError as e:
        return _store_error_response(e)
    _TPL_CACHE.pop(inst["id"], None)
    return jsonify({"deleted": True, "id": tid})


# ---- Importação do calendário de ações ----
@app.post("/api/import/calendario")
@editor_required
@with_instance(write=True)
def import_calendario(inst):
    """?confirmar=1 grava; sem isso, só devolve a prévia (nada é gravado).
    ?hoje=AAAA-MM-DD: data de hoje no navegador de quem importa (define passado / hoje / futuro)."""
    data = request.get_json(silent=True)
    hoje = request.args.get("hoje") or None
    try:
        registros, avisos = parse_calendar(data, hoje=hoje)
    except ImportError_ as e:
        return jsonify({"error": "invalid_calendar", "message": str(e)}), 400

    existentes, stale = get_snapshot(inst, force=True)
    if stale:
        return jsonify({"error": "storage_unavailable", "message": "Não consegui ler os disparos atuais para evitar duplicados. Tente de novo."}), 503
    refs = {r.get("ref") for r in existentes if r.get("ref")}
    novos = [r for r in registros if r["ref"] not in refs]
    duplicados = len(registros) - len(novos)
    ajustes = ajustes_existentes(registros, existentes)

    def contar(lista, chave):
        out = {}
        for r in lista:
            out[r[chave]] = out.get(r[chave], 0) + 1
        return out

    datas = sorted(r["data"] for r in registros)
    resumo = {
        "total": len(registros), "novos": len(novos), "duplicados": duplicados,
        "porTipo": contar(novos, "tipoDisparo"), "porStatus": contar(novos, "status"),
        "de": datas[0] if datas else None, "ate": datas[-1] if datas else None,
        "finalizados": sum(1 for r in novos if r["status"] == "Finalizado"),
        "atualizar": len(ajustes),
        "atualizarPorStatus": contar([{"s": a["patch"].get("status", "Em andamento (10 min)")} for a in ajustes], "s"),
        "avisos": avisos[:20], "amostra": novos[:8],
    }
    if request.args.get("confirmar") != "1":
        return jsonify({**resumo, "confirmado": False})
    try:
        sc = scoped(inst)
        criados = sc.create_many(novos) if novos else []
        atualizados = sc.update_many([(a["id"], a["patch"]) for a in ajustes]) if ajustes else 0
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    log.info("Calendário importado em %s: %d novos, %d atualizados, %d já existiam", inst["slug"], len(criados), atualizados, duplicados)
    return jsonify({**resumo, "confirmado": True, "criados": len(criados), "atualizados": atualizados})


# ---- Exportação ----
@app.post("/api/export/xlsx")
@editor_required
def export_xlsx():
    spec = request.get_json(silent=True) or {}
    try:
        data = build_xlsx(spec)
    except ExportError as e:
        return jsonify({"error": "invalid_export", "message": str(e)}), 400
    filename = safe_filename(spec.get("filename"))
    return Response(
        data,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---- SSE ----
@app.get("/api/stream")
@with_instance()
def stream(inst):
    def gen():
        last_hash = None
        yield "retry: 3000\n\n"
        while True:
            # usa o cache compartilhado: várias abas abertas não multiplicam as chamadas à API
            data, stale = get_snapshot(inst, force=False)
            h = md5([data, stale])
            if h != last_hash:
                last_hash = h
                payload = json.dumps({"type": "snapshot", "records": data, "stale": stale}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            else:
                yield "event: ping\ndata: {}\n\n"
            time.sleep(3)

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return Response(gen(), mimetype="text/event-stream", headers=headers)


# ===== Main =====
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")), debug=True)
