"""Язык человека в семейных каналах (ADR-0052, решение заказчика G3)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from core import languages
from core.languages import Language
from core.models import User
from core.repositories import users as users_repo


async def adopt_default(session: AsyncSession, user: User, proposed: Language | None) -> Language:
    """Сохранить язык-умолчание, если человек его ещё не выбирал; вернуть действующий.

    Умолчание приходит от канала: бот присылает язык, на котором уже говорит с
    человеком, Mini App — язык Telegram из подписи запуска. Сохранённый выбор
    при этом не перетирается: семья, выбравшая узбекский в приложении, не
    должна получить русский от того, что бабушкин Telegram настроен по-русски.

    Сохраняется умолчание, а не только явный выбор, ради рассылок воркера: у
    них нет ни Telegram-клиента, ни подписи, и спросить язык им не у кого.
    """

    if user.language is None and proposed is not None:
        await users_repo.update(session, user=user, language=proposed)
    return languages.effective(user.language)
