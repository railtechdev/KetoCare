"""Три свойства компенсации, видимые только на настоящих коммитах (ADR-0035).

Общая фикстура API отдаёт приложению ТУ ЖЕ сессию, что и тесту, и её коммит от
теста ничем не отделён. Поэтому на ней ненаблюдаемо ровно то, ради чего
компенсация написана: ответ на ключ, лежащий в базе к моменту постановки
задачи, перечитка разговора под блокировкой (чужая запись видна и без неё) и
снятие брони при исчезнувшем разговоре. Тест, который проходит и с
исправлением, и без него, — ложное ручательство; три таких были написаны и
удалены, вместо них этот.

Здесь приложение ходит в базу своим `sessionmaker`, тест и «воркер» — своими.
Внешней транзакции с откатом нет, поэтому всё записанное убирается в `finally`.

Про первое свойство важно знать, что именно наблюдаемо. Сам порядок «`finish`
до `commit`» на успешном пути не проверяется ничем: зависимость `get_session`
коммитит сессию ещё раз после ручки, и ответ, записанный после явного коммита,
к концу запроса всё равно оказывается в базе. Наблюдаемо ОКНО между явным
коммитом и постановкой задачи — сетевым вызовом длиной в секунды под отказом:
строка ключа, прочитанная изнутри окна, обязана уже нести ответ, иначе всё,
что оборвёт запрос здесь, оставит бронь без ответа на сутки.
"""

from __future__ import annotations

import itertools
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select

from api.main import create_app
from api.security import create_token
from api.services import queue as queue_service
from core.db import get_engine, get_sessionmaker
from core.models import AiConversation, AuditLog, IdempotencyKey, ParentPatient, Patient, User
from core.models.enums import AiConversationChannel, Sex, UserRole
from core.repositories import ai_conversations as conversations_repo
from core.repositories import patients as patients_repo
from core.repositories import users as users_repo
from core.schemas.ai_conversations import ASSISTANT_UNAVAILABLE, AssistantMessage, new_message

pytestmark = pytest.mark.asyncio

URL = "/api/v1/ai/assistant/messages"

#: Свой диапазон адресов: ключ ограничения частоты — адрес клиента (см. `client`
#: в conftest), и делить окно с тестами на общей фикстуре незачем.
_host_seq = itertools.count(1)


@asynccontextmanager
async def _app_client() -> AsyncIterator[AsyncClient]:
    """Приложение БЕЗ подмены `get_session`: оно ходит в базу само."""

    number = next(_host_seq)
    transport = ASGITransport(
        app=create_app(), client=(f"10.1.{number // 256 % 256}.{number % 256}", 12345)
    )
    async with AsyncClient(transport=transport, base_url="http://test") as http_client:
        yield http_client


def _headers(user_id: uuid.UUID, key: str) -> dict[str, str]:
    token = create_token(user_id=user_id, role=UserRole.PARENT, token_type="access")
    return {"Authorization": f"Bearer {token}", "Idempotency-Key": key}


async def _ask(
    http: AsyncClient,
    *,
    user_id: uuid.UUID,
    patient_id: uuid.UUID,
    key: str,
    text: str = "куда записать кетоны",
    conversation_id: uuid.UUID | None = None,
):
    body: dict[str, Any] = {"patient_id": str(patient_id), "text": text}
    if conversation_id is not None:
        body["conversation_id"] = str(conversation_id)
    return await http.post(URL, json=body, headers=_headers(user_id, key))


class TestAssistantIdempotencyOnRealSession:
    @pytest_asyncio.fixture(autouse=True)
    async def _fresh_engine(self) -> AsyncIterator[None]:
        """Движок приложения кэширован на процесс, а цикл событий у теста свой."""

        get_engine.cache_clear()
        get_sessionmaker.cache_clear()
        yield
        await get_engine().dispose()
        get_engine.cache_clear()
        get_sessionmaker.cache_clear()

    @pytest_asyncio.fixture
    async def parent(self, _fresh_engine: None) -> AsyncIterator[tuple[uuid.UUID, uuid.UUID]]:
        async with get_sessionmaker()() as session:
            user = await users_repo.create(
                session,
                role=UserRole.PARENT,
                full_name="Родитель на настоящей сессии",
                email=f"real-session-{uuid.uuid4().hex[:10]}@example.com",
                password_hash="x",
            )
            patient = await patients_repo.create(
                session,
                full_name="Ребёнок на настоящей сессии",
                birth_date=date(2018, 5, 1),
                sex=Sex.M,
            )
            await patients_repo.link_parent(session, parent_id=user.id, patient_id=patient.id)
            await session.commit()
            user_id, patient_id = user.id, patient.id

        try:
            yield user_id, patient_id
        finally:
            async with get_sessionmaker()() as session:
                await session.execute(
                    delete(AiConversation).where(AiConversation.patient_id == patient_id)
                )
                await session.execute(
                    delete(IdempotencyKey).where(IdempotencyKey.user_id == user_id)
                )
                # Аудит ссылается на пользователя внешним ключом: строка, записанная
                # когда-нибудь позже, роняла бы уборку, а не тест.
                await session.execute(delete(AuditLog).where(AuditLog.user_id == user_id))
                await session.execute(
                    delete(ParentPatient).where(ParentPatient.patient_id == patient_id)
                )
                await session.execute(delete(Patient).where(Patient.id == patient_id))
                await session.execute(delete(User).where(User.id == user_id))
                await session.commit()

    async def _key_row(self, key: str) -> IdempotencyKey | None:
        async with get_sessionmaker()() as session:
            found: IdempotencyKey | None = await session.scalar(
                select(IdempotencyKey).where(IdempotencyKey.key == key)
            )
            return found

    async def _conversations(self, patient_id: uuid.UUID) -> int:
        async with get_sessionmaker()() as session:
            total = await session.scalar(
                select(func.count())
                .select_from(AiConversation)
                .where(AiConversation.patient_id == patient_id)
            )
        return int(total or 0)

    async def _messages(self, conversation_id: uuid.UUID) -> dict[int, AssistantMessage]:
        async with get_sessionmaker()() as session:
            conversation = await conversations_repo.get(session, conversation_id)
            assert conversation is not None
            return {
                message.seq: message for message in conversations_repo.messages_of(conversation)
            }

    async def test_the_answer_is_in_place_while_the_request_is_in_flight(
        self, parent, monkeypatch
    ) -> None:
        """Ответ на ключ коммитится вместе с перепиской, а не после неё.

        После явного коммита ручка идёт в очередь — сетевой вызов, под отказом
        это секунды. Всё, что оборвёт запрос в этом окне (перезапуск, разрыв,
        падение процесса), оставит закоммиченную бронь БЕЗ ответа, а на неё
        повтор получает «такой же запрос ещё выполняется» сутки, пока ключ не
        просрочится. Поэтому строка ключа читается изнутри окна, независимой
        сессией: к этому моменту ответ обязан быть в базе.

        Чем это НЕ проверяется, и почему. Порядок вызовов на успешном пути
        ненаблюдаем: `get_session` коммитит сессию ещё раз после ручки, и
        запоздавший ответ всё равно доезжает. Повтором изнутри окна — тоже: при
        неверном порядке он встаёт на блокировку строки ключа и ждёт первый
        запрос, а тот ждёт его; тест не краснеет, а висит, что в CI хуже
        падения.
        """

        user_id, patient_id = parent
        key = str(uuid.uuid4())
        in_flight: list[tuple[int | None, dict[str, Any] | None]] = []

        async def look_at_the_key(task: str, *args: object) -> None:
            row = await self._key_row(key)
            in_flight.append((row.response_status, row.response_body) if row else (None, None))

        monkeypatch.setattr(queue_service, "enqueue", look_at_the_key)

        async with _app_client() as http:
            first = await _ask(http, user_id=user_id, patient_id=patient_id, key=key)

        assert first.status_code == 202, first.text
        assert in_flight == [(202, first.json())]
        assert await self._conversations(patient_id) == 1

    async def test_compensation_keeps_what_was_written_meanwhile(self, parent, monkeypatch) -> None:
        """Компенсация пишет по перечитанному разговору, а не по своему снимку.

        `messages` переписывается целиком, а объект в памяти коммит не
        протухает (`expire_on_commit=False`): без `populate_existing` пометка
        «не удалось» стёрла бы ответ, дописанный воркером за те секунды, что
        запрос ждал отказа недоступной очереди.
        """

        user_id, patient_id = parent
        async with get_sessionmaker()() as session:
            conversation = await conversations_repo.create(
                session, user_id=user_id, patient_id=patient_id, channel=AiConversationChannel.WEB
            )
            await conversations_repo.append(
                session,
                conversation=conversation,
                messages=[
                    new_message(seq=0, role="user", text="прошлый вопрос"),
                    new_message(seq=1, role="assistant", status="pending"),
                ],
            )
            await session.commit()
            conversation_id = conversation.id

        answer = "Кетоны записываются в дневнике, раздел «Кетоны»."

        async def answer_then_fail(task: str, *args: object) -> None:
            async with get_sessionmaker()() as worker:
                locked = await conversations_repo.get_for_update(worker, conversation_id)
                assert locked is not None
                await conversations_repo.replace_message(
                    worker,
                    conversation=locked,
                    message=new_message(seq=1, role="assistant", text=answer),
                )
                await worker.commit()
            raise RuntimeError("очередь недоступна")

        monkeypatch.setattr(queue_service, "enqueue", answer_then_fail)

        async with _app_client() as http:
            response = await _ask(
                http,
                user_id=user_id,
                patient_id=patient_id,
                key=str(uuid.uuid4()),
                text="а вес куда",
                conversation_id=conversation_id,
            )

        assert response.status_code == 500, response.text
        messages = await self._messages(conversation_id)
        assert sorted(messages) == [0, 1, 2, 3]
        assert (messages[1].text, messages[1].status) == (answer, "done")
        assert (messages[3].text, messages[3].status) == (ASSISTANT_UNAVAILABLE, "failed")

    async def test_key_is_released_when_the_conversation_is_gone(self, parent, monkeypatch) -> None:
        """Бронь снимается и тогда, когда переписывать уже нечего.

        Разговор мог исчезнуть между коммитом и компенсацией (физическое
        удаление по требованию). Оставленная бронь отвечала бы повтору «принято»
        сутки — и указывала бы на разговор, которого нет.
        """

        user_id, patient_id = parent
        key = str(uuid.uuid4())
        erased: list[uuid.UUID] = []

        async def erase_then_fail(task: str, *args: object) -> None:
            if erased:
                return
            conversation_id = uuid.UUID(str(args[0]))
            erased.append(conversation_id)
            async with get_sessionmaker()() as other:
                await other.execute(
                    delete(AiConversation).where(AiConversation.id == conversation_id)
                )
                await other.commit()
            raise RuntimeError("очередь недоступна")

        monkeypatch.setattr(queue_service, "enqueue", erase_then_fail)

        async with _app_client() as http:
            failed = await _ask(http, user_id=user_id, patient_id=patient_id, key=key)
            assert failed.status_code == 500, failed.text
            assert await self._key_row(key) is None, "бронь осталась за несостоявшимся запросом"

            repeat = await _ask(http, user_id=user_id, patient_id=patient_id, key=key)

        assert repeat.status_code == 202, repeat.text
        assert uuid.UUID(repeat.json()["conversation_id"]) != erased[0]
