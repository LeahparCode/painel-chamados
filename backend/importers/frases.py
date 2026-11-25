"""Importa frases (templates) de uma planilha Excel (.xlsx) ou CSV.

Layout: as colunas são encontradas pelo NOME do cabeçalho (em qualquer ordem e em qualquer uma
das primeiras linhas da planilha); outras colunas são ignoradas.
  - Tipo        → SMS, RCS, WhatsApp ou E-mail (aceita variações: "sms", "Whats", "email"…)
  - Frase       → texto da mensagem
  - Caracteres  → opcional/informativo (o sistema conta de novo, depois da limpeza de SMS)

Frases de SMS passam pela mesma limpeza do cadastro de templates (sem acento, cedilha, emoji).
"""
import csv
import io
import re
import unicodedata

from textos import texto_sms

MAX_LINHAS = 2000
MAX_TEXTO = 4000

TIPOS = {
    "sms": "SMS", "rcs": "RCS",
    "whatsapp": "WhatsApp", "whats": "WhatsApp", "wpp": "WhatsApp", "zap": "WhatsApp", "whatsapp business": "WhatsApp",
    "e-mail": "E-mail", "email": "E-mail", "mail": "E-mail",
}
CABECALHOS = {"tipo": "tipo", "frase": "frase", "frases": "frase", "texto": "frase", "mensagem": "frase",
              "caracteres": "caracteres", "qtd caracteres": "caracteres", "quantidade de caracteres": "caracteres"}


class ImportFrasesError(ValueError):
    pass


def _norm(texto) -> str:
    t = unicodedata.normalize("NFD", str(texto or "")).encode("ascii", "ignore").decode()
    return " ".join(t.lower().replace("_", " ").split())


def _linhas_xlsx(data: bytes):
    from openpyxl import load_workbook
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception:
        raise ImportFrasesError("Não consegui abrir a planilha. Envie um arquivo .xlsx (Excel) ou .csv.")
    try:
        for ws in wb.worksheets:  # usa a primeira aba que tiver o cabeçalho
            linhas = [list(r) for r in ws.iter_rows(values_only=True, max_row=MAX_LINHAS + 20)]
            if _achar_cabecalho(linhas)[0] is not None:
                return linhas
        return [list(r) for r in wb.worksheets[0].iter_rows(values_only=True, max_row=MAX_LINHAS + 20)] if wb.worksheets else []
    finally:
        wb.close()


def _linhas_csv(data: bytes):
    texto = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            texto = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if texto is None:
        raise ImportFrasesError("Não consegui ler o CSV (codificação desconhecida).")
    try:
        delim = csv.Sniffer().sniff(texto[:4000], delimiters=";,\t").delimiter
    except csv.Error:
        delim = ";"  # padrão do Excel em português
    return [r for r in csv.reader(io.StringIO(texto), delimiter=delim)]


def _achar_cabecalho(linhas):
    """Procura, nas 10 primeiras linhas, a que tem as colunas Tipo e Frase. Devolve (índice, colunas)."""
    for i, linha in enumerate(linhas[:10]):
        cols = {}
        for j, cel in enumerate(linha or []):
            chave = CABECALHOS.get(_norm(cel))
            if chave and chave not in cols:
                cols[chave] = j
        if "tipo" in cols and "frase" in cols:
            return i, cols
    return None, {}


def nome_da_frase(tipo: str, texto: str, n: int) -> str:
    resumo = " ".join(texto.split())
    resumo = re.sub(r"^(banco\s+\w+\s*:\s*)", "", resumo, flags=re.I)  # tira o prefixo "Banco X:"
    if len(resumo) > 48:
        resumo = resumo[:47].rstrip(" ,.;:-") + "…"
    return f"{tipo} · {resumo}" if resumo else f"{tipo} · Frase {n}"


def parse_frases(data: bytes, nome_arquivo: str = ""):
    """Devolve (frases, avisos). frases = [{linha, tipo, texto, original, limpa, nome}]"""
    if not data:
        raise ImportFrasesError("Arquivo vazio.")
    csv_ = nome_arquivo.lower().endswith(".csv")
    linhas = _linhas_csv(data) if csv_ else _linhas_xlsx(data)
    idx, cols = _achar_cabecalho(linhas)
    if idx is None:
        raise ImportFrasesError("Não encontrei o cabeçalho. A planilha precisa ter as colunas Tipo e Frase "
                                "(e opcionalmente Caracteres) na primeira linha.")
    frases, avisos = [], []
    corpo = linhas[idx + 1:]
    if len(corpo) > MAX_LINHAS:
        raise ImportFrasesError(f"Planilha grande demais: no máximo {MAX_LINHAS} frases por vez.")
    for k, linha in enumerate(corpo, start=idx + 2):  # número da linha como no Excel
        cel = lambda c: (linha[cols[c]] if c in cols and cols[c] < len(linha) else None)
        tipo_bruto, texto_bruto = cel("tipo"), cel("frase")
        if (tipo_bruto in (None, "")) and (texto_bruto in (None, "")):
            continue  # linha em branco
        tipo = TIPOS.get(_norm(tipo_bruto))
        texto = str(texto_bruto or "").replace("\r\n", "\n").strip()
        if not tipo:
            avisos.append(f"Linha {k}: tipo \"{tipo_bruto or ''}\" inválido (use SMS, RCS, WhatsApp ou E-mail)")
            continue
        if not texto:
            avisos.append(f"Linha {k}: frase vazia")
            continue
        original = texto
        if tipo == "SMS":
            texto = texto_sms(texto)
            if not texto:
                avisos.append(f"Linha {k}: a frase ficou vazia depois de remover os caracteres especiais")
                continue
        if len(texto) > MAX_TEXTO:
            avisos.append(f"Linha {k}: frase com mais de {MAX_TEXTO} caracteres")
            continue
        frases.append({"linha": k, "tipo": tipo, "texto": texto, "limpa": texto != original,
                       "nome": nome_da_frase(tipo, texto, len(frases) + 1)})
    return frases, avisos


def modelo_xlsx() -> bytes:
    """Planilha modelo com o cabeçalho certo e dois exemplos."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = "Frases"
    ws.append(["Tipo", "Frase", "Caracteres"])
    exemplos = [
        ("SMS", "Exemplo: sua parcela vence hoje. Fale conosco pelo 0800 000 0000."),
        ("WhatsApp", "Olá! Temos uma condição especial para você. Responda esta mensagem para saber mais."),
    ]
    for tipo, frase in exemplos:
        ws.append([tipo, frase, len(frase)])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1468E0")
    ws.column_dimensions["A"].width = 12
    ws.column_dimensions["B"].width = 90
    ws.column_dimensions["C"].width = 12
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
