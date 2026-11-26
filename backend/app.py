import os, re, time, json, hashlib, logging, threading, unicodedata
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request, Response, render_template, g
from werkzeug.middleware.proxy_fix import ProxyFix

from storage import create_store, backend_name, StoreError
from storage.base import now_iso, normalize_date
from export_xlsx import build_xlsx, safe_filename, ExportError
from auth import init_auth, editor_required, admin_required, list_users
from instances import init_instances, resolve as resolve_instance, find as find_instance, can_read
from importers.calendario import parse_calendar, ajustes_existentes, ImportError_
from importers.frases import parse_frases, ImportFrasesError, modelo_xlsx
from textos import texto_sms
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


def _ler_versao():
    """Número da versão (arquivo VERSION, aumentado a cada atualização publicada)."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION"), encoding="utf-8") as f:
            return f.read().strip() or "0.0.0"
    except OSError:
        return "0.0.0"


APP_VERSION = _ler_versao()
# o Render informa o commit publicado; sem ele (ex.: rodando local) fica vazio
APP_COMMIT = (os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT") or "")[:7]
# quando este servidor subiu (= quando a atualização entrou no ar), no horário de Brasília
APP_NO_AR = (datetime.now(timezone.utc) - timedelta(hours=3)).strftime("%d/%m/%Y %H:%M")


def _versao_titulo():
    partes = [f"Versão {APP_VERSION}"]
    if APP_COMMIT:
        partes.append(f"atualização {APP_COMMIT}")
    partes.append(f"no ar desde {APP_NO_AR}")
    return " · ".join(partes)


@app.context_processor
def inject_asset_version():
    return {"asset_version": ASSET_VERSION, "app_version": APP_VERSION, "app_version_title": _versao_titulo()}


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


RUN = "Em andamento"


def _marca_inicio(inst, fields, rid=None):
    """O timer de "Em andamento" conta a partir de Inicio. Grava Inicio quando o disparo PASSA a
    estar em andamento; editar outro campo não reinicia o timer. Disparos antigos (sem Inicio)
    ganham Inicio = AtualizadoEm atual antes de serem editados, para o timer não recomeçar."""
    atual = None
    if rid:
        data, _ = get_snapshot(inst, force=False)
        atual = next((r for r in data if r.get("id") == rid), None)
    status_antes = (atual or {}).get("status") or ""
    status_depois = fields.get("status", status_antes)
    if status_depois != RUN:
        return fields
    if status_antes != RUN:
        fields["inicio"] = now_iso()
    elif atual and not atual.get("inicio") and atual.get("atualizadoEm"):
        fields["inicio"] = atual["atualizadoEm"]
    return fields


def _refresh_quietly(inst):
    try:
        get_snapshot(inst, force=True)
    except Exception:
        pass


def _store_error_response(e: Exception):
    status = getattr(e, "status", 502)
    log.error("Erro no armazenamento: %s", e)
    return jsonify({"error": "storage_error", "message": str(e)}), status


# limites dos campos numéricos (evita valores negativos ou absurdos gravados por engano)
LIMITES = {"tempo": 7 * 24 * 60, "potes": 100_000, "volume": 100_000_000}
MAX_NOME, MAX_TEMPLATE_KEY = 200, 100
HORA_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _bad(code, message):
    return None, (jsonify({"error": code, "message": message}), 400)


def _parse_fields(b: dict, partial: bool):
    """Valida o corpo da requisição e devolve (campos, erro)."""
    if not isinstance(b, dict):
        return _bad("invalid_body", "Formato de dados inválido.")
    fields = {}
    try:
        for key in ("tempo", "potes", "volume"):
            if key in b or not partial:
                fields[key] = int(b.get(key) or 0)
    except (ValueError, TypeError):
        return _bad("invalid_data_type", "Os campos de tempo, potes e volume devem ser números inteiros.")
    for key, maximo in LIMITES.items():
        if key in fields and not 0 <= fields[key] <= maximo:
            return _bad("invalid_number", f"{key.capitalize()}: use um número entre 0 e {maximo:,}.".replace(",", "."))

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

    for key, maximo in (("tipo", MAX_NOME), ("template", MAX_TEMPLATE_KEY)):
        if key in b or not partial:
            valor = str(b.get(key) or "").strip()
            if len(valor) > maximo:
                return _bad("invalid_" + key, f"{'Nome' if key == 'tipo' else 'Frase'}: no máximo {maximo} caracteres.")
            fields[key] = valor

    if "obs" in b:
        obs = str(b.get("obs") or "").replace("\r\n", "\n").strip()
        if len(obs) > 1000:
            return None, (jsonify({"error": "invalid_obs", "message": "Observações: no máximo 1000 caracteres."}), 400)
        fields["obs"] = obs

    if "horario" in b or not partial:
        horario = str(b.get("horario") or "08:00").strip()
        if len(horario) == 4 and horario[1] == ":":
            horario = "0" + horario  # "8:00" → "08:00"
        if not HORA_RE.match(horario):
            return _bad("invalid_horario", "Horário inválido: use HH:MM (ex.: 08:00).")
        fields["horario"] = horario
    if "data" in b or not partial:
        data = normalize_date(b.get("data")) if b.get("data") else datetime.now().strftime("%Y-%m-%d")
        try:
            datetime.strptime(data, "%Y-%m-%d")
        except (ValueError, TypeError):
            return _bad("invalid_data", "Data inválida: use AAAA-MM-DD ou DD/MM/AAAA.")
        fields["data"] = data
    return fields, None


# ===== Views =====
@app.before_request
def _corpo_objeto():
    """Todas as rotas de escrita recebem um objeto JSON; outro formato (lista, número…) vira 400,
    em vez de derrubar a rota com erro 500."""
    if request.method in ("POST", "PUT", "PATCH") and request.path.startswith("/api/") and request.is_json:
        corpo = request.get_json(silent=True)
        if corpo is not None and not isinstance(corpo, dict):
            return jsonify({"error": "invalid_body", "message": "Formato de dados inválido."}), 400
    return None


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
    return jsonify(ok=True, storage=backend_name(), version=APP_VERSION, commit=APP_COMMIT)


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
    _marca_inicio(inst, fields)
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
        _marca_inicio(inst, fields, rid)
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
@with_instance(write=True)  # preços só para quem edita a instância (com "só ver" não aparecem valores)
def api_config(inst):
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
    if data["tipo"] == "SMS":
        data["texto"] = texto_sms(data["texto"])
        if not data["texto"]:
            return jsonify({"error": "invalid_texto", "message": "O texto ficou vazio depois de remover os caracteres especiais."}), 400
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
        tipo, texto = data.get("tipo"), data.get("texto")
        if tipo is None or (tipo == "SMS" and texto is None):  # alteração parcial: usa o que já está salvo
            atual = next((t for t in scoped(inst).list_templates() if t["id"] == tid), None)
            if atual:
                tipo = tipo or atual["tipo"]
                texto = texto if texto is not None else atual["texto"]
        if tipo == "SMS" and texto is not None:
            data["texto"] = texto_sms(texto)
            if not data["texto"]:
                return jsonify({"error": "invalid_texto", "message": "O texto ficou vazio depois de remover os caracteres especiais."}), 400
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
    agora = now_iso()
    for r in novos:  # disparos de hoje entram "Em andamento": o timer começa agora
        if r.get("status") == RUN:
            r["inicio"] = agora
    for a in ajustes:
        if "tempo" in a["patch"] and a["patch"].get("status", RUN) == RUN:
            a["patch"]["inicio"] = agora
    try:
        sc = scoped(inst)
        criados = sc.create_many(novos) if novos else []
        atualizados = sc.update_many([(a["id"], a["patch"]) for a in ajustes]) if ajustes else 0
    except StoreError as e:
        return _store_error_response(e)
    _refresh_quietly(inst)
    log.info("Calendário importado em %s: %d novos, %d atualizados, %d já existiam", inst["slug"], len(criados), atualizados, duplicados)
    return jsonify({**resumo, "confirmado": True, "criados": len(criados), "atualizados": atualizados})


# ---- Importação de frases (templates) ----
MAX_ARQUIVO_FRASES = 5 * 1024 * 1024


@app.get("/api/import/frases/modelo")
@editor_required
def import_frases_modelo():
    return Response(modelo_xlsx(), mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": 'attachment; filename="modelo_importar_frases.xlsx"'})


@app.post("/api/import/frases")
@editor_required
@with_instance(write=True)  # só em instâncias que a pessoa pode EDITAR (o servidor confere)
def import_frases(inst):
    """Planilha (.xlsx/.csv) com as colunas Tipo, Frase e Caracteres → templates da instância.
    Sem ?confirmar=1 só devolve a prévia. Frases que já existem (mesmo tipo e texto) são ignoradas."""
    arquivo = request.files.get("arquivo")
    if not arquivo or not arquivo.filename:
        return jsonify({"error": "no_file", "message": "Escolha a planilha (.xlsx ou .csv)."}), 400
    nome = arquivo.filename
    if not nome.lower().endswith((".xlsx", ".csv")):
        return jsonify({"error": "bad_file", "message": "Envie um arquivo .xlsx (Excel) ou .csv."}), 400
    data = arquivo.read(MAX_ARQUIVO_FRASES + 1)
    if len(data) > MAX_ARQUIVO_FRASES:
        return jsonify({"error": "too_big", "message": "Arquivo grande demais (máx. 5 MB)."}), 400
    try:
        frases, avisos = parse_frases(data, nome)
    except ImportFrasesError as e:
        return jsonify({"error": "invalid_file", "message": str(e)}), 400

    sc = scoped(inst)
    try:
        existentes = sc.list_templates()
    except StoreError as e:
        return _store_error_response(e)
    vistos = {(t["tipo"], " ".join(t["texto"].split())) for t in existentes}
    novas, repetidas = [], 0
    for f in frases:
        chave = (f["tipo"], " ".join(f["texto"].split()))
        if chave in vistos:
            repetidas += 1
            continue
        vistos.add(chave)
        novas.append(f)

    por_tipo = {}
    for f in novas:
        por_tipo[f["tipo"]] = por_tipo.get(f["tipo"], 0) + 1
    resumo = {
        "instancia": inst["nome"], "total": len(frases) + len(avisos),
        "validas": len(frases), "novas": len(novas), "repetidas": repetidas, "invalidas": len(avisos),
        "smsLimpas": sum(1 for f in novas if f["limpa"]), "porTipo": por_tipo,
        "avisos": avisos[:30], "amostra": [{k: f[k] for k in ("linha", "tipo", "nome", "texto", "limpa")} for f in novas[:8]],
    }
    if request.args.get("confirmar") != "1":
        return jsonify({**resumo, "confirmado": False})
    itens = [{"nome": f["nome"][:TEMPLATE_MAX_NOME], "tipo": f["tipo"], "texto": f["texto"]} for f in novas]
    try:
        if not itens:
            criados = []
        elif hasattr(sc, "create_templates"):
            criados = sc.create_templates(itens)
        else:  # Airtable: um por vez
            criados = [sc.create_template(i) for i in itens]
    except StoreError as e:
        return _store_error_response(e)
    _TPL_CACHE.pop(inst["id"], None)
    log.info("Frases importadas em %s: %d novas, %d repetidas, %d inválidas", inst["slug"], len(criados), repetidas, len(avisos))
    return jsonify({**resumo, "confirmado": True, "criados": len(criados)})


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
STREAM_MAX_SECONDS = float(os.getenv("STREAM_MAX_SECONDS", "300"))
STREAM_RECHECK_SECONDS = float(os.getenv("STREAM_RECHECK_SECONDS", "30"))  # reconfere o acesso


@app.get("/api/stream")
@with_instance()
def stream(inst):
    uid = (g.get("user") or {}).get("id")  # quem abriu a conexão (já conferido pelo with_instance)

    def ainda_pode_ler():
        """Acesso retirado, conta desativada/excluída ou instância removida: para de enviar dados."""
        try:
            user = next((u for u in list_users() if u["id"] == uid), None)
            if not user or not user["ativo"]:
                return False
            alvo = find_instance(inst["id"])
            return bool(alvo) and can_read(user, alvo)
        except Exception:
            return True  # falha momentânea ao ler a planilha: não derruba quem tem acesso

    def gen():
        last_hash = None
        fim = time.time() + STREAM_MAX_SECONDS
        proxima_conferencia = time.time() + STREAM_RECHECK_SECONDS
        yield "retry: 3000\n\n"
        # a conexão é renovada de tempos em tempos: libera a thread do servidor e confere de novo
        # o login/permissão na reconexão (o navegador reconecta na hora ao receber "bye")
        while time.time() < fim:
            if time.time() >= proxima_conferencia:
                proxima_conferencia = time.time() + STREAM_RECHECK_SECONDS
                if not ainda_pode_ler():
                    yield "event: revoked\ndata: {}\n\n"
                    return
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
        yield "event: bye\ndata: {}\n\n"

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return Response(gen(), mimetype="text/event-stream", headers=headers)


# ===== Main =====
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8080")), debug=True)
