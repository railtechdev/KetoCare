"""Заявки с посадочной страницы (ADR-0012).

Отдельный модуль, а не строка в клинических таблицах, — намеренно. Здесь лежат
контакты людей, которые ещё не пациенты и не пользователи системы: посетитель
сайта оставил почту и всё. Смешивать это с данными пациентов нельзя ни по
смыслу, ни по правилам доступа — на эту таблицу не распространяется
`require_patient_access`, зато распространяется обычная осторожность с
персональными данными.

Клинических сведений здесь нет и быть не должно: форма принимает только адрес
почты, а подпись под ней просит не присылать медицинские данные.
"""

from __future__ import annotations

from sqlalchemy import Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, CreatedAtMixin, UUIDPkMixin
from .enums import LeadAudience, pg_enum


class Lead(Base, UUIDPkMixin, CreatedAtMixin):
    __tablename__ = "leads"
    __table_args__ = (
        # Повторная отправка той же формы тем же человеком — не новая заявка.
        # Без ограничения список заявок засоряется дублями от людей, которые
        # просто нажали кнопку дважды, не дождавшись ответа.
        UniqueConstraint("email", "audience", name="uq_lead_email_audience"),
        Index("ix_leads_created_at", "created_at"),
    )

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    # Через pg_enum, как все прочие enum-поля проекта. Без него SQLAlchemy
    # кладёт в базу ИМЕНА членов («FAMILY»), тогда как везде хранятся значения
    # («family»), а тип получает имя `leadaudience` вместо принятого
    # snake_case. Разошлось бы молча и вскрылось при первой выгрузке.
    audience: Mapped[LeadAudience] = mapped_column(
        pg_enum(LeadAudience, "lead_audience"), nullable=False
    )
    #: Язык страницы, с которой пришла заявка: на нём человеку и отвечать.
    locale: Mapped[str] = mapped_column(String(16), nullable=False, default="ru")
