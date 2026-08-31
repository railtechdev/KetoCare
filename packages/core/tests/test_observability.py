"""Отправка ошибок: включается только по DSN и не увозит лишнего."""

from __future__ import annotations

from typing import Any

from core import observability


class TestInitIsOptIn:
    def test_without_dsn_nothing_happens(self, monkeypatch) -> None:
        """По умолчанию ничего не отправляется никуда."""

        monkeypatch.setattr(observability, "get_settings", lambda: _settings(dsn=""))
        assert observability.init_sentry("api") is False


class TestScrubbing:
    """Sentry — внешняя служба, а в запросах KetoCare ходят клинические данные."""

    def test_request_body_and_query_are_dropped(self) -> None:
        event: Any = {
            "request": {
                "url": "https://app.example.com/api/v1/patients/3f2a/logs",
                "query_string": "date=2026-08-30&q=масло",
                "data": {"value": 3.2, "note": "самочувствие ребёнка"},
                "cookies": {"refresh_token": "секрет"},
                "method": "POST",
            }
        }

        scrubbed: Any = observability._scrub_event(event, {})

        assert "query_string" not in scrubbed["request"]
        assert "data" not in scrubbed["request"], "тело запроса не уходит наружу"
        assert "cookies" not in scrubbed["request"]
        # Путь остаётся: без него непонятно, где сломалось. Идентификатор
        # пациента в нём — псевдоним, сам по себе он никого не называет.
        assert scrubbed["request"]["url"].endswith("/logs")

    def test_event_without_request_is_left_alone(self) -> None:
        event: Any = {"exception": {"values": []}}
        assert observability._scrub_event(event, {}) == event


def _settings(*, dsn: str) -> Any:
    class _Fake:
        sentry_dsn = dsn
        sentry_environment = "test"

    return _Fake()
