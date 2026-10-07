"""Отчёт, собранный во время стирания пациента, не остаётся на диске (ревью Н4).

`erase_patient` снимает файлы отчётов по строкам `report_jobs`, а у задачи в
работе имени файла ещё нет. Воркер дописывает PDF, не находит строки задачи и
прежде молча выходил: файл с ФИО и клиническими данными оставался без строки, и
его не нашла бы ни ночная очистка, ни стирание.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import Any

import worker.reports.task as task


class _Session:
    async def commit(self) -> None:
        return None


async def test_file_is_removed_when_the_job_row_vanished(tmp_path, monkeypatch) -> None:
    job_id = str(uuid.uuid4())
    # Первое чтение — строка есть (задача начата), второе — пациента уже стёрли.
    rows: list[Any] = [SimpleNamespace(id=job_id), None]

    async def get(_session: Any, _id: uuid.UUID) -> Any:
        return rows.pop(0)

    async def mark_running(_session: Any, *, job: Any) -> None:
        return None

    @asynccontextmanager
    async def session_factory():
        yield _Session()

    monkeypatch.setattr(task.jobs_repo, "get", get)
    monkeypatch.setattr(task.jobs_repo, "mark_running", mark_running)
    monkeypatch.setattr(task, "get_sessionmaker", lambda: session_factory)
    monkeypatch.setattr(
        task,
        "Settings",
        lambda: SimpleNamespace(reports_dir=str(tmp_path), report_link_ttl_hours=1),
    )
    monkeypatch.setattr(task, "render_html", lambda report, title: "<html></html>")
    monkeypatch.setattr(task, "html_to_pdf", lambda html: b"%PDF")

    result = await task.render_report({}, job_id, {})

    assert result == ""
    assert list(tmp_path.iterdir()) == [], "PDF без строки задачи остался на диске"
