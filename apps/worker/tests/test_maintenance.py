"""Ночная уборка файлов (ADR-0008, ADR-0013).

Тест ведёт свою сессию, а не фикстурную: задача работает своей и коммитит, и
из внешней транзакции с откатом она подготовленных данных просто не увидит.
Отсюда и уборка в `finally`.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest_asyncio
from sqlalchemy import delete, select

from core.config import get_settings
from core.db import get_engine, get_sessionmaker
from core.models import Attachment, Patient, ReportJob, User
from core.models.enums import AttachmentOwnerKind, ReportJobStatus, Sex, UserRole
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo
from worker.maintenance import _remove, purge_files


class TestRemove:
    """Снятие байтов с диска."""

    def test_removes_existing_and_survives_missing(self, tmp_path):
        (tmp_path / "есть.png").write_bytes(b"x")

        removed = _remove(str(tmp_path), ["есть.png", "нет.png"])

        # Отсутствующий файл — не ошибка: том могли пересоздать или
        # восстановить из бэкапа. Иначе одна пропажа останавливала бы уборку.
        assert removed == 1
        assert not (tmp_path / "есть.png").exists()

    def test_refuses_to_leave_the_directory(self, tmp_path):
        outside = tmp_path.parent / f"чужой-{uuid.uuid4().hex[:8]}.png"
        outside.write_bytes(b"x")
        try:
            assert _remove(str(tmp_path / "vol"), [f"../{outside.name}"]) == 0
            assert outside.exists(), "имя из базы не должно выводить за пределы тома"
        finally:
            outside.unlink(missing_ok=True)


class TestPurgeFiles:
    @pytest_asyncio.fixture(autouse=True)
    async def _fresh_engine(self):
        """Движок задачи кэширован на процесс, а цикл событий у каждого теста
        свой — соединение из прошлого теста падает «attached to a different
        loop» (та же причина, что в conftest пакета core)."""

        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        yield
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

    async def test_purges_old_and_spares_fresh(self):
        settings = get_settings()
        files_dir = Path(settings.attachments_dir)
        reports_dir = Path(settings.reports_dir)
        # Подготовка тома на диске — это и есть предмет теста; выносить два
        # mkdir в поток ради правила о блокировке цикла было бы шумом. В самой
        # задаче обращения к диску вынесены (ASYNC240).
        files_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240
        reports_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240

        old_name = f"{uuid.uuid4().hex}.png"
        fresh_name = f"{uuid.uuid4().hex}.png"
        expired_report = f"{uuid.uuid4().hex}.pdf"
        live_report = f"{uuid.uuid4().hex}.pdf"
        for name, directory in (
            (old_name, files_dir),
            (fresh_name, files_dir),
            (expired_report, reports_dir),
            (live_report, reports_dir),
        ):
            (directory / name).write_bytes(b"x")

        now = datetime.now(UTC)
        long_ago = now - timedelta(days=settings.attachment_purge_days + 1)

        async with get_sessionmaker()() as session:
            author = await users_repo.create(
                session,
                role=UserRole.PARENT,
                full_name="Родитель для уборки",
                email=f"purge-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            patient = await patients_repo.create(
                session,
                full_name="Ребёнок для уборки",
                birth_date=date(2018, 3, 1),
                sex=Sex.M,
            )

            def attachment(stored: str, deleted_at: datetime) -> Attachment:
                return Attachment(
                    owner_kind=AttachmentOwnerKind.PATIENT,
                    owner_id=patient.id,
                    filename="выписка.png",
                    stored_name=stored,
                    mime="image/png",
                    size_bytes=1,
                    sha256="0" * 64,
                    uploaded_by=author.id,
                    deleted_at=deleted_at,
                )

            session.add(attachment(old_name, long_ago))
            session.add(attachment(fresh_name, now - timedelta(days=1)))

            def job(file_name: str, expires_at: datetime) -> ReportJob:
                return ReportJob(
                    patient_id=patient.id,
                    requested_by=author.id,
                    period_start=date(2026, 8, 1),
                    period_end=date(2026, 8, 31),
                    status=ReportJobStatus.DONE,
                    file_name=file_name,
                    expires_at=expires_at,
                )

            session.add(job(expired_report, now - timedelta(hours=1)))
            session.add(job(live_report, now + timedelta(hours=5)))
            await session.commit()
            patient_id, author_id = patient.id, author.id

        try:
            result = await purge_files({})

            # 1. Убрано ровно просроченное.
            assert not (files_dir / old_name).exists()
            assert not (reports_dir / expired_report).exists()

            # 2. Свежее удаление и живая ссылка не тронуты. Это и есть смысл
            #    отсрочки: случайно удалённую выписку ещё можно вернуть.
            assert (files_dir / fresh_name).exists()
            assert (reports_dir / live_report).exists()

            assert result["attachments"] >= 1
            assert result["reports"] >= 1

            async with get_sessionmaker()() as session:
                purged = await session.scalar(
                    select(ReportJob).where(ReportJob.file_name == expired_report)
                )
                assert purged is None, "имя файла обнуляется — это отметка об уборке"

                rows = {
                    row.stored_name: row
                    for row in await session.scalars(
                        select(Attachment).where(Attachment.owner_id == patient_id)
                    )
                }
                assert rows[old_name].purged_at is not None
                assert rows[fresh_name].purged_at is None
                # Строки остаются: по ним видно, что документ был (правило 4).
                assert len(rows) == 2

            # 3. Повторный прогон не находит того же второй раз.
            again = await purge_files({})
            assert again == {"reports": 0, "attachments": 0}
        finally:
            async with get_sessionmaker()() as session:
                await session.execute(delete(Attachment).where(Attachment.owner_id == patient_id))
                await session.execute(delete(ReportJob).where(ReportJob.patient_id == patient_id))
                await session.execute(delete(Patient).where(Patient.id == patient_id))
                await session.execute(delete(User).where(User.id == author_id))
                await session.commit()
            for name, directory in (
                (old_name, files_dir),
                (fresh_name, files_dir),
                (expired_report, reports_dir),
                (live_report, reports_dir),
            ):
                (directory / name).unlink(missing_ok=True)
