"""Нагрузочный прогон: 100 одновременных пользователей (раздел 15 п. 22 ТЗ).

Профиль повторяет **дневную работу семьи**, а не синтетический шторм по одной
ручке. Родителей на порядок больше, чем специалистов, и делают они одно и то же:
открывают главную, смотрят план дня, записывают кетоны и вес. Именно эти ручки и
должны держать нагрузку — врач с отчётом за квартал приходит редко, но стоит
дорого, поэтому он здесь тоже есть, только реже.

Что НЕ нагружается сознательно:

- **ИИ-ручки.** Каждый вызов — деньги из общего дневного бюджета, и сто
  одновременных разборов выжгли бы его за минуту, ничего не измерив: узкое место
  там у Anthropic, а не у нас.
- **Сборка PDF.** Её делает воркер, ручка только ставит задачу; нагружать очередь
  осмысленно отдельным прогоном, а не вместе с чтением экранов.
- **Вход.** `/auth/*` ограничен пятью запросами в минуту на адрес (раздел 11 ТЗ),
  и сто пользователей упёрлись бы в ограничитель, а не в базу — первый прогон
  так и сделал: пять входов прошло, пятнадцать получили 429. Поэтому вход
  выполняется **один раз на весь прогон**, а токен разделяют все пользователи.
  Для измерения чтения это ничего не меняет: ключ ограничителя — адрес, а не
  учётная запись, и база не знает, сколько сессий за одним токеном.

Запуск: `make load` (нужен поднятый API и `make seed-e2e`).
Пороги и разбор результатов — в `infra/load/README.md`.
"""

from __future__ import annotations

import os
import random

import requests
from locust import HttpUser, between, events, task

PARENT_EMAIL = os.environ.get("LOAD_PARENT_EMAIL", "e2e-parent@example.com")
PASSWORD = os.environ.get("E2E_PASSWORD", "e2e correct horse battery staple")

#: Общий на весь прогон вход: токен и ребёнок, с которыми ходят все
#: пользователи. Заполняется один раз на старте.
_SESSION: dict[str, str] = {}


@events.test_start.add_listener
def _prepare(environment, **_: object) -> None:
    host = environment.host or ""
    if "railtech" in host or host.startswith("https://"):
        print(
            "ВНИМАНИЕ: цель похожа на настоящий стенд. Нагрузочный прогон "
            "пишет записи в дневник — гоняйте его по локальной базе."
        )

    # Один вход на весь прогон. Сто входов подряд — это не нагрузка на базу, а
    # проверка ограничителя частоты: он их и остановит на пятом.
    login = requests.post(
        f"{host}/api/v1/auth/login",
        json={"email": PARENT_EMAIL, "password": PASSWORD},
        timeout=10,
    )
    if login.status_code != 200:
        raise RuntimeError(
            f"Вход не удался ({login.status_code}). Выполните `make seed-e2e`. {login.text[:200]}"
        )
    token = (login.json().get("tokens") or {}).get("access_token")
    if not token:
        raise RuntimeError(f"Ответ входа без токена: {login.json()}")

    patients = requests.get(
        f"{host}/api/v1/patients?limit=1&offset=0",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    ).json()
    items = patients.get("items") or []
    if not items:
        raise RuntimeError("У учётной записи нет пациентов — выполните `make seed-e2e`.")

    _SESSION["token"] = token
    _SESSION["patient_id"] = items[0]["id"]


class Parent(HttpUser):
    """Семья: смотрит экраны, изредка записывает."""

    wait_time = between(1, 4)

    def on_start(self) -> None:
        self.client.headers["Authorization"] = f"Bearer {_SESSION['token']}"
        self.patient_id = _SESSION["patient_id"]

    @task(10)
    def overview(self) -> None:
        """Главная — самый частый экран: его открывают при каждом заходе."""

        self.client.get(f"/api/v1/patients/{self.patient_id}/overview", name="/overview")

    @task(6)
    def menu_of_the_day(self) -> None:
        self.client.get(
            f"/api/v1/patients/{self.patient_id}/menus?date=2026-09-04", name="/menus?date"
        )

    @task(4)
    def diary(self) -> None:
        self.client.get(
            f"/api/v1/patients/{self.patient_id}/logs/ketones?limit=20&offset=0",
            name="/logs/ketones",
        )

    @task(3)
    def products(self) -> None:
        """Поиск продукта — полнотекстовый запрос, самый тяжёлый из читающих."""

        self.client.get("/api/v1/products?q=масло&limit=20&offset=0", name="/products?q")

    @task(1)
    def write_ketone(self) -> None:
        self.client.post(
            f"/api/v1/patients/{self.patient_id}/logs/ketones",
            json={
                "occurred_at": "2026-09-04T08:00:00Z",
                "value": round(random.uniform(1.5, 4.0), 1),
                "method": "blood",
            },
            name="POST /logs/ketones",
        )


class Doctor(HttpUser):
    """Специалист: приходит реже, но берёт отчёт за период — самый дорогой запрос.

    Вес класса задаётся на запуске (`--class-picker` или `weight`), по умолчанию
    locust распределяет пользователей поровну; для профиля «врачей на порядок
    меньше» вес занижен явно.
    """

    weight = 1
    wait_time = between(5, 15)

    def on_start(self) -> None:
        # Врачу обязателен второй фактор, а держать в нагрузочном скрипте
        # настоящий вход с TOTP значило бы держать в нём секрет. Профиль
        # специалиста измеряет отчёт, а не аутентификацию, поэтому ходит он с
        # тем же токеном: отчёт по своему ребёнку доступен и семье.
        self.client.headers["Authorization"] = f"Bearer {_SESSION['token']}"
        self.patient_id = _SESSION["patient_id"]

    @task
    def report(self) -> None:
        self.client.get(
            f"/api/v1/patients/{self.patient_id}/report?from=2026-08-01&to=2026-08-31",
            name="/report",
        )


Parent.weight = 10
