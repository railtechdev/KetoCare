"""Ручки, где пациент приходит телом или строкой запроса, — перечислены, а не
найдены на ревью (Н20, второй проход ревью безопасности).

`test_patient_access_everywhere.py` видит только `{patient_id}` в пути. Ручки, где
идентификатор пациента приходит в теле или в строке запроса (`/ai/*`, `/calc/*`,
`/auth/invitations`…), проверяют доступ сами, через `assert_patient_access`, и
новая ручка такого вида тот тест не роняла: проверка держалась на ревью.

Этот тест обходит OpenAPI приложения, находит каждую операцию, у которой в
параметрах или в схеме тела (с вложенными схемами) есть поле с `patient` в имени,
и требует, чтобы она стояла в `BODY_PATIENT_ROUTES` с именем теста, где чужой
пациент получает отказ. Имя проверяется: тест обязан существовать в
`apps/api/tests`. Новая ручка без строки здесь роняет прогон.

Чего тест не видит: ребёнка, выбранного косвенно — вторым идентификатором
(`/reports/jobs/{job_id}`, `link_id` у `POST /auth/bot/session`). Поле без
`patient` в имени обход не находит; такие ручки по-прежнему на ревью.
"""

from __future__ import annotations

import inspect
import re
import uuid
from pathlib import Path
from typing import Any

import pytest

from api.main import create_app
from api.routers import auth as auth_router
from core.models.enums import UserRole

TESTS = Path(__file__).parent

#: (метод, путь) → «файл::тест», где пользователь без связи с ребёнком получает
#: отказ на этой ручке. Строка без такого теста — не обоснование.
BODY_PATIENT_ROUTES: dict[tuple[str, str], str] = {
    ("POST", "/api/v1/ai/parse"): "test_ai_parse.py::test_someone_elses_child_is_forbidden",
    (
        "POST",
        "/api/v1/ai/assistant/messages",
    ): "test_assistant_api.py::test_someone_elses_child_is_forbidden",
    ("POST", "/api/v1/calc/solve"): "test_calc_endpoints.py::test_someone_elses_child_is_forbidden",
    (
        "POST",
        "/api/v1/calc/verify",
    ): "test_patient_access_in_body.py::test_calc_verify_refuses_someone_elses_child",
    (
        "POST",
        "/api/v1/auth/invitations",
    ): "test_patient_access_in_body.py::test_invitation_never_carries_a_child",
    # Mini App: пациент в теле выбирает ребёнка внутри своих привязок чата —
    # отказ даёт привязка, а не связь учётной записи с ребёнком.
    (
        "POST",
        "/api/v1/auth/telegram-init",
    ): "test_telegram_several_children.py::test_init_refuses_a_child_this_telegram_does_not_lead",
    (
        "POST",
        "/api/v1/auth/miniapp/switch",
    ): "test_telegram_several_children.py::test_switch_requires_a_live_link_of_this_chat",
}


def _properties(
    schema: dict[str, Any], components: dict[str, Any], seen: frozenset[str]
) -> set[str]:
    """Имена всех полей схемы, включая вложенные объекты, массивы и варианты."""

    ref = schema.get("$ref")
    if ref is not None:
        name = ref.rsplit("/", 1)[-1]
        if name in seen:
            return set()
        return _properties(components[name], components, seen | {name})

    found: set[str] = set()
    for key in ("anyOf", "oneOf", "allOf"):
        for variant in schema.get(key, []):
            found |= _properties(variant, components, seen)
    for name, sub in schema.get("properties", {}).items():
        found.add(name)
        found |= _properties(sub, components, seen)
    if isinstance(schema.get("items"), dict):
        found |= _properties(schema["items"], components, seen)
    if isinstance(schema.get("additionalProperties"), dict):
        found |= _properties(schema["additionalProperties"], components, seen)
    return found


def _routes_with_patient_outside_path() -> dict[tuple[str, str], list[str]]:
    spec = create_app().openapi()
    components = spec.get("components", {}).get("schemas", {})
    found: dict[tuple[str, str], list[str]] = {}
    for path, operations in spec["paths"].items():
        if "{patient_id}" in path:
            continue  # это предмет test_patient_access_everywhere.py
        for method, operation in operations.items():
            names = {param["name"] for param in operation.get("parameters", [])}
            for content in operation.get("requestBody", {}).get("content", {}).values():
                names |= _properties(content.get("schema", {}), components, frozenset())
            fields = sorted(name for name in names if "patient" in name.lower())
            if fields:
                found[(method.upper(), path)] = fields
    return found


def _test_names() -> set[str]:
    names: set[str] = set()
    pattern = re.compile(r"^\s*(?:async\s+)?def\s+(test_\w+)", re.MULTILINE)
    for file in TESTS.glob("test_*.py"):
        names.update(
            f"{file.name}::{name}" for name in pattern.findall(file.read_text(encoding="utf-8"))
        )
    return names


def test_every_route_with_patient_in_body_is_listed() -> None:
    found = _routes_with_patient_outside_path()

    assert len(found) >= 5, "ручек с пациентом в теле подозрительно мало — обход сломался"
    missing = [
        f"{method} {path}: поля {', '.join(fields)}"
        for (method, path), fields in sorted(found.items())
        if (method, path) not in BODY_PATIENT_ROUTES
    ]
    assert missing == [], (
        "ручки с пациентом в теле или в строке запроса без строки в BODY_PATIENT_ROUTES "
        "(нужен тест, где чужой пациент получает отказ):\n" + "\n".join(missing)
    )


def test_registry_has_no_stale_rows() -> None:
    """Строка о ручке, которой больше нет, — обещание без предмета."""

    found = _routes_with_patient_outside_path()
    stale = sorted(f"{m} {p}" for (m, p) in BODY_PATIENT_ROUTES if (m, p) not in found)
    assert stale == [], "в BODY_PATIENT_ROUTES ручки, которых нет:\n" + "\n".join(stale)


def test_every_row_names_an_existing_test() -> None:
    names = _test_names()
    unknown = sorted(
        f"{m} {p} → {test}" for (m, p), test in BODY_PATIENT_ROUTES.items() if test not in names
    )
    assert unknown == [], "в BODY_PATIENT_ROUTES названы несуществующие тесты:\n" + "\n".join(
        unknown
    )


# Две ручки, у которых до этого прохода отказа по чужому пациенту не проверял
# ни один тест.


@pytest.mark.asyncio
async def test_calc_verify_refuses_someone_elses_child(
    client, make_user, make_patient, auth_headers
):
    patient = await make_patient()
    stranger = await make_user(UserRole.PARENT)

    response = await client.post(
        "/api/v1/calc/verify",
        json={
            "ingredients": [
                {"product_id": "butter", "kcal": 717, "fat": 81.1, "protein": 0.9, "carbs": 0.1}
            ],
            "items": [{"product_id": "butter", "grams": 10}],
            "patient_id": str(patient.id),
        },
        headers=auth_headers(stranger),
    )

    assert response.status_code == 403, response.text


@pytest.mark.asyncio
async def test_invitation_never_carries_a_child(client, make_user, make_patient, auth_headers):
    """Приглашение с `patient_id` не доходит до записи ни при какой роли.

    Отказ здесь даёт не проверка доступа, а валидация: схема принимает
    `patient_id` только с ролью parent, а семья с ADR-0040 почтой не
    приглашается вовсе (422). Поэтому тест требует ровно 422 — и отдельно держит,
    что проверка доступа в ручке на месте: ослабят валидацию — первой встретит
    чужого ребёнка она."""

    patient = await make_patient()
    callers = [await make_user(UserRole.ADMIN), await make_user(UserRole.DOCTOR)]

    for caller in callers:
        for role in ("doctor", "parent"):
            response = await client.post(
                "/api/v1/auth/invitations",
                json={
                    "email": f"inv-{uuid.uuid4().hex[:8]}@example.com",
                    "role": role,
                    "patient_id": str(patient.id),
                },
                headers=auth_headers(caller),
            )

            assert response.status_code == 422, (caller.role, role, response.text)
            assert response.json()["error"]["code"] == "validation_error"

    source = inspect.getsource(auth_router.create_invitation)
    assert "assert_patient_access(session, user, payload.patient_id)" in source
