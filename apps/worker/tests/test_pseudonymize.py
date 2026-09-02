"""Псевдонимизация: чего в промпте быть НЕ должно (раздел 10.2 ТЗ, правило 6).

Тест из раздела 10.2 ТЗ («юнит-тест проверяет отсутствие полей ФИО в выходе»)
написан от обратного: он не перечисляет разрешённое, а ищет запрещённое в
готовой нагрузке. При добавлении полей в payload этот тест расширяется —
поэтому здесь лежит нагрузка, похожая на настоящую, со вложенностью.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime
from decimal import Decimal

import pytest

from worker.ai.pseudonymize import (
    FORBIDDEN_KEYS,
    patient_label,
    pseudonymize,
    scrub_free_text,
)

PATIENT_ID = uuid.UUID("3f2a1c9d-1111-4111-8111-222222222222")

PAYLOAD = {
    "patient": {
        "id": str(PATIENT_ID),
        "full_name": "Аня Иванова",
        "birth_date": "2021-07-15",
        "sex": "f",
    },
    "family": [
        {
            "full_name": "Иванова Мария Петровна",
            "email": "mama@example.com",
            "phone": "+998901112233",
            "chat_id": 4815162342,
            "role": "parent",
        }
    ],
    "days": [
        {
            "date": "2026-08-31",
            "ketones": 3.1,
            "menu": [{"name_ru": "Омлет на сливках", "grams": 120}],
            "note": {"author_name": "Иванова М. П.", "text": "плохо ел"},
        }
    ],
    "prescription": {"ratio": 3.5, "kcal_per_day": 1200},
}


class TestForbiddenFieldsAreGone:
    def test_no_forbidden_key_survives_at_any_depth(self) -> None:
        result = pseudonymize(PAYLOAD)
        found: list[str] = []

        def walk(node: object, path: str) -> None:
            if isinstance(node, dict):
                for key, value in node.items():
                    if key.lower() in FORBIDDEN_KEYS:
                        found.append(f"{path}.{key}")
                    walk(value, f"{path}.{key}")
            elif isinstance(node, list):
                for index, item in enumerate(node):
                    walk(item, f"{path}[{index}]")

        walk(result, "$")
        assert found == []

    @pytest.mark.parametrize(
        "leaked",
        [
            "Аня Иванова",
            "Иванова Мария Петровна",
            "mama@example.com",
            "+998901112233",
            "4815162342",
        ],
    )
    def test_no_personal_value_survives(self, leaked: str) -> None:
        """Проверка по значению, а не по ключу: ключ можно переименовать."""

        assert leaked not in json.dumps(pseudonymize(PAYLOAD), ensure_ascii=False)

    def test_clinical_data_survives(self) -> None:
        """Убрать лишнее — не значит убрать всё: без чисел спрашивать нечего."""

        result = pseudonymize(PAYLOAD)
        text = json.dumps(result, ensure_ascii=False)

        assert "3.1" in text  # кетоны
        assert "Омлет на сливках" in text  # название блюда — не персональные данные
        assert "плохо ел" in text  # текст заметки остаётся, имя автора — нет
        assert result["prescription"] == {"ratio": 3.5, "kcal_per_day": 1200}

    def test_patient_becomes_a_label(self) -> None:
        result = pseudonymize(PAYLOAD)
        assert isinstance(result["patient"], str)
        assert result["patient"].startswith("patient 3f2a1c9d")
        assert "возраст" in result["patient"]

    def test_patient_without_age_still_loses_the_name(self) -> None:
        """Нет даты рождения — метка беднее, но ФИО не возвращается «взамен»."""

        result = pseudonymize({"patient": {"id": str(PATIENT_ID), "full_name": "Аня"}})
        assert result["patient"] == "patient 3f2a1c9d"

    def test_unknown_patient_is_named_so(self) -> None:
        result = pseudonymize({"patient": {"full_name": "Аня"}})
        assert "Аня" not in result["patient"]


class TestPatientLabel:
    @pytest.mark.parametrize(
        ("birth", "today", "expected"),
        [
            (date(2021, 7, 15), date(2026, 9, 2), "возраст 5 лет 1 мес"),
            (date(2025, 2, 10), date(2026, 9, 2), "возраст 1 год 6 мес"),
            (date(2024, 1, 2), date(2026, 9, 2), "возраст 2 года 8 мес"),
            (date(2026, 2, 20), date(2026, 9, 2), "возраст 6 мес"),
            # День рождения ещё не наступил в этом месяце — месяц не засчитан.
            (date(2026, 8, 20), date(2026, 9, 2), "возраст 0 мес"),
        ],
    )
    def test_age_in_years_and_months(self, birth: date, today: date, expected: str) -> None:
        """Месяцы наравне с годами: кетотерапию начинают и грудным детям."""

        label = patient_label(patient_id=PATIENT_ID, birth_date=birth, sex="f", today=today)
        assert expected in label

    def test_sex_in_russian(self) -> None:
        label = patient_label(
            patient_id=PATIENT_ID, birth_date=date(2021, 7, 15), sex="m", today=date(2026, 9, 2)
        )
        assert label.endswith("пол м")

    def test_short_id_is_not_the_whole_uuid(self) -> None:
        """Короткий идентификатор различает детей в диалоге и больше ничего."""

        label = patient_label(patient_id=PATIENT_ID, birth_date=None, sex=None)
        assert label == "patient 3f2a1c9d"
        assert str(PATIENT_ID) not in label


class TestPersonShapedDictionaries:
    """Находка ревью: подмена срабатывала только для ключа ровно `patient`."""

    def test_any_person_record_becomes_a_label(self) -> None:
        # `child`, `sibling`, `subject` — искать их по имени ключа значит
        # проигрывать первому же новому названию.
        result = pseudonymize(
            {"child": {"id": "3f2a1c9d", "birth_date": "2021-07-15", "sex": "f", "name": "Аня"}}
        )
        assert result["child"].startswith("patient 3f2a1c9d")
        assert "Аня" not in json.dumps(result, ensure_ascii=False)

    def test_birth_date_alone_never_survives(self) -> None:
        """Дата рождения вместе с полом идентифицирует ребёнка не хуже имени."""

        result = pseudonymize({"anketa": {"birth_date": "2021-07-15", "sex": "f"}})
        assert "2021-07-15" not in json.dumps(result, ensure_ascii=False)

    def test_a_product_is_not_a_person(self) -> None:
        """У продукта тоже есть `id` — и он обязан дойти до модели целым:
        по нему разбор еды сопоставляет названия с каталогом (раздел 10.3 ТЗ)."""

        payload = {"products": [{"id": "77", "name_ru": "Масло сливочное", "fat_100g": 82.5}]}
        assert pseudonymize(payload) == payload


class TestJsonSafety:
    def test_dates_decimals_and_uuids_survive_json(self) -> None:
        """Репозитории `core` отдают именно их, а нагрузка едет через
        `json.dumps` дважды — в промпт и в `ai_jobs.input`."""

        payload = {
            "day": date(2026, 8, 31),
            "at": datetime(2026, 8, 31, 7, 30),
            "grams": Decimal("12.5"),
            "recipe_id": uuid.UUID("11111111-1111-4111-8111-111111111111"),
        }
        result = pseudonymize(payload)

        json.dumps(result)  # падало бы TypeError до правки
        assert result["day"] == "2026-08-31"
        assert result["grams"] == 12.5
        assert result["recipe_id"] == "11111111-1111-4111-8111-111111111111"


class TestFreeText:
    @pytest.mark.parametrize(
        "text",
        [
            "напишите мне на mama@example.com",
            "мой телефон +998 90 111-22-33",
            "я в телеграме @anyamama",
        ],
    )
    def test_contacts_are_masked(self, text: str) -> None:
        """Раздел 10.2 ТЗ запрещает контакты в промптах без оговорок, и «это же
        ввод пользователя» такой оговоркой не является (ADR-0019)."""

        cleaned = scrub_free_text(text)
        assert cleaned is not None
        assert "@example.com" not in cleaned
        assert "111-22-33" not in cleaned
        assert "@anyamama" not in cleaned

    def test_the_meal_itself_survives(self) -> None:
        """Чистка не должна съесть текст, ради которого разбор и делается."""

        assert scrub_free_text("Аня съела 2 яйца и 30 г масла") == "Аня съела 2 яйца и 30 г масла"

    def test_none_stays_none(self) -> None:
        assert scrub_free_text(None) is None
