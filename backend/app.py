import os, time, json, hashlib, logging, threading
from datetime import datetime

from flask import Flask, jsonify, request, Response, render_template
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix

from storage import create_store, backend_name, StoreError

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
log = logging.getLogger("app")

# Tipos de disparo aceitos (o valor de cada envio fica em static/js/core/config.js → COST_PER_TIPO)
VALID_TIPO_DISPARO = {
    "SMS",
    "RCS",
    "WhatsApp",
}

VALID_STATUS = {"Em andamento", "Finalizado", "Insucesso"}

# ===== App =====
# Obs.: o login foi removido temporariamente (será reimplementado depois).
# Todas as rotas de escrita estão abertas.
app = Flask(__name__, template_folder="templates", static_folder="static")
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_port=1)
CORS(app)

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


def md5(obj) -> str:
    return hashlib.md5(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


_LAST_SNAPSHOT = []
_LAST_FETCH_TS = 0.0
_SNAPSHOT_LOCK = threading.Lock()


def _snapshot_ttl() -> float:
    env = os.getenv("SNAPSHOT_TTL")
    if env:
        return float(env)
    return getattr(_STORE, "snapshot_ttl", 6.0)


def get_snapshot(force: bool = False):
    """Lê os registros com cache compartilhado entre todas as conexões."""
    global _LAST_SNAPSHOT, _LAST_FETCH_TS
    with _SNAPSHOT_LOCK:
        if not force and (time.time() - _LAST_FETCH_TS) < _snapshot_ttl() and _LAST_FETCH_TS:
            return _LAST_SNAPSHOT, False
        try:
            data = get_store().list_records()
            _LAST_SNAPSHOT, _LAST_FETCH_TS = data, time.time()
            return data, False
        except Exception as e:
            log.warning("Falha ao ler registros: %s", e)
            _LAST_FETCH_TS = time.time()  # evita martelar a API quando ela está fora
            return _LAST_SNAPSHOT, True


def _refresh_quietly():
    try:
        get_snapshot(force=True)
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
    return resp


@app.route("/")
def index():
    return render_template("index.html")


@app.get("/healthz")
def health():
    return jsonify(ok=True, storage=backend_name())


# ---- Data ----
@app.get("/api/disparos")
def api_disparos():
    data, stale = get_snapshot(force=False)
    resp = jsonify(data)
    resp.headers["X-Data-Stale"] = "1" if stale else "0"
    return resp


@app.post("/api/disparos")
def create_disparo():
    fields, err = _parse_fields(request.json or {}, partial=False)
    if err:
        return err
    try:
        rec = get_store().create(fields)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly()
    return jsonify(rec), 201


@app.patch("/api/disparos/<rid>")
def update_disparo(rid):
    fields, err = _parse_fields(request.json or {}, partial=True)
    if err:
        return err
    if not fields:
        return jsonify({"error": "empty_update"}), 400
    try:
        rec = get_store().update(rid, fields)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly()
    return jsonify(rec)


@app.delete("/api/disparos/<rid>")
def delete_disparo(rid):
    try:
        get_store().delete(rid)
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly()
    return jsonify({"deleted": True, "id": rid})


# ---- SSE ----
@app.get("/api/stream")
def stream():
    def gen():
        last_hash = None
        yield "retry: 3000\n\n"
        while True:
            # usa o cache compartilhado: várias abas abertas não multiplicam as chamadas à API
            data, stale = get_snapshot(force=False)
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
