"""`GET /health/ai` — стык с монитором доступности.

Потребитель — `infra/scripts/uptime_check.py` (`.github/workflows/uptime.yml`):
он читает `jobs.succeeded`, `jobs.failed`, `jobs.stuck`, `failure_classes`,
`last_failure_class`, `last_success_at`, `daily_budget_exhausted` и
`configured.*` и по ним решает, красить ли стенд. Тест монитора работает с
подделкой ответа, поэтому форма закреплена здесь, на стороне поставщика.

Здесь же — то, чем ручка не должна быть: открытой без токена, болтливой о
тексте ошибки и о значениях переменных.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from api.services.ai_health import error_class
from core.config import get_settings
from core.models import AiJob
from core.models.enums import AiJobKind, AiJobStatus, UserRole

URL = "/api/v1/health/ai"
TOKEN = "monitor-" + "x" * 40

#: То, что стенд писал в журнал с 08.09.2026, — в том виде, в каком его
#: сохраняет `worker.ai.client._describe_failure`.
SCOPED_KEY_ERROR = (
    "BadRequestError: Error code: 400 - {'type': 'error', 'error': {'type': "
    "'invalid_request_error', 'message': 'API key is not scoped to a workspace. "
    "Key sk-ant-api03-SECRETSECRETSECRET'}, 'request_id': 'req_011CSecret'}"
)


@pytest.fixture
def monitor_token(monkeypatch):
    monkeypatch.setattr(get_settings(), "monitor_token", TOKEN)
    return TOKEN


async def _job(session, user, *, status: AiJobStatus, error: str | None = None, age=None):
    now = datetime.now(UTC)
    job = AiJob(
        kind=AiJobKind.ASSISTANT,
        status=status,
        requested_by=user.id,
        patient_id=None,
        input={"payload": {"секрет": "имя ребёнка"}, "user_text": "текст родителя"},
        output={"text": "ответ модели"} if status == AiJobStatus.DONE else None,
        model="claude-haiku-4-5",
        error=error,
        finished_at=None if status == AiJobStatus.RUNNING else now,
    )
    if age is not None:
        job.created_at = now - age
    session.add(job)
    await session.flush()
    return job


class TestAccess:
    async def test_absent_without_configured_token(self, client, monkeypatch):
        """Без настройки ручки нет: ответ неотличим от несуществующего адреса."""

        monkeypatch.setattr(get_settings(), "monitor_token", "")
        missing = await client.get("/api/v1/health/nothing-here")

        response = await client.get(URL, headers={"Authorization": "Bearer "})

        assert response.status_code == 404
        assert response.json() == missing.json()

    async def test_short_token_disables_the_route(self, client, monkeypatch):
        monkeypatch.setattr(get_settings(), "monitor_token", "short")

        response = await client.get(URL, headers={"Authorization": "Bearer short"})

        assert response.status_code == 404

    @pytest.mark.parametrize(
        "headers",
        [
            {},
            {"Authorization": "Bearer wrong-token"},
            {"Authorization": f"Basic {TOKEN}"},
            {"X-Monitor-Token": TOKEN[:-1]},
            {"X-Monitor-Token": TOKEN + "x"},
        ],
    )
    async def test_wrong_token_is_401(self, client, monitor_token, headers):
        response = await client.get(URL, headers=headers)

        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"
        assert TOKEN not in response.text

    async def test_user_session_is_not_a_monitor(
        self, client, monitor_token, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)

        response = await client.get(URL, headers=auth_headers(admin))

        assert response.status_code == 401

    @pytest.mark.parametrize("header", ["Authorization", "X-Monitor-Token"])
    async def test_both_headers_accepted(self, client, monitor_token, header):
        value = f"Bearer {TOKEN}" if header == "Authorization" else TOKEN

        response = await client.get(URL, headers={header: value})

        assert response.status_code == 200

    async def test_not_in_openapi(self, client):
        from api.main import create_app

        assert "/api/v1/health/ai" not in create_app().openapi()["paths"]


class TestContract:
    async def test_shape_read_by_the_uptime_monitor(self, client, monitor_token):
        response = await client.get(URL, headers={"Authorization": f"Bearer {TOKEN}"})

        assert response.status_code == 200
        body = response.json()
        assert set(body) == {
            "window_hours",
            "checked_at",
            "jobs",
            "last_success_at",
            "last_failure_at",
            "last_failure_class",
            "failure_classes",
            "daily_budget_exhausted",
            "configured",
        }
        assert body["window_hours"] == 24
        assert set(body["jobs"]) == {"succeeded", "failed", "running", "stuck"}
        assert set(body["configured"]) == {"api_key", "model_fast", "model_smart"}
        assert all(isinstance(v, bool) for v in body["configured"].values())
        assert isinstance(body["daily_budget_exhausted"], bool)

    async def test_counts_and_classes(self, client, session, monitor_token, make_user):
        headers = {"X-Monitor-Token": TOKEN}
        before = (await client.get(URL, headers=headers)).json()
        user = await make_user(UserRole.PARENT)

        await _job(session, user, status=AiJobStatus.DONE)
        await _job(session, user, status=AiJobStatus.FAILED, error=SCOPED_KEY_ERROR)
        await _job(session, user, status=AiJobStatus.FAILED, error=SCOPED_KEY_ERROR)
        await _job(session, user, status=AiJobStatus.RUNNING)
        await _job(session, user, status=AiJobStatus.RUNNING, age=timedelta(hours=2))
        # Вне окна наблюдения — в счёт не идёт.
        await _job(session, user, status=AiJobStatus.DONE, age=timedelta(hours=30))

        body = (await client.get(URL, headers=headers)).json()

        delta = {k: body["jobs"][k] - before["jobs"][k] for k in body["jobs"]}
        assert delta == {"succeeded": 1, "failed": 2, "running": 1, "stuck": 1}
        assert body["last_failure_class"] == "BadRequestError 400 invalid_request_error"
        classes = {c["error_class"]: c["count"] for c in body["failure_classes"]}
        assert classes["BadRequestError 400 invalid_request_error"] >= 2
        assert body["last_success_at"] is not None
        assert body["last_failure_at"] is not None

    async def test_leaks_nothing(self, client, session, monitor_token, make_user, monkeypatch):
        """Ни текста ошибки, ни нагрузки, ни ответа, ни значений переменных."""

        settings = get_settings()
        monkeypatch.setattr(settings, "anthropic_api_key", "sk-ant-api03-REALKEYVALUE")
        monkeypatch.setattr(settings, "ai_model_smart", "claude-secret-model-name")
        user = await make_user(UserRole.PARENT)
        await _job(session, user, status=AiJobStatus.DONE)
        await _job(session, user, status=AiJobStatus.FAILED, error=SCOPED_KEY_ERROR)

        response = await client.get(URL, headers={"X-Monitor-Token": TOKEN})

        text = response.text
        for secret in (
            "SECRETSECRET",
            "sk-ant",
            "REALKEYVALUE",
            "claude-secret-model-name",
            "not scoped",
            "req_011",
            "имя ребёнка",
            "текст родителя",
            "ответ модели",
            TOKEN,
        ):
            assert secret not in text
        assert response.json()["configured"]["api_key"] is True


class TestErrorClass:
    @pytest.mark.parametrize(
        ("error", "expected"),
        [
            (SCOPED_KEY_ERROR, "BadRequestError 400 invalid_request_error"),
            (
                'AuthenticationError: Error code: 401 - {"type": "error", "error": '
                '{"type": "authentication_error", "message": "invalid x-api-key"}}',
                "AuthenticationError 401 authentication_error",
            ),
            ("APITimeoutError: Request timed out.", "APITimeoutError"),
            ("Модель не вернула текст: stop_reason=refusal", "EmptyResponse stop_reason=refusal"),
            (
                "Обращение к модели не завершилось: процесс воркера прервался.",
                "WorkerInterrupted",
            ),
            ("sk-ant-api03-abcdef: что-то", "Unknown"),
            (
                "BadRequestError: Error code: 400 - {'error': {'message': \"{'type': "
                "'leaked_secret_word_error'}\", 'type': 'invalid_request_error'}}",
                "BadRequestError 400 invalid_request_error",
            ),
            ("", "Unknown"),
            (None, "Unknown"),
            ("X" * 500 + ": boom", "Unknown"),
        ],
    )
    def test_only_the_class_survives(self, error, expected):
        assert error_class(error) == expected

    def test_length_is_capped(self):
        error = "A" * 64 + ": Error code: 500 - {'type': '" + "a" * 39 + "_error'}"

        assert len(error_class(error)) <= 80
