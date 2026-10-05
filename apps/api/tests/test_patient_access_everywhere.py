"""Правило 5 CLAUDE.md держится на каждой ручке, а не на памяти автора (аудит, E10).

Любая ручка с `patient_id` в пути обязана проходить `require_patient_access`:
связь пользователя с ребёнком проверяется на сервере. Прежде правило стояло на
тестах отдельных ручек — новая ручка без проверки не роняла ничего. Этот тест
обходит все маршруты приложения и падает на первой ручке без проверки.

Исключения перечислены поимённо и с причиной: молча пропустить ручку нельзя.

Тест видит только `patient_id` в пути. Ручки, где он приходит телом
(`/ai/parse`, `/ai/assistant/messages`, `/calc/*`, `/auth/invitations`),
проверяют доступ вручную через `assert_patient_access`, и новая ручка такого
вида этот тест не уронит — её проверка остаётся на ревью.
"""

from __future__ import annotations

from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from api.deps.auth import require_patient_access
from api.main import create_app

#: Ручки с `patient_id` в пути, которым проверка доступа к ребёнку не нужна.
#: Добавлять сюда — только с причиной, и ревью это увидит.
EXEMPT: dict[tuple[str, str], str] = {}


def _calls(dependant: Dependant) -> set[object]:
    found: set[object] = set()
    for sub in dependant.dependencies:
        if sub.call is not None:
            found.add(sub.call)
        found |= _calls(sub)
    return found


def _api_routes(routes: list[object]) -> list[APIRoute]:
    """Все `APIRoute` приложения, включая вложенные роутеры любой глубины."""

    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
            continue
        nested = getattr(route, "original_router", None) or getattr(route, "app", None)
        children = getattr(nested, "routes", None)
        if children:
            found.extend(_api_routes(list(children)))
    return found


def test_every_patient_route_checks_access() -> None:
    app = create_app()
    missing = []
    checked = 0
    for route in _api_routes(list(app.routes)):
        if not isinstance(route, APIRoute) or "{patient_id}" not in route.path:
            continue
        for method in sorted(route.methods or ()):
            if (method, route.path) in EXEMPT:
                continue
            checked += 1
            if require_patient_access not in _calls(route.dependant):
                missing.append(f"{method} {route.path}")

    assert checked > 50, "маршрутов с пациентом подозрительно мало — обход сломался"
    assert missing == [], "ручки с patient_id без require_patient_access:\n" + "\n".join(missing)
