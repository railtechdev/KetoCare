"""Анкета регистрации пациента и её справочники (ADR-0007)."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import func, select

from api.services import intake as intake_service
from core.models import PatientIntake
from core.models.enums import IntakeScale, UserRole
from core.repositories import intake as intake_repo
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio


async def _parent_with_child(session, make_user, make_patient):
    parent = await make_user(UserRole.PARENT)
    patient = await make_patient()
    await patients_repo.link_parent(session, parent_id=parent.id, patient_id=patient.id)
    return parent, patient


async def _option_id(session, scale: IntakeScale, index: int = 0):
    options = await intake_repo.list_options(session, scale=scale)
    return str(options[index].id)


class TestIntakeDictionaries:
    async def test_options_can_be_narrowed_to_one_scale(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
        scales = {item["scale"] for item in response.json()["items"]}
        assert scales == {IntakeScale.SEIZURE_DURATION.value}

    async def test_options_carry_stable_codes(self, client, make_user, auth_headers):
        # Статистика собирается по коду: медицинская команда переформулирует
        # вариант (вопросы 19-21), и без кода прежние ответы стали бы несравнимы.
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options", headers=auth_headers(parent)
        )

        assert response.status_code == 200
        assert all(item["code"] for item in response.json()["items"])

    async def test_drugs_expose_synonyms(self, client, make_user, auth_headers):
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/dictionaries/aed-drugs", headers=auth_headers(parent))

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert items and all(item["synonyms"] for item in items)

    async def test_drugs_say_which_rows_are_medicines(self, client, make_user, auth_headers):
        """Не всякая строка справочника — лекарство, и потребитель должен различать.

        Справочник заводился под анкету семьи («какие препараты принимает»), и
        вариантами ответа в нём стоят «Другое (указать)», «Не принимает
        противоэпилептические препараты» и «Не знаю названия».

        Потребитель — кабинет: подсказка названия в схеме лекарственной терапии
        (`features/doctor/DrugNameField.tsx`) предлагает только `is_drug`, иначе
        врач, набравший «не», получал бы «Не знаю названия» и выбор подставлял
        бы эту строку в назначение препарата. Анкета показывает всё.
        """

        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/dictionaries/aed-drugs", headers=auth_headers(parent))

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert all("is_drug" in item for item in items)

        by_name = {item["name_ru"]: item for item in items}
        assert by_name["Не знаю названия"]["is_drug"] is False
        assert by_name["Другое (указать)"]["is_drug"] is False
        assert by_name["Леветирацетам"]["is_drug"] is True

    async def test_scales_carry_the_wording_the_clinic_approved(self, session):
        """Итог миграции текстов — не только код, но и то, что читает семья.

        Тесты шкал сверяли `code`, поэтому переименование справочника не
        держалось ничем: удали карту переименований в миграции — все тесты
        зелёные. А миграция ищет строки ПО ИМЕНИ и падает, если не нашла, —
        значит имена стали частью контракта.

        Формулировки — из утверждённой клиникой шкалы (ответ 19 от 09.09.2026)
        и из перехода на терминологию ASM (ответ 21).
        """

        options = await intake_repo.list_options(
            session, scale=IntakeScale.SEIZURE_FREQUENCY, include_retired=True
        )
        by_code = {option.code: option.name_ru for option in options}
        assert by_code["freq_weekly"] == "Несколько раз в неделю"
        assert by_code["freq_none"] == "Приступов нет"

        drugs, _ = await intake_repo.list_drugs(session, limit=1000, include_retired=True)
        names = {drug.name_ru for drug in drugs}
        assert "Не принимает противоприступные препараты" in names
        assert "Не принимает противоэпилептические препараты" not in names

    async def test_retired_switch_count_options_are_named_not_coded(self, session):
        """Выведенные варианты подписаны человеческими именами.

        На них ссылаются анкеты, заполненные до замены шкалы, и врач читает эти
        подписи в карте. Проверка появилась после того, как я принял дрейф
        одной локальной базы за дефект продукта и чуть не «починил» его
        миграцией, которая на откате записала бы коды в имена.
        """

        options = await intake_repo.list_options(
            session, scale=IntakeScale.AED_SWITCH_COUNT, include_retired=True
        )
        for option in options:
            assert option.name_ru != option.code, (
                f"вариант «{option.code}» подписан своим кодом — врач прочитает его в карте"
            )

    async def test_seizure_types_expose_code(self, client, make_user, auth_headers):
        # Месячная сетка дневника подписывает столбцы кодом: «Тонико-клонический»
        # в клетку не помещается, «TC» — да.
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/seizure-types", headers=auth_headers(parent)
        )

        assert response.status_code == 200, response.text
        items = response.json()["items"]
        assert any(item["code"] for item in items)
        assert all("code" in item for item in items)


class TestPatientIntake:
    async def test_parent_fills_and_reads_own_child(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/intake"
        body = {
            "last_seizure_on": date(2026, 5, 20).isoformat(),
            "seizure_frequency_id": await _option_id(session, IntakeScale.SEIZURE_FREQUENCY),
            "developmental_delay": True,
            "meals_regular": False,
        }

        saved = await client.put(url, json=body, headers=auth_headers(parent))
        assert saved.status_code == 200, saved.text

        fetched = await client.get(url, headers=auth_headers(parent))
        assert fetched.status_code == 200
        assert fetched.json()["developmental_delay"] is True
        assert fetched.json()["last_seizure_on"] == "2026-05-20"

    async def test_put_is_upsert_not_second_row(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/intake"

        first = await client.put(url, json={"meals_regular": True}, headers=auth_headers(parent))
        second = await client.put(url, json={"meals_regular": False}, headers=auth_headers(parent))

        assert second.status_code == 200
        assert second.json()["id"] == first.json()["id"]

        rows = await session.scalar(
            select(func.count())
            .select_from(PatientIntake)
            .where(PatientIntake.patient_id == patient.id)
        )
        assert rows == 1

    async def test_option_from_another_scale_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Внешний ключ проверяет существование варианта, но не его смысл.

        Без этой проверки «Ежедневно» записывается в длительность приступа, и
        анкета, собираемая ради анализа, перестаёт что-либо значить.
        """
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        frequency_id = await _option_id(session, IntakeScale.SEIZURE_FREQUENCY)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_duration_id": frequency_id},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"
        assert response.json()["error"]["details"]["field"] == "seizure_duration_id"

    async def test_unknown_drug_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"current_aed_ids": ["3f0f9d1e-0000-4000-8000-000000000000"]},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"

    async def test_stranger_gets_403(self, client, session, make_user, make_patient, auth_headers):
        _, patient = await _parent_with_child(session, make_user, make_patient)
        stranger = await make_user(UserRole.PARENT)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/intake", headers=auth_headers(stranger)
        )

        assert response.status_code == 403

    async def test_missing_intake_returns_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.get(
            f"/api/v1/patients/{patient.id}/intake", headers=auth_headers(parent)
        )

        assert response.status_code == 404

    async def test_no_seizures_requires_the_last_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """«Приступов нет» без даты — ответ, который ничего не говорит.

        Ответ клиники 09.09.2026 (вопрос 19): устойчивая свобода от приступов
        измеряется СРОКОМ. Без даты непонятно, неделя это или два года, — а
        именно по снижению относительно исходного уровня оценивают эффект
        кетотерапии.

        Потребитель — анкета в кабинете (`features/intake/IntakeForm.tsx`): она
        делает поле обязательным на экране, но правило живёт здесь.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)
        options = await intake_repo.list_options(session, scale=IntakeScale.SEIZURE_FREQUENCY)
        none_option = next(option for option in options if option.code == "freq_none")

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_frequency_id": str(none_option.id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "last_seizure_on"

        # С датой тот же ответ проходит.
        ok = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={
                "seizure_frequency_id": str(none_option.id),
                "last_seizure_on": "2026-06-01",
            },
            headers=auth_headers(parent),
        )
        assert ok.status_code == 200, ok.text

    async def test_rule_applies_when_editing_an_existing_intake(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Правило действует и на уже заполненную анкету — это её цена.

        PUT заменяет анкету целиком, поэтому строка, сохранённая раньше с
        «Приступов нет» и без даты, теперь не сохранится, пока дату не введут:
        семья не поправит в анкете НИЧЕГО другого. Клиника про уже собранные
        анкеты не говорила, и это записано вопросом 48 — до ответа работает
        самый строгий вариант, ближайший к сказанному.

        Случай проверяется отдельно, потому что мутация «применять правило
        только при создании» на тестах создания зелена.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)
        url = f"/api/v1/patients/{patient.id}/intake"
        options = await intake_repo.list_options(session, scale=IntakeScale.SEIZURE_FREQUENCY)
        none_option = next(option for option in options if option.code == "freq_none")

        # Анкета из прошлого: ответ «Приступов нет» уже стоит, даты нет.
        intake = await intake_repo.upsert(
            session,
            patient_id=patient.id,
            last_seizure_on=None,
            onset_age_id=None,
            seizure_frequency_id=none_option.id,
            seizure_duration_id=None,
            meals_per_day_id=None,
            developmental_delay=None,
            meals_regular=None,
            current_aed_ids=[],
        )
        assert intake.last_seizure_on is None

        # Семья правит совсем другое поле — и упирается в дату.
        response = await client.put(
            url,
            json={
                "seizure_frequency_id": str(none_option.id),
                "developmental_delay": True,
            },
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "last_seizure_on"

    async def test_future_date_is_a_typo_not_an_answer(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """По этой дате измеряют срок свободы от приступов.

        «2062-06-01» дало бы отрицательный срок. Проверка стоит отдельно от
        обязательности: опечатка возможна при любом ответе о частоте.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"last_seizure_on": "2062-06-01"},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "last_seizure_on"

    async def test_today_is_local_not_the_process_date(
        self, client, session, make_user, make_patient, auth_headers, monkeypatch
    ):
        """«Сегодня» берётся из настроек установки, а не у процесса.

        Наивный `date.today()` зависит от переменной `TZ` окружения, а форма
        считает `max` по часам устройства семьи. В UTC+5 вечером это разные
        даты, и сервер назвал бы сегодняшний ответ будущим.

        Подменяется `local_today`, поэтому тест не зависит от часов машины и от
        времени суток: вернись код к `date.today()`, подменённая функция
        перестанет вызываться, и второй запрос пройдёт вместо отказа.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)
        pinned = date(2026, 6, 15)
        monkeypatch.setattr(intake_service, "local_today", lambda: pinned)
        url = f"/api/v1/patients/{patient.id}/intake"

        today_ok = await client.put(
            url,
            json={"last_seizure_on": pinned.isoformat()},
            headers=auth_headers(parent),
        )
        assert today_ok.status_code == 200, today_ok.text

        tomorrow = await client.put(
            url,
            json={"last_seizure_on": (pinned + timedelta(days=1)).isoformat()},
            headers=auth_headers(parent),
        )
        assert tomorrow.status_code == 422, tomorrow.text
        assert tomorrow.json()["error"]["details"]["field"] == "last_seizure_on"

    async def test_retired_no_seizures_option_still_requires_the_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Выведенный из употребления вариант правила не отменяет.

        Справочник ведёт медкоманда, и «Приступов нет» однажды может быть
        заменён другой формулировкой. Анкеты, ссылающиеся на прежний вариант,
        обязаны сохраняться дальше — но и правило по ним не должно отваливаться
        молча. Без этого случая флип `include_retired` на `False` не роняет
        ничего.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)
        options = await intake_repo.list_options(session, scale=IntakeScale.SEIZURE_FREQUENCY)
        none_option = next(option for option in options if option.code == "freq_none")
        none_option.retired = True
        await session.flush()

        # Предпосылка теста: клиент видит ту же подмену. Без этой проверки он
        # остался бы зелёным и в тот день, когда клиенту дадут свою сессию, —
        # 422 пришёл бы по обычной ветке, а правило про выведенный вариант
        # молча перестало бы работать.
        visible = await client.get(
            "/api/v1/dictionaries/intake-options?scale=seizure_frequency",
            headers=auth_headers(parent),
        )
        assert visible.status_code == 200, visible.text
        assert all(item["code"] != "freq_none" for item in visible.json()["items"])

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_frequency_id": str(none_option.id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "last_seizure_on"

    async def test_other_frequencies_do_not_require_the_date(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Остальные варианты дату не требуют.

        Ребёнок с ежедневными приступами и так есть в дневнике, а семья на
        первом визите даты может не помнить. Требовать её везде значило бы
        сделать анкету незаполняемой ради правила, которого клиника не давала.
        """

        parent, patient = await _parent_with_child(session, make_user, make_patient)
        options = await intake_repo.list_options(session, scale=IntakeScale.SEIZURE_FREQUENCY)
        daily = next(option for option in options if option.code == "freq_daily")

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_frequency_id": str(daily.id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text


class TestDoctorPartOfIntake:
    async def test_parent_cannot_write_aed_switch_count(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Врачебное поле анкеты недоступно семье не экраном, а сервером.

        Заказчик просил объективности: «родители не всегда правильно помнят
        диагноз, тип приступа». Поле живёт в медицинском профиле, а профиль
        закрыт от родителя целиком.
        """
        parent, patient = await _parent_with_child(session, make_user, make_patient)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"aed_switch_count_id": await _option_id(session, IntakeScale.AED_SWITCH_COUNT)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 403

    async def test_doctor_writes_aed_switch_count(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
        option_id = await _option_id(session, IntakeScale.AED_SWITCH_COUNT)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"diagnosis": "Синдром Драве", "aed_switch_count_id": option_id},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 200, response.text
        assert response.json()["aed_switch_count_id"] == option_id

    async def test_doctor_option_from_another_scale_is_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor = await make_user(UserRole.DOCTOR)
        patient = await make_patient()
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)

        response = await client.put(
            f"/api/v1/patients/{patient.id}/medical-profile",
            json={"aed_switch_count_id": await _option_id(session, IntakeScale.ONSET_AGE)},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422, response.text
        assert response.json()["error"]["details"]["field"] == "aed_switch_count_id"


class TestRetiredDictionaryValues:
    """Выведенный из употребления вариант не предлагается, но остаётся читаемым.

    Удалить его нельзя: на него ссылаются заполненные анкеты, и ответ семьи не
    должен исчезать вместе со сменой формулировки (правило 4 CLAUDE.md).
    """

    async def test_retired_options_are_hidden_by_default(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)

        default = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )
        with_retired = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={
                "scale": IntakeScale.SEIZURE_DURATION.value,
                "include_retired": "true",
            },
            headers=auth_headers(parent),
        )

        assert default.status_code == 200, default.text
        assert all(not item["retired"] for item in default.json()["items"])
        assert with_retired.json()["total"] > default.json()["total"]

    async def test_duration_scale_has_no_gap_between_5_and_10_minutes(
        self, client, session, make_user, auth_headers
    ):
        """Разрыв 5-10 минут в шкале заказчика закрыт; границы совмещены с
        операциональным определением эпилептического статуса ILAE (Trinka 2015)."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_DURATION.value},
            headers=auth_headers(parent),
        )

        codes = [item["code"] for item in response.json()["items"]]
        assert "dur_5_10min" in codes
        assert "dur_under_5min" not in codes, "перекрывающийся вариант выведен"

    async def test_frequency_scale_can_express_seizure_freedom(
        self, client, session, make_user, auth_headers
    ):
        """Цель кетотерапии — прекращение приступов. Шкале заказчика её выразить
        было нечем: варианты шли от «ежедневно» до «раз в 2-3 месяца»."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.SEIZURE_FREQUENCY.value},
            headers=auth_headers(parent),
        )

        codes = [item["code"] for item in response.json()["items"]]
        assert "freq_none" in codes
        assert "freq_rarer" in codes

    async def test_aed_switch_count_scale_does_not_overlap(
        self, client, session, make_user, auth_headers
    ):
        """«2 препарата», «более 2х», «более 5» пересекались: сменивший шесть
        подходил под два варианта сразу, а сменивший одного — ни под один."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get(
            "/api/v1/dictionaries/intake-options",
            params={"scale": IntakeScale.AED_SWITCH_COUNT.value},
            headers=auth_headers(parent),
        )

        codes = {item["code"] for item in response.json()["items"]}
        assert {"aed_0", "aed_1", "aed_2", "aed_3_5", "aed_6_plus"} <= codes
        assert "aed_over_2" not in codes

    async def test_drugs_are_one_per_substance(self, client, session, make_user, auth_headers):
        """Строка заказчика «Карбамазепин, Окскарбазепин, Трилептал, Тегретол»
        объединяла два разных действующих вещества."""
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/dictionaries/aed-drugs", headers=auth_headers(parent))

        names = {item["name_ru"] for item in response.json()["items"]}
        assert "Карбамазепин" in names
        assert "Окскарбазепин" in names
        assert "Карбамазепин, Окскарбазепин, Трилептал, Тегретол" not in names

    async def test_retired_option_can_still_be_saved(
        self, client, session, make_user, make_patient, auth_headers
    ):
        """Анкета, заполненная старым вариантом, обязана сохраняться дальше:
        иначе семья не сможет поправить в ней ни одного другого поля."""
        parent, patient = await _parent_with_child(session, make_user, make_patient)
        retired = [
            option
            for option in await intake_repo.list_options(
                session, scale=IntakeScale.SEIZURE_DURATION, include_retired=True
            )
            if option.retired
        ]

        response = await client.put(
            f"/api/v1/patients/{patient.id}/intake",
            json={"seizure_duration_id": str(retired[0].id)},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200, response.text
