"""Хранилище привязок бота (ADR-0009, ADR-0048).

Здесь лежит второй фактор доступа — секрет привязки, выданный API один раз при
`/start <код>`. Восстановить его нельзя: в БД хранится только sha256, и
восстановление по сервисному токену не предусмотрено намеренно — оно вернуло бы
схему к одному фактору.

Отсюда следствие: хранилище обязано переживать перезапуск бота. Память процесса
не годится — после каждого деплоя все семьи оказались бы отвязаны и должны были
бы заново просить код в кабинете.

С ADR-0048 чат ведёт нескольких детей: у каждого своя привязка и свой секрет, а
чат помнит, какой ребёнок выбран сейчас. Каждая запись дневника уходит с
секретом ВЫБРАННОГО ребёнка — токен, который он открывает, сужен до этого
ребёнка, и записать «не тому» сервер не даст даже при ошибке здесь.

Раскладка в Redis:

- `bot:bindings:<chat>` — хеш «patient_id → привязка в JSON»;
- `bot:active:<chat>` — patient_id выбранного ребёнка;
- `bot:language:<chat>` — копия языка человека (ADR-0052), с коротким сроком;
- `bot:binding:<chat>` — прежний хеш одной привязки (до ADR-0048). Читается и
  переносится в новую раскладку при первом обращении, чтобы обновление бота не
  отвязало ни одной семьи.

Прежний ключ **не удаляется и продолжает вестись** — ради отката бота на
прежнюю версию (ADR-0048, «Откат»): `put` дублирует в него последнюю привязку,
и откатанный бот продолжает работать хотя бы с последним подключённым ребёнком.
Перенос из него никогда не перезаписывает запись новой раскладки: прежний ключ
копируется, только если записи этого ребёнка в новой раскладке нет. Иначе
устаревший секрет из прежнего ключа затирал бы свежий, полученный после
повторной привязки.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from typing import Any, cast

from redis.asyncio import Redis

_LEGACY_PREFIX = "bot:binding:"
_BINDINGS_PREFIX = "bot:bindings:"
_ACTIVE_PREFIX = "bot:active:"
_LANGUAGE_PREFIX = "bot:language:"

#: Сколько бот верит своей копии языка привязанного чата (ADR-0052). Пять
#: минут: выбор, сделанный в Mini App, доходит до бота к следующему делу, а
#: сервер получает один запрос на чат за пять минут, а не на каждое сообщение.
LANGUAGE_TTL_S = 300


@dataclass(frozen=True, slots=True)
class StoredLanguage:
    """Копия языка чата (ADR-0052)."""

    language: str
    #: Выбран кнопкой, а не взят из Telegram: при привязке он сильнее умолчания.
    explicit: bool = False
    #: Когда копия сверена с сервером (секунды эпохи). None — не сверялась.
    checked_at: float | None = None
    #: Выбор ещё не дошёл до сервера (сбой связи): при следующей сверке бот
    #: отправит его, а не затрёт прежним значением с сервера.
    pending: bool = False


@dataclass(frozen=True, slots=True)
class Binding:
    link_id: uuid.UUID
    secret: str
    patient_id: uuid.UUID
    patient_name: str
    #: Имя без фамилии — им бот называет ребёнка, когда чат ведёт двоих. У
    #: записей, заведённых до ADR-0048, его нет, и оно выводится из полного
    #: имени по тому же правилу, что на сервере («Имя и фамилия»).
    patient_first_name: str = ""
    #: Когда чат получил этого ребёнка (ISO 8601, UTC). По нему дети стоят в
    #: том же порядке, что в Mini App (там — по `linked_at` привязки). У
    #: перенесённых из прежней раскладки его нет — они старше всех и стоят первыми.
    linked_at: str = ""

    @property
    def first_name(self) -> str:
        if self.patient_first_name:
            return self.patient_first_name
        parts = self.patient_name.split()
        return parts[0] if parts else self.patient_name


def _to_json(binding: Binding) -> str:
    return json.dumps(
        {
            "link_id": str(binding.link_id),
            "secret": binding.secret,
            "patient_id": str(binding.patient_id),
            "patient_name": binding.patient_name,
            "patient_first_name": binding.patient_first_name,
            "linked_at": binding.linked_at,
        },
        ensure_ascii=False,
    )


def _from_mapping(raw: dict[str, Any]) -> Binding:
    return Binding(
        link_id=uuid.UUID(str(raw["link_id"])),
        secret=str(raw["secret"]),
        patient_id=uuid.UUID(str(raw["patient_id"])),
        patient_name=str(raw["patient_name"]),
        patient_first_name=str(raw.get("patient_first_name") or ""),
        linked_at=str(raw.get("linked_at") or ""),
    )


class BindingStore:
    """Привязки чата — по одной на ребёнка — и выбранный ребёнок.

    Без срока жизни: привязка живёт до отзыва.

    `cast` повсюду из-за типов redis-py: методы объявлены общими для sync и
    async клиентов и возвращают `Awaitable[T] | T`. У асинхронного клиента это
    всегда первое, но статически это не выражено.
    """

    def __init__(self, redis: Redis) -> None:
        self._redis = redis

    async def all(self, chat_id: int) -> list[Binding]:
        """Все дети чата в постоянном порядке — по времени привязки, как в Mini App."""

        await self._migrate_legacy(chat_id)
        raw: dict[Any, Any] = await cast(
            "Awaitable[dict[Any, Any]]", self._redis.hgetall(_BINDINGS_PREFIX + str(chat_id))
        )
        bindings: list[Binding] = []
        broken: list[Any] = []
        for field_name, value in raw.items():
            try:
                bindings.append(_from_mapping(json.loads(_text(value))))
            except (KeyError, ValueError, TypeError):
                # Битая запись (частичная запись, смена формата) ведёт себя как
                # отсутствие привязки: семья пройдёт `/start <код>` заново.
                # Молча падать на каждом сообщении хуже.
                broken.append(field_name)
        if broken:
            await cast("Awaitable[int]", self._redis.hdel(_BINDINGS_PREFIX + str(chat_id), *broken))
        return sorted(bindings, key=lambda b: (b.linked_at, str(b.patient_id)))

    async def get(self, chat_id: int) -> Binding | None:
        """Привязка выбранного ребёнка; если выбор потерян — первого по порядку.

        Только для начала действия. Шаги начатого сценария берут ребёнка,
        про которого он начат (`deps.scenario_binding`), а не выбранного.
        """

        bindings = await self.all(chat_id)
        if not bindings:
            return None
        active = await cast("Awaitable[Any]", self._redis.get(_ACTIVE_PREFIX + str(chat_id)))
        for binding in bindings:
            if active is not None and str(binding.patient_id) == _text(active):
                return binding
        return bindings[0]

    async def put(self, chat_id: int, binding: Binding) -> None:
        """Добавляет (или заменяет) привязку ребёнка и делает его выбранным.

        Выбранным — потому что код только что прислан ради этого ребёнка:
        следующую запись семья ведёт про него.
        """

        await self._migrate_legacy(chat_id)
        if not binding.linked_at:
            binding = replace(binding, linked_at=datetime.now(UTC).isoformat())
        await cast(
            "Awaitable[int]",
            self._redis.hset(
                _BINDINGS_PREFIX + str(chat_id), str(binding.patient_id), _to_json(binding)
            ),
        )
        # Прежняя раскладка ведётся параллельно — для отката бота (см. модуль).
        await cast(
            "Awaitable[int]",
            self._redis.hset(_LEGACY_PREFIX + str(chat_id), mapping=_legacy_mapping(binding)),
        )
        await self.select(chat_id, binding.patient_id)

    async def select(self, chat_id: int, patient_id: uuid.UUID) -> Binding | None:
        """Выбирает ребёнка. Ребёнок не из этого чата — None, выбор не меняется."""

        for binding in await self.all(chat_id):
            if binding.patient_id == patient_id:
                await cast(
                    "Awaitable[Any]",
                    self._redis.set(_ACTIVE_PREFIX + str(chat_id), str(patient_id)),
                )
                return binding
        return None

    async def forget(
        self, chat_id: int, patient_id: uuid.UUID, link_id: uuid.UUID | None = None
    ) -> Binding | None:
        """Забывает привязку одного ребёнка (её отозвали) и называет, кто выбран теперь.

        Остальные дети чата остаются: отзыв одной привязки не гасит другую
        (ADR-0048). Возвращает привязку, ставшую выбранной, или None, если
        детей у чата больше нет.

        Прежний ключ с той же привязкой снимается — иначе перенос воскресил бы
        отозванную. Прежний ключ с ДРУГОЙ привязкой того же ребёнка (откатанный
        бот привязал его заново) остаётся: она новее, и перенос её подхватит.
        """

        await self._migrate_legacy(chat_id)
        legacy = await self._legacy(chat_id)
        legacy_dropped = (
            legacy is not None
            and legacy.patient_id == patient_id
            and (link_id is None or legacy.link_id == link_id)
        )
        if legacy_dropped:
            await cast("Awaitable[int]", self._redis.delete(_LEGACY_PREFIX + str(chat_id)))
        await cast(
            "Awaitable[int]",
            self._redis.hdel(_BINDINGS_PREFIX + str(chat_id), str(patient_id)),
        )
        remaining = await self.all(chat_id)
        if not remaining:
            await cast("Awaitable[int]", self._redis.delete(_ACTIVE_PREFIX + str(chat_id)))
            return None
        current = await self.get(chat_id)
        if current is not None:
            await self.select(chat_id, current.patient_id)
            if legacy_dropped:
                # Откатанный бот увидит оставшегося ребёнка, а не пустой чат.
                await cast(
                    "Awaitable[int]",
                    self._redis.hset(
                        _LEGACY_PREFIX + str(chat_id), mapping=_legacy_mapping(current)
                    ),
                )
        return current

    # --- язык чата (ADR-0052) ---
    #
    # Источник истины — сервер (`users.language`). Здесь его копия с отметкой,
    # когда она сверена с сервером: у привязанного чата бот перепроверяет её
    # раз в `LANGUAGE_TTL_S`, чтобы выбор, сделанный в Mini App, дошёл до бота
    # за минуты. У непривязанного чата сервера, которому принадлежал бы выбор,
    # ещё нет, и копия — единственное место, где он живёт.

    async def language(self, chat_id: int) -> StoredLanguage | None:
        raw = await cast("Awaitable[Any]", self._redis.get(_LANGUAGE_PREFIX + str(chat_id)))
        if raw is None:
            return None
        try:
            parsed = json.loads(_text(raw))
            checked = parsed.get("checked_at")
            return StoredLanguage(
                language=str(parsed["language"]),
                explicit=bool(parsed.get("explicit")),
                checked_at=float(checked) if checked is not None else None,
                pending=bool(parsed.get("pending")),
            )
        except (KeyError, ValueError, TypeError, AttributeError):
            return None

    async def set_language(self, chat_id: int, stored: StoredLanguage) -> None:
        value = json.dumps(
            {
                "language": stored.language,
                "explicit": stored.explicit,
                "checked_at": stored.checked_at,
                "pending": stored.pending,
            }
        )
        await cast("Awaitable[Any]", self._redis.set(_LANGUAGE_PREFIX + str(chat_id), value))

    async def _legacy(self, chat_id: int) -> Binding | None:
        """Привязка из прежней раскладки; битая — снимается и считается отсутствующей."""

        legacy_key = _LEGACY_PREFIX + str(chat_id)
        raw: dict[Any, Any] = await cast(
            "Awaitable[dict[Any, Any]]", self._redis.hgetall(legacy_key)
        )
        if not raw:
            return None
        try:
            return _from_mapping({_text(k): _text(v) for k, v in raw.items()})
        except (KeyError, ValueError, TypeError):
            await cast("Awaitable[int]", self._redis.delete(legacy_key))
            return None

    async def _migrate_legacy(self, chat_id: int) -> None:
        """Переносит привязку из раскладки до ADR-0048, если её ещё нет в новой.

        Только если записи этого ребёнка в новой раскладке нет (`HSETNX`):
        прежний ключ никогда не затирает новую запись. Сам прежний ключ не
        удаляется — он нужен для отката (см. модуль).
        """

        binding = await self._legacy(chat_id)
        if binding is None:
            return
        added = await cast(
            "Awaitable[int]",
            self._redis.hsetnx(
                _BINDINGS_PREFIX + str(chat_id), str(binding.patient_id), _to_json(binding)
            ),
        )
        if added:
            await cast(
                "Awaitable[Any]",
                self._redis.set(_ACTIVE_PREFIX + str(chat_id), str(binding.patient_id), nx=True),
            )


def _legacy_mapping(binding: Binding) -> dict[str, str]:
    """Привязка в прежней раскладке — ровно те поля, что читает бот до ADR-0048."""

    return {
        "link_id": str(binding.link_id),
        "secret": binding.secret,
        "patient_id": str(binding.patient_id),
        "patient_name": binding.patient_name,
    }


def _text(value: Any) -> str:
    return value.decode() if isinstance(value, bytes) else str(value)
