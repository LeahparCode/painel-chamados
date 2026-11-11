"""Geração de planilhas Excel (.xlsx) para a tela "Exportar".

O front-end monta o conteúdo (abas, colunas e linhas já calculadas) e este módulo
só cuida da formatação: cabeçalho destacado, moeda, datas, larguras, filtros e totais.

Formato esperado:
{
  "filename": "disparos_2026-11.xlsx",
  "sheets": [{
     "name": "Disparos",
     "columns": [{"title": "Data", "type": "date", "width": 12}, ...],
     "rows": [[...], ...],             # cada célula: valor simples ou {"v": valor, "t": tipo}
     "totals": [...]                    # opcional, linha em negrito no final
  }]
}
Tipos: text, longtext, int, number, money, money3, percent, date, datetime, auto.
"""
import io
import re
from datetime import date, datetime

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

FORMATS = {
    "int": "#,##0",
    "number": "#,##0.00",
    "money": '"R$" #,##0.00',
    "money3": '"R$" #,##0.000',
    "percent": "0.0%",
    "date": "dd/mm/yyyy",
    "datetime": "dd/mm/yyyy hh:mm",
}
NUMERIC = {"int", "number", "money", "money3", "percent"}
MAX_SHEETS, MAX_COLS, MAX_ROWS = 10, 40, 50000

HEADER_FILL = PatternFill("solid", fgColor="1F2937")
TOTAL_FILL = PatternFill("solid", fgColor="EEF0F4")
HEADER_FONT = Font(bold=True, color="FFFFFF")
BOLD = Font(bold=True)
TOP_BORDER = Border(top=Side(style="thin", color="9CA3AF"))


class ExportError(ValueError):
    pass


def safe_filename(name: str, default: str = "disparos.xlsx") -> str:
    name = re.sub(r"[^\w.\-]+", "_", str(name or "")).strip("._") or default
    if not name.lower().endswith(".xlsx"):
        name += ".xlsx"
    return name[:120]


def _sheet_title(name, used):
    title = re.sub(r"[\[\]:*?/\\]", "", str(name or "")).strip()[:31] or "Planilha"
    base, n = title, 2
    while title.lower() in used:
        suffix = f" ({n})"
        title = base[: 31 - len(suffix)] + suffix
        n += 1
    used.add(title.lower())
    return title


def _convert(value, kind):
    if value is None or value == "":
        return None
    try:
        if kind == "int":
            return int(float(value))
        if kind in NUMERIC:
            return float(value)
        if kind == "date":
            return date.fromisoformat(str(value)[:10])
        if kind == "datetime":
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except (TypeError, ValueError):
        return str(value)
    if kind == "auto" and isinstance(value, (int, float)):
        return value
    return str(value)


def _write(ws, row, col, raw, col_kind, bold=False, fill=None, border=None):
    kind = col_kind
    if isinstance(raw, dict):
        kind = raw.get("t") or col_kind
        raw = raw.get("v")
    cell = ws.cell(row=row, column=col)
    cell.value = _convert(raw, kind)
    if isinstance(cell.value, str) and cell.value.startswith("="):
        cell.data_type = "s"  # nunca interpretar texto como fórmula
    if kind in FORMATS and not isinstance(cell.value, str):
        cell.number_format = FORMATS[kind]
    if kind == "longtext":
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    elif kind in NUMERIC:
        cell.alignment = Alignment(horizontal="right", vertical="top")
    else:
        cell.alignment = Alignment(vertical="top")
    if bold:
        cell.font = BOLD
    if fill:
        cell.fill = fill
    if border:
        cell.border = border
    return cell


def build_xlsx(spec: dict) -> bytes:
    if not isinstance(spec, dict):
        raise ExportError("Formato inválido.")
    sheets = spec.get("sheets")
    if not isinstance(sheets, list) or not sheets:
        raise ExportError("Nenhuma aba para exportar.")
    if len(sheets) > MAX_SHEETS:
        raise ExportError("Abas demais.")

    wb = Workbook()
    wb.remove(wb.active)
    wb.properties.creator = "Painel de Disparos"
    used = set()

    for sheet in sheets:
        columns = sheet.get("columns") or []
        rows = sheet.get("rows") or []
        if not isinstance(columns, list) or not columns or len(columns) > MAX_COLS:
            raise ExportError("Colunas inválidas.")
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            raise ExportError("Linhas demais para exportar.")

        ws = wb.create_sheet(_sheet_title(sheet.get("name"), used))
        kinds = [str((c or {}).get("type") or "text") for c in columns]

        # cabeçalho
        for ci, col in enumerate(columns, start=1):
            cell = ws.cell(row=1, column=ci, value=str((col or {}).get("title") or ""))
            cell.font, cell.fill = HEADER_FONT, HEADER_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.row_dimensions[1].height = 24

        # linhas
        for ri, row in enumerate(rows, start=2):
            if not isinstance(row, list):
                raise ExportError("Linha inválida.")
            for ci, kind in enumerate(kinds, start=1):
                _write(ws, ri, ci, row[ci - 1] if ci - 1 < len(row) else None, kind)

        last = len(rows) + 1
        totals = sheet.get("totals")
        if isinstance(totals, list) and rows:
            last += 1
            for ci, kind in enumerate(kinds, start=1):
                value = totals[ci - 1] if ci - 1 < len(totals) else None
                _write(ws, last, ci, value, kind, bold=True, fill=TOTAL_FILL, border=TOP_BORDER)

        # larguras
        for ci, col in enumerate(columns, start=1):
            width = (col or {}).get("width")
            if not width:
                sample = [len(str((col or {}).get("title") or ""))] + [
                    len(str(r[ci - 1])) for r in rows[:300] if isinstance(r, list) and ci - 1 < len(r) and r[ci - 1] is not None
                ]
                width = min(60, max(10, max(sample) + 2))
            ws.column_dimensions[get_column_letter(ci)].width = float(width)

        ws.freeze_panes = "A2"
        if rows and sheet.get("filter", True):
            ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{len(rows) + 1}"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
