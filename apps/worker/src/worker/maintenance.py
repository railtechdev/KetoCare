"""Уборка файлов по расписанию (ADR-0008, ADR-0013).

Байты живут на диске, а строки — в базе, и разъезжаются они молча: удалённое
вложение и просроченный отчёт занимают том вечно, пока их кто-нибудь не снимет.
До этой задачи такого «кого-нибудь» в продукте не было — `list_expired` была
написана «для уборки файлов» и не вызывалась ниоткуда.

Убираются два вида файлов, и по разным причинам:

- **Отчёты** — ссылка протухла (`REPORT_LINK_TTL_HOURS`), PDF пересобирается из
  базы в любой момент, поэтому держать его незачем.
- **Вложения** — документ удалили, и с тех пор прошло `ATTACHMENT_PURGE_DAYS`.
  Отсрочка здесь не оптимизация, а страховка: выписка из стационара существует
  в одном экземпляре, а удаляется одним нажатием.

Строки в обоих случаях остаются. По ним видно, что отчёт заказывали и что
документ был, — правило 4 отменяется только `erase_patient`, и только по
требованию человека.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from core.config import Settings
from core.db import get_sessionmaker
from core.repositories import attachments as attachments_repo
from core.repositories import report_jobs as jobs_repo


def _remove(directory: str, names: list[str]) -> int:
    """Снимает файлы с диска. Синхронно — обращения к диску не идут из цикла
    событий; вызывается через `asyncio.to_thread`.

    Имя проверяется на выход за пределы каталога — то же правило, что при
    раздаче (`api/services/attachments.py`) и при рендере отчёта.
    """

    base = Path(directory).resolve()
    removed = 0
    for name in names:
        target = (base / name).resolve()
        if not target.is_relative_to(base):
            continue
        # Файла может не быть: том пересоздали, восстановили из бэкапа, убрали
        # руками. Это не ошибка — отметку об уборке всё равно надо поставить,
        # иначе задача будет возвращаться к этой строке каждую ночь.
        if target.exists():
            target.unlink()
            removed += 1
    return removed


async def purge_files(ctx: dict[str, Any]) -> dict[str, int]:
    """Снять с диска просроченные отчёты и убранные вложения.

    Возвращает счётчики — их видно в журнале ARQ, и по ним понятно, работает
    задача или молча ничего не находит.
    """

    settings = Settings()  # type: ignore[call-arg]
    now = datetime.now(UTC)
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        expired = await jobs_repo.list_expired(session, now=now)
        reports = await asyncio.to_thread(
            _remove,
            settings.reports_dir,
            [job.file_name for job in expired if job.file_name],
        )
        for job in expired:
            await jobs_repo.mark_file_removed(session, job=job)

        deadline = now - timedelta(days=settings.attachment_purge_days)
        purgeable = await attachments_repo.list_purgeable(session, before=deadline)
        files = await asyncio.to_thread(
            _remove,
            settings.attachments_dir,
            [attachment.stored_name for attachment in purgeable],
        )
        await attachments_repo.mark_purged(session, attachments=purgeable)

        await session.commit()

    return {"reports": reports, "attachments": files}
