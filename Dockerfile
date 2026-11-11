FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ /app/

EXPOSE 8080

# ---- Gunicorn configurado p/ SSE ----
# -k gthread / --threads 8: conexões SSE longas não bloqueiam o worker
# -w 1: 1 worker (o cache do snapshot do Airtable fica em memória)
# --timeout 0: não derruba conexões longas (SSE)
# --keep-alive 75: reduz resets ociosos
# A porta vem da variável PORT (definida pelo Render / render.yaml); padrão 8080.
CMD ["sh", "-c", "exec gunicorn -k gthread -w 1 --threads 8 --timeout 0 --keep-alive 75 -b 0.0.0.0:${PORT:-8080} app:app"]
