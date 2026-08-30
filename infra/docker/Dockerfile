# Продовые образы api / bot / worker из одного файла: общая база с uv-окружением
# всего workspace, три тонких финальных target'а. Выбор — `build.target` в
# infra/docker-compose.prod.yml. Один общий слой зависимостей вместо трёх
# существенен для VPS: 2 ГБ RAM и 40 ГБ диска (docs/DEPLOY.md).

FROM python:3.12-slim-bookworm AS base

COPY --from=ghcr.io/astral-sh/uv:0.11.28 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Сначала только манифесты: слой с зависимостями переживает правки кода,
# и пересборка после git pull не тянет scipy заново.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/
COPY apps/bot/pyproject.toml apps/bot/
COPY apps/worker/pyproject.toml apps/worker/
COPY packages/core/pyproject.toml packages/core/
COPY packages/keto_engine/pyproject.toml packages/keto_engine/
RUN uv sync --frozen --no-dev --all-packages --no-install-workspace

COPY packages/keto_engine packages/keto_engine
COPY packages/core packages/core
COPY apps/api apps/api
COPY apps/bot apps/bot
COPY apps/worker apps/worker
# Сиды демо-данных запускаются внутри контейнера api (docs/DEPLOY.md).
COPY infra/scripts infra/scripts
RUN uv sync --frozen --no-dev --all-packages

# Каталоги томов создаются в образе и отдаются `app` заранее.
#
# Пустой named volume наследует владельца и права той точки монтирования,
# которая есть в образе; если её нет — docker создаёт каталог от root, а
# процесс идёт под `app` (USER ниже) и писать туда не может. Вложения так и
# падали бы: 500 на первой же загрузке документа, причём только на сервере.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /data/reports /data/attachments /data/erased \
    && chown app /data/reports /data/attachments /data/erased


FROM base AS api
USER app
EXPOSE 8000
# --no-proxy-headers обязателен: адрес клиента разрешает только приложение по
# TRUSTED_PROXY_IPS, иначе audit_log.ip и ключ rate-limit управляемы клиентом
# (infra/nginx/README.md).
CMD ["python", "-m", "uvicorn", "api.main:app", \
     "--host", "0.0.0.0", "--port", "8000", "--no-proxy-headers"]


FROM base AS bot
USER app
CMD ["python", "-m", "bot.main"]


FROM base AS worker
# weasyprint — обёртка над pango/cairo (apps/worker/README.md); шрифты DejaVu —
# кириллица в PDF-отчётах.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libffi8 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
USER app
CMD ["python", "-m", "arq", "worker.main.WorkerSettingsARQ"]
