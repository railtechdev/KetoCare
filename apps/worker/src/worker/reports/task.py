"""Задача ARQ `render_report` (раздел 10.1 ТЗ).

Собирает PDF по уже созданной записи `report_jobs` и кладёт файл в том отчётов.
Данные отчёта приходят в аргументах задачи: их собрал API тем же кодом, что
питает экран, и второй сборки в воркере быть не должно — иначе отчёт на экране
и отчёт в PDF однажды разойдутся (ADR-0008).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from core.config import Settings
from core.db import get_sessionmaker
from core.repositories import report_jobs as jobs_repo

from .render import html_to_pdf, render_html


def report_path(reports_dir: str, file_name: str) -> Path:
    """Путь к файлу отчёта внутри тома.

    Имя проверяется на выход за пределы каталога: в базе оно своё,
    сгенерированное, но путь собирается из настройки и строки — и правило
    «имя не участвует в пути как есть» дешевле проверить, чем однажды
    обнаружить `../../etc` (OWASP File Upload, то же решение в ADR-0004).
    """

    base = Path(reports_dir).resolve()
    target = (base / file_name).resolve()
    if not target.is_relative_to(base):
        raise ValueError("Имя файла отчёта выходит за пределы тома")
    return target


async def render_report(ctx: dict[str, Any], job_id: str, report: dict[str, Any]) -> str:
    """Собрать PDF и отметить задачу выполненной.

    Возвращает имя файла — оно же попадает в `report_jobs.file_name`, по нему
    API отдаёт файл.
    """

    settings = Settings()  # type: ignore[call-arg]
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        job = await jobs_repo.get(session, uuid.UUID(job_id))
        if job is None:
            # Задача пережила свою строку (например, пациента стёрли по запросу):
            # рендерить нечего, и падать тоже незачем.
            return ""
        await jobs_repo.mark_running(session, job=job)
        await session.commit()

    try:
        title = "Отчёт по пациенту"
        pdf = html_to_pdf(render_html(report, title=title))

        file_name = f"{job_id}.pdf"
        target = report_path(settings.reports_dir, file_name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(pdf)
    except Exception as error:  # noqa: BLE001 - причина уходит в строку задачи
        async with sessionmaker() as session:
            job = await jobs_repo.get(session, uuid.UUID(job_id))
            if job is not None:
                await jobs_repo.mark_failed(session, job=job, error=str(error))
                await session.commit()
        raise

    expires_at = datetime.now(UTC) + timedelta(hours=settings.report_link_ttl_hours)
    async with sessionmaker() as session:
        job = await jobs_repo.get(session, uuid.UUID(job_id))
        if job is not None:
            await jobs_repo.mark_done(session, job=job, file_name=file_name, expires_at=expires_at)
            await session.commit()

    return file_name
