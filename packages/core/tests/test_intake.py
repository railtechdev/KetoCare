"""Анкета регистрации пациента (ADR-0007). Требует запущенный PostgreSQL (make dev)."""

from __future__ import annotations

from datetime import date

import pytest

from core.models.enums import IntakeScale, Sex
from core.repositories import intake, patients

pytestmark = pytest.mark.asyncio


async def _make_patient(session):
    return await patients.create(
        session, full_name="Тестовый Ребёнок", birth_date=date(2018, 5, 1), sex=Sex.M
    )


class TestIntakeDictionaries:
    """Справочники засеяны миграцией: варианты анкеты не выдумываются в коде."""

    async def test_every_scale_has_options(self, session):
        for scale in IntakeScale:
            options = await intake.list_options(session, scale=scale)
            assert options, f"шкала {scale.value} осталась без вариантов"

    async def test_options_of_one_scale_only(self, session):
        options = await intake.list_options(session, scale=IntakeScale.SEIZURE_DURATION)

        assert {option.scale for option in options} == {IntakeScale.SEIZURE_DURATION}

    async def test_drugs_carry_synonyms_for_search(self, session):
        # «Летирам», «Леветирацетам» и «Кеппра» — одно вещество под тремя именами:
        # без синонимов записи разных семей нельзя было бы сопоставить.
        drugs, total = await intake.list_drugs(session)

        assert total == len(drugs) > 0
        assert all(drug.synonyms for drug in drugs)


class TestPatientIntake:
    """Анкета — одна строка на пациента, а не история версий."""

    async def test_second_answer_updates_the_same_row(self, session):
        patient = await _make_patient(session)
        durations = await intake.list_options(session, scale=IntakeScale.SEIZURE_DURATION)

        first = await intake.upsert(
            session,
            patient_id=patient.id,
            last_seizure_on=date(2026, 8, 1),
            onset_age_id=None,
            seizure_frequency_id=None,
            seizure_duration_id=durations[0].id,
            meals_per_day_id=None,
            developmental_delay=True,
            meals_regular=False,
            current_aed_ids=[],
        )
        second = await intake.upsert(
            session,
            patient_id=patient.id,
            last_seizure_on=date(2026, 8, 20),
            onset_age_id=None,
            seizure_frequency_id=None,
            seizure_duration_id=durations[1].id,
            meals_per_day_id=None,
            developmental_delay=False,
            meals_regular=True,
            current_aed_ids=[],
        )

        assert second.id == first.id
        assert second.last_seizure_on == date(2026, 8, 20)
        assert second.seizure_duration_id == durations[1].id

    async def test_current_aed_ids_survive_round_trip(self, session):
        # UUID в JSONB не сериализуется — репозиторий приводит их к строкам.
        patient = await _make_patient(session)
        drugs, _ = await intake.list_drugs(session)
        chosen = [drugs[0].id, drugs[1].id]

        await intake.upsert(
            session,
            patient_id=patient.id,
            last_seizure_on=None,
            onset_age_id=None,
            seizure_frequency_id=None,
            seizure_duration_id=None,
            meals_per_day_id=None,
            developmental_delay=None,
            meals_regular=None,
            current_aed_ids=chosen,
        )
        stored = await intake.get_for_patient(session, patient_id=patient.id)

        assert stored is not None
        assert stored.current_aed_ids == [str(drug_id) for drug_id in chosen]

    async def test_absent_intake_is_none(self, session):
        patient = await _make_patient(session)

        assert await intake.get_for_patient(session, patient_id=patient.id) is None
