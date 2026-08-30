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

from core.config import get_settings
from core.db import get_engine, get_sessionmaker
from core.models import Attachment, AuditLog, KetoneLog, Patient, User
from core.models.enums import (
    AttachmentOwnerKind,
    DiarySource,
    KetoneMethod,
    Sex,
    UserRole,
)
from core.repositories import diary as diary_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo
from core.tools.erase_patient import erase, patient_scoped_tables

pytestmark = pytest.mark.asyncio


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
            await s.execute(delete(KetoneLog).where(KetoneLog.patient_id == patient_id))
            await s.execute(delete(Attachment).where(Attachment.owner_id == patient_id))
            await s.execute(delete(AuditLog).where(AuditLog.entity_id == patient_id))
            await s.execute(delete(Patient).where(Patient.id == patient_id))
            await s.execute(delete(User).where(User.id == parent_id))
            await s.commit()
        (Path(get_settings().attachments_dir) / stored).unlink(missing_ok=True)

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
        # Четыре байта на диск: выносить это в поток ради правила о блокировке
        # цикла — шум. В самой команде обращения к диску вынесены (ASYNC240).
        files_dir.mkdir(parents=True, exist_ok=True)  # noqa: ASYNC240
        (files_dir / stored).write_bytes(b"\x89PNG")

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
