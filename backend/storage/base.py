"""Tipos e utilitários comuns às implementações de armazenamento."""
import re
from datetime import datetime, timezone

# chave normalizada → nome da coluna/campo
FIELDS = [
    ("id", "ID"),
    ("tipo", "Tipo"),
    ("tempo", "Tempo"),
    ("potes", "Potes"),
    ("volume", "Volume"),
    ("horario", "Horário"),
    ("status", "Status"),
    ("template", "Template"),
    ("atualizadoEm", "AtualizadoEm"),
    ("data", "Data"),
    ("tipoDisparo", "Tipo Disparo"),
]
FIELD_KEYS = [k for k, _ in FIELDS]
INT_KEYS = {"tempo", "potes", "volume"}


class StoreError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def to_int(value) -> int:
    if value in (None, ""):
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    txt = str(value).strip().replace(" ", "")
    # aceita "1.200" (pt-BR) e "1,200" (en) como milhar
    if re.fullmatch(r"-?\d{1,3}([.,]\d{3})+", txt):
        txt = re.sub(r"[.,]", "", txt)
    txt = txt.replace(",", ".")
    try:
        return int(float(txt))
    except ValueError:
        return 0


def normalize_date(value) -> str:
    """Converte datas comuns para AAAA-MM-DD (dd/mm/aaaa é tratado como pt-BR)."""
    if value in (None, ""):
        return ""
    txt = str(value).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", txt)
    if m:
        y, mo, d = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", txt)
    if m:
        d, mo, y = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
    return txt


def normalize_time(value) -> str:
    if value in (None, ""):
        return ""
    m = re.match(r"^(\d{1,2}):(\d{2})", str(value).strip())
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return str(value).strip()


def clean_record(rec: dict) -> dict:
    """Garante tipos/formatos consistentes para o front-end."""
    out = {k: rec.get(k, "") for k in FIELD_KEYS}
    for k in INT_KEYS:
        out[k] = to_int(out[k])
    out["data"] = normalize_date(out["data"])
    out["horario"] = normalize_time(out["horario"])
    for k in ("id", "tipo", "status", "template", "atualizadoEm", "tipoDisparo"):
        out[k] = "" if out[k] is None else str(out[k]).strip()
    return out
