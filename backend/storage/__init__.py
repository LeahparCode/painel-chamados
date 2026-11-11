"""Camada de dados do painel.

Escolha o armazenamento pela variável DATA_BACKEND:
  - "sheets"   → Google Planilhas (padrão quando GOOGLE_SHEET_ID estiver definido)
  - "airtable" → Airtable

Todas as implementações trabalham com registros "normalizados" (dicts com as chaves
usadas pelo front-end: id, tipo, tempo, potes, volume, horario, status, template,
atualizadoEm, data, tag, tipoDisparo).
"""
import os
import logging

from .base import StoreError, FIELD_KEYS

log = logging.getLogger("storage")


def backend_name() -> str:
    name = (os.getenv("DATA_BACKEND") or "").strip().lower()
    if name:
        return name
    return "sheets" if os.getenv("GOOGLE_SHEET_ID") else "airtable"


def create_store():
    name = backend_name()
    if name == "sheets":
        from .sheets_store import SheetsStore
        return SheetsStore.from_env()
    if name == "airtable":
        from .airtable_store import AirtableStore
        return AirtableStore.from_env()
    raise RuntimeError(f"DATA_BACKEND inválido: {name!r} (use 'sheets' ou 'airtable')")


__all__ = ["create_store", "backend_name", "StoreError", "FIELD_KEYS"]
