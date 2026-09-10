from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from core.config import get_settings
from core.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

config.set_main_option("sqlalchemy.url", get_settings().database_url)

#: Часовой пояс установки — им же считает и приложение (`core.clock`).
#:
#: Миграции идут в поясе клиники, а не в поясе сервера. Postgres в контейнере
#: работает в UTC (`TZ` ему никто не задаёт), а клиника живёт в UTC+5, и всякое
#: приведение `timestamptz` к календарной дате (`updated_at::date`) без этого
#: даёт вчерашнюю дату для всего, что записано до пяти утра. Для data-миграций,
#: сравнивающих момент записи с календарной датой клиники (`effective_from`,
#: `menus.date`), сдвиг на сутки — это неверно посчитанные клинические данные, и
#: заметить его по результату нельзя.
#:
#: Задаётся здесь, а не в каждой миграции: правило одно на все ревизии, и первая
#: же забытая строка `AT TIME ZONE` вернула бы дефект молча.
_TZ = get_settings().tz


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        # Тот же пояс, что и в online: сгенерированный SQL обязан выполняться с
        # тем же результатом, с каким его выполнил бы alembic сам.
        context.execute(f"SET TIME ZONE '{_TZ}'")
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # Без этого autogenerate молча не замечает изменения server_default
        # (напр. now() -> clock_timestamp()), и DoD "автогенерация не оставляет диффа"
        # выполнялся бы формально, при разошедшейся схеме.
        compare_server_default=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        # Пояс задаётся при подключении, а не отдельным `SET` по соединению.
        # Разница не стилистическая: первый же запрос открыл бы неявную
        # транзакцию, `context.begin_transaction()` присоединился бы к ней
        # вложенным блоком — и НИЧЕГО НЕ КОММИТИЛОСЬ БЫ. Ревизии при этом
        # исправно печатаются в журнал, а база остаётся пустой; поймано прогоном
        # на отдельной базе, по журналу это неотличимо от успешного выката.
        connect_args={"server_settings": {"timezone": _TZ}},
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
