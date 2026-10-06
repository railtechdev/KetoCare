"""Проверка ответов анкеты регистрации (ADR-0007).

Внешний ключ отвечает только на вопрос «существует ли такой вариант», но не на
вопрос «из той ли он шкалы». Без этой проверки «Ежедневно» записывается в
длительность приступа, а «Более 5 препаратов» — в возраст дебюта, и анкета,
ради которой всё затевалось (данные, пригодные для анализа), перестаёт что-либо
значить.

Живёт в сервисах, а не в роутере: то же самое проверяет врачебное поле в
медицинском профиле, и вторая копия проверки разошлась бы с первой.
"""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from core.models import PatientIntake
from core.models.enums import IntakeScale, LastSeizurePrecision
from core.repositories import intake as intake_repo

from ..errors import ApiError, ErrorCode
from .clock import local_today


async def check_option_scale(
    session: AsyncSession,
    *,
    option_id: uuid.UUID | None,
    scale: IntakeScale,
    field: str,
) -> None:
    """Вариант принадлежит нужной шкале. `None` — поле не заполнено, это норма."""

    if option_id is None:
        return

    # Вместе с выведенными из употребления: анкета, заполненная прежним
    # вариантом, обязана сохраняться дальше. Иначе семья не смогла бы поправить
    # в ней ни одного другого поля — вариант, который когда-то предложили,
    # перестал бы приниматься.
    options = await intake_repo.list_options(session, scale=scale, include_retired=True)
    if option_id not in {option.id for option in options}:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Выбран вариант не из того списка.",
            details={"field": field},
        )


#: Код варианта «Приступов нет» в шкале частоты.
#:
#: Код, а не имя: имена справочника меняются (формулировку «Пару раз в неделю»
#: клиника уже поправила), а `intake_options` держит `code` уникальным в паре со
#: шкалой — на него и можно опираться.
_NO_SEIZURES_CODE = "freq_none"


#: Точности, при которых дата есть.
_DATED = frozenset(
    {LastSeizurePrecision.DAY, LastSeizurePrecision.MONTH, LastSeizurePrecision.YEAR}
)


async def check_last_seizure_known(
    session: AsyncSession,
    *,
    seizure_frequency_id: uuid.UUID | None,
    last_seizure_on: date | None,
    precision: LastSeizurePrecision | None,
    previous: PatientIntake | None,
) -> LastSeizurePrecision | None:
    """Дата последнего приступа: согласована с точностью, не в будущем и
    обязательна при НОВОМ ответе «Приступов нет». Возвращает точность для записи.

    Ответ клиники от 09.09.2026 (вопрос 19): устойчивая свобода от приступов —
    это СРОК, а не галочка, и «приступов нет» без даты не говорит, неделя это
    или два года.

    Вопрос 48 (решение команды разработки по стандарту, ADR-0049): семья не
    всегда помнит число. Дата бывает частичной, как `date` в HL7 FHIR, — до
    месяца или до года, и тогда приходит первым днём месяца или года.
    Угаданная дата была бы неотличима от точной, а врач судит по ней о
    длительности ремиссии.

    **«Не помню» в новых ответах больше не принимается** (дополнение к
    ADR-0049 от 06.10.2026). Клиника ответила на вопрос 19 прямо: при выборе
    «Приступов нет» — «обязательное поле „Дата последнего приступа“».
    «Не помню» делало его необязательным другими словами. Остался год как
    самая грубая точность. Уже сохранённое «не помню» читается как было и
    сохраняется дальше, пока семья не меняет ответ о частоте: правило
    появилось позже её ответа.

    Обязательность — только при новом ответе. Анкета, в которой «Приступов
    нет» уже стояло без даты, сохраняется дальше: правило появилось позже
    ответа, и семья не должна упираться в него, правя совсем другое поле.

    Остальные варианты частоты дату не требуют: ребёнок с ежедневными
    приступами и так упомянут в дневнике.
    """

    def invalid(message: str) -> ApiError:
        return ApiError(ErrorCode.VALIDATION_ERROR, message, details={"field": "last_seizure_on"})

    # Прежний клиент присылает одну полную дату — это и есть точность «день».
    if precision is None and last_seizure_on is not None:
        precision = LastSeizurePrecision.DAY

    if precision is LastSeizurePrecision.UNKNOWN and last_seizure_on is not None:
        raise invalid("Ответ «не помню» даты не содержит — уберите дату или выберите точность.")
    if precision is LastSeizurePrecision.UNKNOWN and not _unknown_kept(
        previous, seizure_frequency_id
    ):
        # Прежнее «не помню» при частоте, которой дата не нужна, — то же, что
        # «не отвечено»: семья сменила частоту, и упираться в поле, которое
        # теперь необязательно, ей незачем.
        if not await _is_no_seizures(session, seizure_frequency_id):
            return None
        raise invalid(
            "Укажите дату последнего приступа — хотя бы год. Вариант «не помню» "
            "больше не принимается: клиника просит дату."
        )
    if precision in _DATED and last_seizure_on is None:
        raise invalid("Укажите дату последнего приступа.")
    if last_seizure_on is not None:
        if precision is LastSeizurePrecision.MONTH and last_seizure_on.day != 1:
            raise invalid("Месяц последнего приступа передаётся первым днём месяца.")
        if precision is LastSeizurePrecision.YEAR and (
            last_seizure_on.day != 1 or last_seizure_on.month != 1
        ):
            raise invalid("Год последнего приступа передаётся первым днём года.")

    # Дата из будущего — опечатка, а не ответ: по этой дате теперь измеряют
    # срок свободы от приступов, и «2062-06-01» дал бы отрицательный срок.
    # У частичной даты сравнивается её первый день: «этот месяц» и «этот год»
    # будущими не считаются.
    #
    # «Сегодня» — местное, из настроек установки (`services/clock`), а не
    # наивный `date.today()`: тот зависит от переменной `TZ` процесса, и
    # вечерний «сегодня» семьи сервер назвал бы будущим. Форма считает `max` по
    # часам устройства, и разойтись эти два «сегодня» не должны.
    if last_seizure_on is not None and last_seizure_on > local_today():
        raise invalid("Дата последнего приступа не может быть в будущем.")

    if seizure_frequency_id is None or precision is not None:
        return precision

    grandfathered = (
        previous is not None
        and previous.seizure_frequency_id == seizure_frequency_id
        and previous.last_seizure_on is None
        and previous.last_seizure_precision is None
    )
    if grandfathered:
        return precision

    if await _is_no_seizures(session, seizure_frequency_id):
        raise invalid(
            "При ответе «Приступов нет» укажите дату последнего приступа — хотя бы "
            "месяц или год: свобода от приступов измеряется сроком."
        )
    return precision


async def _is_no_seizures(session: AsyncSession, seizure_frequency_id: uuid.UUID | None) -> bool:
    """Выбран ли вариант «Приступов нет» — по коду, а не по названию."""

    if seizure_frequency_id is None:
        return False
    options = await intake_repo.list_options(
        session, scale=IntakeScale.SEIZURE_FREQUENCY, include_retired=True
    )
    chosen = next((option for option in options if option.id == seizure_frequency_id), None)
    return chosen is not None and chosen.code == _NO_SEIZURES_CODE


def _unknown_kept(previous: PatientIntake | None, seizure_frequency_id: uuid.UUID | None) -> bool:
    """«Не помню» сохранено раньше и ответ о частоте не меняется.

    Только так оно проходит после ответа клиники на вопрос 19: PUT заменяет
    анкету целиком, и семья, правя совсем другое поле, присылает прежнее «не
    помню» обратно. Новый ответ о частоте — новый ответ, и на него правило
    действует целиком.
    """

    return (
        previous is not None
        and previous.last_seizure_precision is LastSeizurePrecision.UNKNOWN
        and previous.seizure_frequency_id == seizure_frequency_id
    )


async def check_known_drugs(session: AsyncSession, drug_ids: list[uuid.UUID]) -> None:
    if not drug_ids:
        return

    # Справочник заказчика — 16 позиций; предел выборки взят с запасом на
    # пополнение медицинской командой, а не как страница выдачи.
    drugs, _ = await intake_repo.list_drugs(session, limit=1000, include_retired=True)
    known = {drug.id for drug in drugs}
    unknown = [str(drug_id) for drug_id in drug_ids if drug_id not in known]
    if unknown:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "В списке препаратов есть неизвестные значения.",
            details={"unknown": unknown},
        )
