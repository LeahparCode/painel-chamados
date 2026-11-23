"""Importa o "calendário de ações" (JSON exportado da ferramenta de calendário) como disparos.

Formato esperado:
{
  "activeSeg": "safra",
  "segs": [{"id": "safra", "name": "SAFRA",
            "actionsByDate": {"2026-10-22": [{"id": 1002, "channel": "email", "text": "..."}]}}]
}

Cada ação vira um disparo:
  - data            → a data da ação no calendário
  - tipoDisparo     → canal (sms → SMS, rcs → RCS, whatsapp → WhatsApp, email → E-mail)
  - tipo (nome)     → resumo do texto (sem a linha "Agendar para o dia X")
  - obs             → texto completo da ação
  - volume          → "Qtd: N" quando informado
  - status          → antes de hoje: Finalizado; hoje e depois: Em andamento
  - horario         → padrão (o calendário não tem horário)
  - ref             → cal-<segmento>-<id>, usado para não importar a mesma ação duas vezes
"""
import re
from datetime import date

CANAL_PARA_TIPO = {"sms": "SMS", "rcs": "RCS", "whatsapp": "WhatsApp", "email": "E-mail", "e-mail": "E-mail"}
HORARIO_PADRAO = "08:00"
MAX_ACOES = 5000

_AGENDAR = re.compile(r"^agend\w*\s+pa\w*\s+o\s+dia\s+\d+", re.I)   # aceita "Papar" (erro de digitação no calendário)
_QTD = re.compile(r"\bqtd\.?\s*:?\s*([\d.]+)", re.I)
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ImportError_(ValueError):
    pass


def _linhas(texto):
    return [l.strip() for l in str(texto or "").replace("\r\n", "\n").split("\n") if l.strip()]


def _nome(texto, tipo):
    partes = []
    for l in _linhas(texto):
        if _AGENDAR.match(l) or _QTD.search(l):
            continue
        partes.append(l.rstrip(";.").strip())
    nome = " · ".join(p for p in partes if p)
    if len(nome) > 80:
        nome = nome[:79].rstrip(" ·") + "…"
    return nome or f"Ação {tipo}"


def _volume(texto):
    m = _QTD.search(str(texto or ""))
    return int(m.group(1).replace(".", "")) if m else 0


def parse_calendar(data, hoje=None, seg=None):
    """Devolve (registros, avisos). Não grava nada."""
    if not isinstance(data, dict) or not isinstance(data.get("segs"), list):
        raise ImportError_("Arquivo não parece um calendário de ações (falta a lista 'segs').")
    hoje = (hoje or date.today()).isoformat()
    segs = data["segs"]
    alvo = seg or data.get("activeSeg")
    if alvo:
        escolhidos = [s for s in segs if isinstance(s, dict) and s.get("id") == alvo] or segs
    else:
        escolhidos = segs

    registros, avisos, total = [], [], 0
    for s in escolhidos:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "seg").strip()
        acoes_por_dia = s.get("actionsByDate") or {}
        if not isinstance(acoes_por_dia, dict):
            continue
        for dia, acoes in sorted(acoes_por_dia.items()):
            if not _DATA.match(str(dia)) or not isinstance(acoes, list):
                avisos.append(f"Data ignorada: {dia!r}")
                continue
            for a in acoes:
                total += 1
                if total > MAX_ACOES:
                    raise ImportError_(f"Arquivo grande demais (mais de {MAX_ACOES} ações).")
                if not isinstance(a, dict):
                    continue
                canal = str(a.get("channel") or "").strip().lower()
                tipo = CANAL_PARA_TIPO.get(canal)
                if not tipo:
                    avisos.append(f"{dia}: canal desconhecido {canal!r} (ação {a.get('id')}) ignorado")
                    continue
                texto = "\n".join(_linhas(a.get("text")))
                registros.append({
                    "data": dia,
                    "horario": HORARIO_PADRAO,
                    "tipoDisparo": tipo,
                    "tipo": _nome(texto, tipo),
                    "obs": texto[:1000],
                    "volume": _volume(texto),
                    "potes": 0,
                    "tempo": 0,
                    "template": "",
                    "status": "Finalizado" if dia < hoje else "Em andamento",
                    "ref": f"cal-{sid}-{a.get('id')}",
                })
    return registros, avisos
