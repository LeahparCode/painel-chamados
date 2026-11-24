"""Mudanças automáticas de status, feitas pelo servidor (não dependem de ninguém com o painel aberto).

1. Virada do dia: disparo "Programado" cuja data chegou (horário de Brasília) vira "Em andamento"
   com timer de AUTO_START_MINUTES minutos (padrão 15). Se o disparo já tiver um tempo próprio, ele é mantido.
2. Fim do timer: disparo "Em andamento" com tempo > 0 cujo prazo (Inicio + tempo) passou vira "Finalizado".
   Disparos antigos, sem Inicio, usam AtualizadoEm.

Como o painel é servido sob demanda (o plano gratuito do Render "dorme"), a verificação acontece a cada
leitura dos disparos: se ninguém acessar à meia-noite, a troca é feita no primeiro acesso seguinte
e o timer começa a contar a partir desse momento.
"""
import os
from datetime import datetime, timedelta, timezone

from importers.calendario import hoje_brasil
from storage.base import now_iso

AUTO_START_MINUTES = int(os.getenv("AUTO_START_MINUTES", "15"))


def _parse_ts(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def transicoes(records, hoje=None, agora=None, minutos_padrao=None):
    """Devolve [(id, patch, motivo)] com as mudanças de status que já deveriam ter acontecido."""
    hoje = (hoje or hoje_brasil()).isoformat() if not isinstance(hoje, str) else hoje
    agora = agora or datetime.now(timezone.utc)
    minutos_padrao = minutos_padrao or AUTO_START_MINUTES
    out = []
    for r in records:
        status = (r.get("status") or "").strip()
        tempo = int(r.get("tempo") or 0)
        data = (r.get("data") or "")[:10]
        if status == "Programado" and data and data <= hoje:
            out.append((r["id"], {"status": "Em andamento", "tempo": tempo or minutos_padrao, "inicio": now_iso()}, "inicio"))
        elif status == "Em andamento" and tempo > 0:
            inicio = _parse_ts(r.get("inicio") or r.get("atualizadoEm"))
            if inicio and inicio + timedelta(minutes=tempo) <= agora:
                out.append((r["id"], {"status": "Finalizado"}, "fim"))
    return out
