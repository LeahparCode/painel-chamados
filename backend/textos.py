"""Limpeza de texto usada no cadastro e na importação de templates."""
import re
import unicodedata

# SMS: acento, cedilha, emoji e símbolos "tipográficos" mudam a codificação da mensagem e derrubam o
# limite de 160 para 70 caracteres. Templates de SMS são limpos automaticamente ao salvar.
_SMS_TROCAS = {
    "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u00ab": '"', "\u00bb": '"',   # aspas curvas / «»
    "\u2018": "'", "\u2019": "'", "\u00b4": "'", "`": "'",                        # apóstrofos
    "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2022": "-",                   # travessões, marcador
    "\u2026": "...", "\u00ba": "o", "\u00aa": "a", "\u00b0": "o",                 # reticências, º ª °
    "\u00a0": " ", "\u20ac": "EUR",
}


def texto_sms(texto: str) -> str:
    """Deixa só caracteres simples: ç→c, ã→a, aspas/travessões comuns, sem emojis."""
    t = str(texto or "")
    for de, para in _SMS_TROCAS.items():
        t = t.replace(de, para)
    t = unicodedata.normalize("NFD", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))   # tira acentos e cedilha
    t = "".join(ch for ch in t if ch == "\n" or 32 <= ord(ch) < 127)  # emojis e demais símbolos
    t = re.sub(r"[ \t]{2,}", " ", t)
    return "\n".join(l.strip() for l in t.split("\n")).strip()
