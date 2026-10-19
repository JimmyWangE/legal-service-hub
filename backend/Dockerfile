FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY migrations ./migrations
COPY alembic.ini .
RUN groupadd --gid 10001 legal-api && useradd --uid 10001 --gid 10001 --no-create-home legal-api \
    && mkdir -p /app/data/uploads /app/data/metrics && chown -R 10001:10001 /app/data
USER 10001:10001

EXPOSE 8000
CMD ["sh", "-c", "rm -f /app/data/metrics/*.db && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4 --forwarded-allow-ips 127.0.0.1"]
