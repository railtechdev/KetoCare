"""Настройки бота: отказ не должен утаскивать секреты в журнал.

Дефект был живым, а не выдуманным. На пред-проде без токена BotFather контейнер
бота падал с `ValidationError`, тот печатал `input_value` целиком — вместе с
`bot_api_token`, — а `restart: unless-stopped` повторял это каждые несколько
секунд. Сервисный токен, дающий боту доступ к API, набивался в `docker logs`
сутками и был виден любому, у кого есть доступ к серверу.
"""

from __future__ import annotations

import pytest

from bot.config import load_settings

SECRET = "СЛУЖЕБНЫЙ-ТОКЕН-НЕ-ДЛЯ-ЖУРНАЛА"


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch, tmp_path):
    """Ни переменных окружения разработчика, ни его `.env` рядом.

    `BotSettings` читает `.env` из текущего каталога, и без смены каталога тест
    подхватил бы рабочие настройки и ничего не проверил.
    """

    for name in ("BOT_TOKEN", "BOT_API_TOKEN", "BOT_USERNAME", "REDIS_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)


def test_missing_token_names_the_field(capsys):
    with pytest.raises(SystemExit) as exit_info:
        load_settings()

    # 78 — EX_CONFIG: ошибка конфигурации, а не сбой программы.
    assert exit_info.value.code == 78
    message = capsys.readouterr().err
    assert "BOT_TOKEN" in message, "человек должен узнать, чего именно не хватает"
    assert "BOT_API_TOKEN" in message


def test_secret_value_never_reaches_the_log(monkeypatch, capsys):
    """Заполнен сервисный токен, не заполнен токен BotFather — ровно случай стенда."""

    monkeypatch.setenv("BOT_API_TOKEN", SECRET)

    with pytest.raises(SystemExit):
        load_settings()

    captured = capsys.readouterr()
    assert SECRET not in captured.err, "значение секрета попало в вывод"
    assert SECRET not in captured.out, "значение секрета попало в вывод"


def test_returns_settings_when_environment_is_complete(monkeypatch):
    monkeypatch.setenv("BOT_TOKEN", "000000:тестовый-токен")
    monkeypatch.setenv("BOT_API_TOKEN", SECRET)

    settings = load_settings()

    assert settings.bot_token == "000000:тестовый-токен"
    assert settings.bot_api_token == SECRET
