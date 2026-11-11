"""Armazenamento no Google Planilhas (Google Sheets).

Duas abas na mesma planilha:
  - "Disparos"  (GOOGLE_SHEET_TAB)            → os disparos do painel
  - "Templates" (GOOGLE_TEMPLATES_TAB)        → templates escritos pelos usuários
  - "Usuarios"  (GOOGLE_USERS_TAB)            → logins do painel (senha guardada só como hash)
Ambas são criadas automaticamente, com cabeçalho, se não existirem.

Como a planilha não gera ID nem data de modificação sozinha, o servidor:
  - cria um ID único para cada linha (coluna "ID");
  - grava "AtualizadoEm" a cada criação/alteração.

As colunas são localizadas pelo NOME do cabeçalho (linha 1), então a ordem pode ser
alterada à vontade. Só não apague/renomeie a coluna "ID".
Linhas digitadas à mão sem ID recebem um ID automaticamente na próxima leitura.
"""
import os
import json
import uuid
import threading
import unicodedata
import logging

from .base import FIELDS, TEMPLATE_FIELDS, USER_FIELDS, StoreError, clean_record, clean_template, clean_user, now_iso

log = logging.getLogger("storage.sheets")

HEADERS = [h for _, h in FIELDS]
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _norm(text) -> str:
    txt = unicodedata.normalize("NFD", str(text or "")).encode("ascii", "ignore").decode()
    return " ".join(txt.lower().split())


def _col_letter(n: int) -> str:
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def new_id(prefix: str = "rec") -> str:
    return prefix + uuid.uuid4().hex[:14]


def _api_error(e):
    log.warning("Erro Google Sheets: %s", e)
    return StoreError(f"Google Sheets: {e}", 502)


class SheetTable:
    """Uma aba da planilha tratada como tabela (cabeçalho na linha 1)."""

    def __init__(self, worksheet, fields, clean, id_prefix="rec", sort_key="atualizadoEm"):
        self.ws = worksheet
        self.fields = fields
        self.clean = clean
        self.id_prefix = id_prefix
        self.sort_key = sort_key
        self.key_by_header = {_norm(h): k for k, h in fields}
        self.lock = threading.RLock()
        self.cols = {}  # chave → índice da coluna (1-based)

    # ---------- cabeçalho ----------
    def ensure_headers(self, header=None):
        """Mapeia colunas pelo nome e cria as que faltarem (à direita).
        É chamado antes de cada operação, então reordenar colunas na planilha é seguro."""
        with self.lock:
            if header is None:
                header = self.ws.row_values(1)
            cols, missing = {}, []
            for idx, name in enumerate(header, start=1):
                key = self.key_by_header.get(_norm(name))
                if key and key not in cols:
                    cols[key] = idx
            for key, title in self.fields:
                if key not in cols:
                    missing.append((key, title))
            if missing:
                start = len(header) + 1
                end = start + len(missing) - 1
                if end > self.ws.col_count:
                    self.ws.add_cols(end - self.ws.col_count)
                for offset, (key, _) in enumerate(missing):
                    cols[key] = start + offset
                rng = f"{_col_letter(start)}1:{_col_letter(end)}1"
                self.ws.update([[t for _, t in missing]], rng, value_input_option="RAW")
                log.info("Colunas criadas na aba %s: %s", getattr(self.ws, "title", "?"), ", ".join(t for _, t in missing))
            self.cols = cols

    # ---------- utilidades ----------
    def _read_rows(self):
        from gspread.utils import ValueRenderOption, DateTimeOption
        return self.ws.get_values(
            value_render_option=ValueRenderOption.unformatted,
            date_time_render_option=DateTimeOption.formatted_string,
        )

    def _row_to_record(self, row):
        rec = {key: (row[col - 1] if col - 1 < len(row) else "") for key, col in self.cols.items()}
        return self.clean(rec)

    def _find_row(self, rid: str) -> int:
        ids = self.ws.col_values(self.cols["id"])
        for idx, value in enumerate(ids, start=1):
            if idx > 1 and str(value).strip() == rid:
                return idx
        raise StoreError("Registro não encontrado na planilha.", 404)

    def _cell_updates(self, row: int, data: dict):
        return [
            {"range": f"{_col_letter(self.cols[k])}{row}", "values": [[v]]}
            for k, v in data.items() if k in self.cols
        ]

    # ---------- operações ----------
    def list(self):
        import gspread
        with self.lock:
            try:
                rows = self._read_rows()
                self.ensure_headers([str(c) for c in rows[0]] if rows else [])
            except gspread.exceptions.APIError as e:
                raise _api_error(e)
            records, fixes = [], []
            for idx, row in enumerate(rows[1:], start=2):
                if not any(str(c).strip() for c in row):
                    continue
                rec = self._row_to_record(row)
                if not rec["id"]:
                    rec["id"] = new_id(self.id_prefix)
                    fixes.append({"range": f"{_col_letter(self.cols['id'])}{idx}", "values": [[rec["id"]]]})
                records.append(rec)
            if fixes:
                try:
                    self.ws.batch_update(fixes, value_input_option="RAW")
                    log.info("IDs gerados para %d linha(s) sem ID.", len(fixes))
                except gspread.exceptions.APIError as e:
                    log.warning("Não consegui gravar IDs novos: %s", e)
        records.sort(key=lambda r: r.get(self.sort_key) or "", reverse=True)
        return records

    def create(self, data: dict):
        import gspread
        rec = self.clean({**data, "id": new_id(self.id_prefix), "atualizadoEm": now_iso()})
        with self.lock:
            try:
                self.ensure_headers()
                row = [""] * max(self.cols.values())
                for key, col in self.cols.items():
                    row[col - 1] = rec.get(key, "")
                self.ws.append_row(row, value_input_option="RAW", table_range="A1")
            except gspread.exceptions.APIError as e:
                raise _api_error(e)
        return rec

    def update(self, rid: str, patch: dict):
        import gspread
        patch = {k: v for k, v in patch.items() if k != "id"}
        patch["atualizadoEm"] = now_iso()
        with self.lock:
            try:
                self.ensure_headers()
                row = self._find_row(rid)
                self.ws.batch_update(self._cell_updates(row, patch), value_input_option="RAW")
            except gspread.exceptions.APIError as e:
                raise _api_error(e)
        return {"id": rid, **patch}

    def delete(self, rid: str):
        import gspread
        with self.lock:
            try:
                self.ensure_headers()
                self.ws.delete_rows(self._find_row(rid))
            except gspread.exceptions.APIError as e:
                raise _api_error(e)


class SheetsStore:
    name = "sheets"
    snapshot_ttl = 10.0

    def __init__(self, worksheet, templates_worksheet=None, users_worksheet=None):
        """templates_worksheet / users_worksheet: a aba ou uma função que a devolve (criada sob demanda)."""
        self.disparos = SheetTable(worksheet, FIELDS, clean_record, "rec")
        self._providers = {"templates": templates_worksheet, "users": users_worksheet}
        self._tables = {}
        self._tables_lock = threading.Lock()

    def _lazy_table(self, name, fields, clean, prefix):
        with self._tables_lock:
            if name not in self._tables:
                provider = self._providers.get(name)
                if provider is None:
                    raise StoreError(f"Aba de {name} não configurada.", 503)
                ws = provider() if callable(provider) else provider
                self._tables[name] = SheetTable(ws, fields, clean, prefix)
            return self._tables[name]

    # compatibilidade com o código/testes existentes
    @property
    def ws(self):
        return self.disparos.ws

    @property
    def cols(self):
        return self.disparos.cols

    def ensure_headers(self, header=None):
        self.disparos.ensure_headers(header)

    # ---------- criação ----------
    @classmethod
    def from_env(cls):
        import gspread

        sheet_id = (os.getenv("GOOGLE_SHEET_ID") or "").strip()
        if not sheet_id:
            raise RuntimeError("Configure GOOGLE_SHEET_ID (o ID que aparece na URL da planilha).")

        raw = (os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
        path = (os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE") or "").strip()
        if raw:
            try:
                info = json.loads(raw)
            except ValueError as e:
                raise RuntimeError(f"GOOGLE_SERVICE_ACCOUNT_JSON não é um JSON válido: {e}")
            gc = gspread.service_account_from_dict(info, scopes=SCOPES)
        elif path:
            gc = gspread.service_account(filename=path, scopes=SCOPES)
        else:
            raise RuntimeError("Configure GOOGLE_SERVICE_ACCOUNT_JSON com o conteúdo da chave da conta de serviço.")

        try:
            sh = gc.open_by_key(sheet_id)
        except gspread.exceptions.APIError as e:
            raise RuntimeError(
                "Não consegui abrir a planilha. Confira o GOOGLE_SHEET_ID e se ela foi "
                f"compartilhada (Editor) com o e-mail da conta de serviço. Detalhe: {e}"
            )

        def tab(title, cols):
            try:
                return sh.worksheet(title)
            except gspread.exceptions.WorksheetNotFound:
                log.info("Aba %r não existe; criando.", title)
                return sh.add_worksheet(title=title, rows=1000, cols=cols)

        ws = tab(os.getenv("GOOGLE_SHEET_TAB", "Disparos"), len(FIELDS))
        store = cls(
            ws,
            lambda: tab(os.getenv("GOOGLE_TEMPLATES_TAB", "Templates"), len(TEMPLATE_FIELDS)),
            lambda: tab(os.getenv("GOOGLE_USERS_TAB", "Usuarios"), len(USER_FIELDS)),
        )
        store.ensure_headers()
        return store

    # ---------- disparos ----------
    def list_records(self):
        return self.disparos.list()

    def create(self, data: dict):
        return self.disparos.create(data)

    def update(self, rid: str, patch: dict):
        return self.disparos.update(rid, patch)

    def delete(self, rid: str):
        self.disparos.delete(rid)

    # ---------- templates ----------
    @property
    def templates(self) -> SheetTable:
        return self._lazy_table("templates", TEMPLATE_FIELDS, clean_template, "tpl")

    @property
    def users(self) -> SheetTable:
        return self._lazy_table("users", USER_FIELDS, clean_user, "usr")

    def list_templates(self):
        return self.templates.list()

    def create_template(self, data: dict):
        return self.templates.create(data)

    def update_template(self, tid: str, patch: dict):
        return self.templates.update(tid, patch)

    def delete_template(self, tid: str):
        self.templates.delete(tid)

    # ---------- usuários ----------
    def list_users(self):
        return self.users.list()

    def create_user(self, data: dict):
        return self.users.create(data)

    def update_user(self, uid: str, patch: dict):
        return self.users.update(uid, patch)

    def delete_user(self, uid: str):
        self.users.delete(uid)
