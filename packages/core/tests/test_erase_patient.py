"""Физическое удаление данных пациента (раздел 11 ТЗ, `core.tools.erase_patient`).

Единственное исключение из правила 4: человек вправе потребовать стереть данные
ребёнка, и «мягко удалённая» запись такую просьбу не выполняет.

Тесты здесь особенно важны: команда необратима. Ошибка в ней — это либо чужая
стёртая история болезни, либо «стёрли» вместо «стёрли не всё».
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select

import core.tools.erase_patient as erase_module
from core.config import get_settings
from core.db import get_engine, get_sessionmaker
from core.models import (
    Attachment,
    AuditLog,
    Invitation,
    KetoneLog,
    ParentPatient,
    Patient,
    ReportJob,
    User,
)
from core.models.enums import (
    AttachmentOwnerKind,
    DiarySource,
    KetoneMethod,
    ReportJobStatus,
    Sex,
    UserRole,
)
from core.repositories import diary as diary_repo
from core.repositories import invitations as invitations_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo
from core.tools.erase_patient import erase, patient_scoped_tables, retry_files

pytestmark = pytest.mark.asyncio


def _report_name(stored: str) -> str:
    return f"report-{Path(stored).stem}.pdf"


def _put_files(stored: str) -> None:
    """Четыре байта на диск: выносить это в поток ради правила о блокировке
    цикла — шум. В самой команде обращения к диску вынесены (ASYNC240)."""

    files_dir = Path(get_settings().attachments_dir)
    reports_dir = Path(get_settings().reports_dir)
    files_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)
    (files_dir / stored).write_bytes(b"\x89PNG")
    (reports_dir / _report_name(stored)).write_bytes(b"%PDF")


class TestScopeDiscovery:
    """Список таблиц выводится из метаданных, а не пишется руками: иначе новая
    таблица молча выпала бы из удаления."""

    def test_covers_direct_and_indirect_links(self):
        tables = patient_scoped_tables()

        # Прямая связь — колонка patient_id.
        assert "ketone_logs" in tables
        assert "prescriptions" in tables
        assert "menus" in tables

        # Косвенная: позиции меню ссылаются на меню, а не на пациента.
        assert "menu_items" in tables

        # Приглашение второго родителя к ребёнку несёт его почту (ADR-0032) и
        # стирается вместе с ребёнком — по той же колонке patient_id.
        assert "invitations" in tables

        # Коды доступа семьи (ADR-0040) — тоже по patient_id: код открывает
        # карту ребёнка, и пережить её удаление он не должен.
        assert "access_codes" in tables

        # Дети идут раньше родителей, иначе внешние ключи не дадут удалить.
        assert tables.index("menu_items") < tables.index("menus")

    def test_keeps_shared_and_audit_tables(self):
        tables = patient_scoped_tables()

        # Журнал не удаляется, а очищается: он след того, кто действовал.
        assert "audit_log" not in tables
        # Общие справочники к пациенту не относятся.
        assert "users" not in tables
        assert "products" not in tables
        assert "recipes" not in tables


class TestErase:
    """Тест ведёт СВОЮ сессию, а не фикстурную.

    Фикстура держит тест во внешней транзакции с откатом — данные, записанные
    через неё, не видны другому подключению. Команда работает своей сессией и
    коммитит, поэтому увидеть подготовленное она может только из настоящей
    транзакции. Отсюда и уборка в `finally`: неудачный прогон иначе оставил бы
    в базе разработчика половину пациента.
    """

    @pytest_asyncio.fixture(autouse=True)
    async def _fresh_engine(self):
        """Движок команды — кэш на процесс, а цикл событий у каждого теста свой.

        Соединение, открытое в прошлом тесте, во втором падает
        «attached to a different loop» — ровно та причина, по которой в
        conftest движок фикстуры создаётся заново на каждый тест.
        """

        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        yield
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

    async def _cleanup(self, patient_id, parent_id, stored: str) -> None:
        async with get_sessionmaker()() as s:
            await s.execute(delete(ReportJob).where(ReportJob.patient_id == patient_id))
            await s.execute(delete(ParentPatient).where(ParentPatient.patient_id == patient_id))
            await s.execute(delete(KetoneLog).where(KetoneLog.patient_id == patient_id))
            await s.execute(delete(Attachment).where(Attachment.owner_id == patient_id))
            await s.execute(delete(Invitation).where(Invitation.patient_id == patient_id))
            await s.execute(delete(AuditLog).where(AuditLog.entity_id == patient_id))
            await s.execute(delete(Patient).where(Patient.id == patient_id))
            await s.execute(delete(User).where(User.id == parent_id))
            await s.commit()
        (Path(get_settings().attachments_dir) / stored).unlink(missing_ok=True)
        (Path(get_settings().reports_dir) / _report_name(stored)).unlink(missing_ok=True)

    async def _seed(self, stored: str) -> tuple[uuid.UUID, uuid.UUID]:
        """Пациент с вложением и собранным PDF-отчётом — оба файла на диске."""

        async with get_sessionmaker()() as s:
            parent = await users_repo.create(
                s,
                role=UserRole.PARENT,
                full_name="Родитель на удаление",
                email=f"erase-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            patient = await patients_repo.create(
                s, full_name="Ребёнок на удаление", birth_date=date(2018, 5, 1), sex=Sex.M
            )
            await patients_repo.link_parent(s, parent_id=parent.id, patient_id=patient.id)
            s.add(
                Attachment(
                    owner_kind=AttachmentOwnerKind.PATIENT,
                    owner_id=patient.id,
                    filename="выписка.png",
                    stored_name=stored,
                    mime="image/png",
                    size_bytes=10,
                    sha256="0" * 64,
                    uploaded_by=parent.id,
                )
            )
            s.add(
                ReportJob(
                    patient_id=patient.id,
                    requested_by=parent.id,
                    period_start=date(2026, 9, 1),
                    period_end=date(2026, 9, 30),
                    status=ReportJobStatus.DONE,
                    file_name=_report_name(stored),
                )
            )
            await s.commit()
            ids = (patient.id, parent.id)
        _put_files(stored)
        return ids

    async def test_erases_rows_files_and_scrubs_audit(self, tmp_path):
        stored = f"{uuid.uuid4().hex}.png"

        async with get_sessionmaker()() as s:
            parent = await users_repo.create(
                s,
                role=UserRole.PARENT,
                full_name="Родитель на удаление",
                email=f"erase-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            patient = await patients_repo.create(
                s,
                full_name="Ребёнок на удаление",
                birth_date=date(2018, 5, 1),
                sex=Sex.M,
            )
            await patients_repo.link_parent(s, parent_id=parent.id, patient_id=patient.id)
            await diary_repo.create(
                s,
                KetoneLog,
                patient_id=patient.id,
                occurred_at=datetime.now(UTC),
                source=DiarySource.WEB,
                created_by=parent.id,
                fields={"value": 3.2, "method": KetoneMethod.BLOOD},
            )
            s.add(
                Attachment(
                    owner_kind=AttachmentOwnerKind.PATIENT,
                    owner_id=patient.id,
                    filename="выписка.png",
                    stored_name=stored,
                    mime="image/png",
                    size_bytes=10,
                    sha256="0" * 64,
                    uploaded_by=parent.id,
                )
            )
            # Непринятое приглашение второго родителя несёт его почту (ADR-0032) и
            # обязано уйти вместе с ребёнком — раньше самого пациента, иначе FK.
            await invitations_repo.create(
                s,
                email=f"second-{uuid.uuid4().hex[:10]}@example.com",
                role=UserRole.PARENT,
                token=invitations_repo.generate_token(),
                created_by=parent.id,
                patient_id=patient.id,
            )
            # Собранный PDF-отчёт: ФИО и клинические данные на диске (Н4). Ночная
            # очистка ищет его по строке `report_jobs`, которой после стирания нет.
            s.add(
                ReportJob(
                    patient_id=patient.id,
                    requested_by=parent.id,
                    period_start=date(2026, 9, 1),
                    period_end=date(2026, 9, 30),
                    status=ReportJobStatus.DONE,
                    file_name=_report_name(stored),
                )
            )
            # Запись журнала с клинической нагрузкой: её надо очистить, а не удалить.
            s.add(
                AuditLog(
                    user_id=parent.id,
                    action="create",
                    entity="patients",
                    entity_id=patient.id,
                    after={"ratio": 4.0, "kcal_per_day": 1200},
                )
            )
            await s.commit()
            patient_id, parent_id = patient.id, parent.id

        files_dir = Path(get_settings().attachments_dir)
        reports_dir = Path(get_settings().reports_dir)
        _put_files(stored)

        try:
            archive = await erase(patient_id, archive_dir=tmp_path)

            async with get_sessionmaker()() as s:
                # 1. Ни пациента, ни его записей.
                assert await s.get(Patient, patient_id) is None
                assert (
                    await s.scalar(
                        select(func.count())
                        .select_from(KetoneLog)
                        .where(KetoneLog.patient_id == patient_id)
                    )
                ) == 0
                assert (
                    await s.scalar(
                        select(func.count())
                        .select_from(Attachment)
                        .where(Attachment.owner_id == patient_id)
                    )
                ) == 0
                assert (
                    await s.scalar(
                        select(func.count())
                        .select_from(Invitation)
                        .where(Invitation.patient_id == patient_id)
                    )
                ) == 0, "приглашение к ребёнку с почтой второго родителя стирается с ним"

                # 2. Журнал: строка осталась, клиническая нагрузка стёрта.
                entry = await s.scalar(
                    select(AuditLog).where(
                        AuditLog.entity_id == patient_id, AuditLog.action == "create"
                    )
                )
                assert entry is not None, "след действия остаётся"
                assert entry.after is None, "назначения из журнала обязаны исчезнуть"

                # 3. Сама операция записана (раздел 11 ТЗ).
                assert (
                    await s.scalar(
                        select(AuditLog).where(
                            AuditLog.action == "erase_patient",
                            AuditLog.entity_id == patient_id,
                        )
                    )
                ) is not None

            # 4. Байты вложения сняты с диска: дамп базы их не вернёт.
            assert not (files_dir / stored).exists()
            # И собранный отчёт тоже (Н4): иначе он пережил бы «физическое
            # удаление» навсегда — ночная очистка ищет по стёртым строкам.
            assert not (reports_dir / _report_name(stored)).exists()
            # Всё снято — списка «добить» не остаётся.
            assert list(tmp_path.glob("*.files.json")) == []

            # 5. Архив написан до удаления и читается.
            data = json.loads(archive.read_text(encoding="utf-8"))
            assert data["patients"][0]["full_name"] == "Ребёнок на удаление"
            assert data["ketone_logs"], "замеры обязаны попасть в архив"
        finally:
            await self._cleanup(patient_id, parent_id, stored)

    async def test_unknown_patient_changes_nothing(self, tmp_path):
        with pytest.raises(SystemExit):
            await erase(uuid.uuid4(), archive_dir=tmp_path)

        # Архива тоже не появляется: ошибка в идентификаторе не повод создавать
        # файл с именем чужого пациента.
        assert list(tmp_path.iterdir()) == []

    async def test_failed_commit_keeps_files(self, tmp_path, monkeypatch):
        """Н12: файлы снимаются только после коммита. Коммит не прошёл — строки
        на месте, и документы обязаны остаться на диске вместе с ними."""

        stored = f"{uuid.uuid4().hex}.png"
        patient_id, parent_id = await self._seed(stored)

        async def broken_delete(*args, **kwargs):
            raise RuntimeError("сбой посреди удаления строк")

        monkeypatch.setattr(erase_module, "_delete_rows", broken_delete)
        try:
            with pytest.raises(RuntimeError):
                await erase(patient_id, archive_dir=tmp_path)

            assert (Path(get_settings().attachments_dir) / stored).exists()
            assert (Path(get_settings().reports_dir) / _report_name(stored)).exists()
            # Списка «добить» нет: по нему повтор стёр бы файлы живой карты.
            assert list(tmp_path.glob("*.files.json")) == []
            async with get_sessionmaker()() as s:
                assert await s.get(Patient, patient_id) is not None
        finally:
            await self._cleanup(patient_id, parent_id, stored)

    async def test_unremoved_file_is_left_for_retry(self, tmp_path, monkeypatch):
        """Файл, не снятый после коммита, не теряется молча: он остаётся в списке
        рядом с архивом, и `--retry-files` его добивает."""

        stored = f"{uuid.uuid4().hex}.png"
        patient_id, parent_id = await self._seed(stored)
        report = Path(get_settings().reports_dir) / _report_name(stored)

        real_unlink = Path.unlink

        def flaky_unlink(self, *args, **kwargs):
            if self.name == report.name:
                raise PermissionError("том отчётов только для чтения")
            return real_unlink(self, *args, **kwargs)

        try:
            monkeypatch.setattr(Path, "unlink", flaky_unlink)
            await erase(patient_id, archive_dir=tmp_path)
            monkeypatch.setattr(Path, "unlink", real_unlink)

            assert not (Path(get_settings().attachments_dir) / stored).exists()
            assert report.exists()
            [pending] = list(tmp_path.glob("*.files.json"))
            data = json.loads(pending.read_text(encoding="utf-8"))
            assert data["files"] == [str(report.resolve())]

            assert await retry_files(pending) == []
            assert not report.exists()
            assert not pending.exists(), "добитый список не нужен"
        finally:
            monkeypatch.setattr(Path, "unlink", real_unlink)
            await self._cleanup(patient_id, parent_id, stored)

    async def test_retry_refuses_while_patient_exists(self, tmp_path):
        """Список от прерванного запуска, где коммита не было: пациент жив, и его
        файлы трогать нельзя."""

        stored = f"{uuid.uuid4().hex}.png"
        patient_id, parent_id = await self._seed(stored)
        attachment = (Path(get_settings().attachments_dir) / stored).resolve()
        pending = tmp_path / "erase-stale.files.json"
        pending.write_text(
            json.dumps({"patient_id": str(patient_id), "files": [str(attachment)]}),
            encoding="utf-8",
        )
        try:
            with pytest.raises(SystemExit):
                await retry_files(pending)
            assert attachment.exists()
        finally:
            await self._cleanup(patient_id, parent_id, stored)

    async def test_retry_does_not_leave_the_data_dirs(self, tmp_path):
        """Путь из списка на диске не уводит за пределы вложений и отчётов."""

        outside = tmp_path / "чужой.txt"
        outside.write_text("не трогать", encoding="utf-8")
        pending = tmp_path / "erase-x.files.json"
        pending.write_text(
            json.dumps({"patient_id": str(uuid.uuid4()), "files": [str(outside)]}),
            encoding="utf-8",
        )

        assert await retry_files(pending) == []
        assert outside.exists()
