"""дата начала кетодиетотерапии

Revision ID: 57f8e9cd5292
Revises: e877386f5ebe
Create Date: 2026-09-10 21:26:19.187832

Ответ клиники от 09.09.2026 (вопрос 17): «В системе обязательно должно быть
отдельное поле "Дата начала кетогенной диетотерапии"».

От неё отсчитываются контрольные визиты и по ней решается, считать ли ответ
семьи о частоте приступов исходным уровнем. Раньше начало выводилось из самого
раннего назначения — вывод остаётся запасным вариантом, но он лжёт у ребёнка,
которого перевели из другой клиники уже на диете, и у того, кому назначение
записали заранее.

**Заполнять нечем, и это не упущение.** Даты старта в системе не существовало ни
в каком виде: вывод из назначения по-прежнему работает сам, а подставлять его в
поле значило бы выдать вывод за слово врача. Поле пустое, пока врач его не
заполнит; `therapy.started_on()` до тех пор отвечает по-старому.

Откат уносит только то, что врачи ввели руками после этого выката, и вывод из
назначения от этого не страдает — поэтому `downgrade` обычный.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "57f8e9cd5292"
down_revision: str | None = "e877386f5ebe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("medical_profiles", sa.Column("therapy_started_on", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("medical_profiles", "therapy_started_on")
