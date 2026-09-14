"""Сценарии `/auth`: вход, 2FA, refresh, ограничение частоты (разделы 5.2, 11 ТЗ)."""

from __future__ import annotations

import pyotp
import pytest

from core.models.enums import UserRole

pytestmark = pytest.mark.asyncio

PASSWORD = "correct horse battery staple"


class TestBrokenTotpSecret:
    """Испорченный секрет второго фактора — отказ, а не поломка сервера.

    `pyotp` разбирает секрет как base32 и бросает `binascii.Error` на
    неразбираемой длине и на чужом знаке. Исключение уходило в middleware
    необработанным, и человек получал 500 «Внутренняя ошибка сервера» вместо
    отказа по коду — на входе врача, при смене второго фактора, при
    подтверждении настройки и при перевыпуске резервных кодов (issue #206).

    Секрет попадает в базу мимо приложения: `generate_totp_secret()` такого не
    даёт, а вот сид, ручная правка или миграция — могут.
    """

    #: Длина 27 знаков не разбирается как base32: восемь знаков кодируют пять
    #: байт, и остаток бывает только 0, 2, 4, 5 или 7.
    UNPARSEABLE = "A" * 27
    #: Цифры 0, 1, 8 и 9 в алфавит base32 не входят.
    FOREIGN_CHARACTER = "A" * 31 + "1"

    # Пустая строка сюда НЕ входит: это не испорченный секрет, а незаданный, и
    # вход отвечает на него «второй фактор не настроен» — см. отдельный тест
    # ниже. Держать её здесь значило бы требовать 401 там, где правильный ответ
    # другой.
    @pytest.mark.parametrize(
        "secret",
        [UNPARSEABLE, FOREIGN_CHARACTER, "секрет-администратора"],
        ids=["неразбираемая длина", "чужой знак", "неASCII"],
    )
    async def test_login_refuses_instead_of_failing(self, client, make_user, secret):
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "totp_code": "000000"},
        )

        assert response.status_code == 401, response.text
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_empty_secret_means_not_configured(self, client, make_user):
        """Пустой секрет — это «не настроен», а не тупик.

        Вход считал второй фактор настроенным по «поле не NULL», поэтому врач с
        пустой строкой получал `totp_required`, вводил верный код и получал
        отказ — войти было нельзя никогда. Рядом всё это время стояла нужная
        ветка: `totp_setup_required`.
        """
        doctor = await make_user(UserRole.DOCTOR, totp_secret="")

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD},
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "totp_setup_required"
        assert body["totp_setup_token"]

    async def test_parent_with_broken_secret_is_not_let_in_by_password_alone(
        self, client, make_user
    ):
        """Пустой секрет у родителя — не «второго фактора нет», а «он сломан».

        Первая редакция считала пустую строку ненастроенным фактором, и
        родитель, включавший 2FA, входил одним паролем — второй фактор снимался
        испорченной записью в базе. Правильный исход — принудительная
        перенастройка, а не пропуск.
        """
        parent = await make_user(UserRole.PARENT, totp_secret="")

        response = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "totp_setup_required"
        assert body["tokens"] is None

    async def test_setup_with_broken_secret_does_not_demand_a_code(self, client, make_user):
        """Стена не должна переехать с входа на экран настройки.

        Кабинет зовёт `/auth/totp/setup` сразу после `totp_setup_required`; с
        `is not None` там требовался текущий код, который у испорченного
        секрета никогда не сойдётся.
        """
        doctor = await make_user(UserRole.DOCTOR, totp_secret="")
        login = await client.post(
            "/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD}
        )
        token = login.json()["totp_setup_token"]

        setup = await client.post(
            "/api/v1/auth/totp/setup", json={}, headers={"Authorization": f"Bearer {token}"}
        )

        assert setup.status_code == 200, setup.text
        assert setup.json()["secret"]

    async def test_working_secret_still_lets_the_doctor_in(self, client, make_user):
        """Обратная сторона: рабочий секрет обязан пускать.

        Иначе «отказывать всегда» выглядело бы как починка.
        """
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": PASSWORD,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "ok"


class TestBrokenSecretOnOtherEndpoints:
    """Испорченный секрет: 401, а не 500 — на всех путях, а не только на входе.

    `verify_totp` зовётся из четырёх мест; до #218 каждое падало в 500, а
    тестом был закрыт только вход — сужение `except` обратно поймало бы лишь
    его (#221).
    """

    BROKEN = "секрет-администратора"

    async def test_totp_verify_refuses(self, client, session, make_user, auth_headers):
        """Подтверждение настройки: секрет-кандидат испорчен."""
        doctor = await make_user(UserRole.DOCTOR, totp_secret=pyotp.random_base32())
        doctor.totp_pending_secret = self.BROKEN
        await session.flush()

        response = await client.post(
            "/api/v1/auth/totp/verify",
            json={"code": "000000"},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 401, response.text
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_totp_setup_refuses(self, client, make_user, auth_headers):
        """Смена фактора: действующий секрет испорчен, код не сойдётся."""
        doctor = await make_user(UserRole.DOCTOR, totp_secret=self.BROKEN)

        response = await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": "000000"},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 401, response.text

    async def test_backup_codes_regenerate_refuses(self, client, make_user, auth_headers):
        """Перевыпуск резервных кодов."""
        doctor = await make_user(UserRole.DOCTOR, totp_secret=self.BROKEN)

        response = await client.post(
            "/api/v1/auth/backup-codes",
            json={"totp_code": "000000"},
            headers=auth_headers(doctor),
        )

        assert response.status_code == 401, response.text


class TestTotpPredicate:
    """«Включён» и «пригоден» — два предиката, и оба живут в модели (#219).

    Их было три, и на испорченном секрете карточка администратора говорила
    «настроен», а вход — «не настроен»; по этой же карточке администратор
    решает, сбрасывать ли фактор.
    """

    async def test_broken_secret_is_enrolled_but_not_usable(self, session, make_user):
        user = await make_user(UserRole.DOCTOR, totp_secret="")

        assert user.totp_enrolled is True, "секрет записан — фактор включался"
        assert user.has_totp is False, "но подтвердить им код нельзя"

    async def test_admin_card_agrees_with_login(self, client, session, make_user, auth_headers):
        """Карточка администратора и вход отвечают одинаково.

        Прежде карточка брала `is not None`, а вход — `bool`: на пустом секрете
        админ видел «настроен» и не сбрасывал фактор человеку, который войти не
        мог.
        """
        admin = await make_user(UserRole.ADMIN, totp_secret=pyotp.random_base32())
        doctor = await make_user(UserRole.DOCTOR, totp_secret="")

        listing = await client.get("/api/v1/admin/users", headers=auth_headers(admin))
        assert listing.status_code == 200, listing.text
        card = next(row for row in listing.json()["items"] if row["id"] == str(doctor.id))

        assert card["has_totp"] is False


class TestVerifyTotp:
    """Сама проверка кода: хвост блока, чужой знак, неASCII — и два рабочих."""

    @pytest.mark.parametrize(
        "secret",
        ["A" * 27, "A" * 30, "A" * 31 + "1", "секрет-администратора"],
        ids=["остаток 3", "остаток 6", "цифра 1", "неASCII"],
    )
    async def test_broken_secret_answers_false(self, secret):
        from api.security import verify_totp

        assert verify_totp(secret, "123456") is False

    async def test_missing_secret_answers_false(self):
        """Отсутствующий секрет — тоже «код не подтверждён», а не исключение.

        `verify_totp` тотальна по секрету намеренно: `pyotp` на `None` падает
        «object of type NoneType has no len()», и без этой ветки сужение типа
        расползлось бы по четырём вызовам в роутере.
        """
        from api.security import verify_totp

        assert verify_totp(None, "123456") is False
        assert verify_totp("", "123456") is False

    async def test_working_secret_answers_true(self):
        from api.security import verify_totp

        secret = pyotp.random_base32()
        assert verify_totp(secret, pyotp.TOTP(secret).now()) is True

    async def test_lowercase_secret_still_works(self):
        """Регистр не портит секрет: `pyotp` декодирует с `casefold=True`.

        Отвергать строчный значило бы отказывать рабочему значению — этот же
        довод разбирался в #202.
        """
        from api.security import verify_totp

        secret = pyotp.random_base32()
        assert verify_totp(secret.lower(), pyotp.TOTP(secret).now()) is True


class TestLogin:
    async def test_parent_logs_in_without_totp(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "ok"
        assert body["tokens"]["access_token"]

    async def test_wrong_password_rejected(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": "wrong-password"}
        )
        assert response.status_code == 401

    async def test_unknown_email_and_wrong_password_are_indistinguishable(
        self, client, session, make_user
    ):
        """Ответы не должны позволять перебирать существующие учётные записи."""
        parent = await make_user(UserRole.PARENT)

        unknown = await client.post(
            "/api/v1/auth/login",
            json={"email": "nobody-here@example.com", "password": PASSWORD},
        )
        wrong = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": "wrong-password"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.json() == wrong.json()

    async def test_disabled_account_indistinguishable_from_wrong_password(
        self, client, session, make_user
    ):
        """Отдельный ответ для отключённой учётки подтверждал бы, что email существует."""
        disabled = await make_user(UserRole.PARENT, is_active=False)
        response = await client.post(
            "/api/v1/auth/login", json={"email": disabled.email, "password": PASSWORD}
        )
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthorized"

    async def test_doctor_with_totp_requires_code(self, client, session, make_user):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        # Кода ещё не спрашивали — это шаг входа, а не ошибка. Проверка была
        # обратной (`401`), и клиент на этом строился: он узнавал о втором
        # факторе, ЛОВЯ ошибку. Врач видел «Неверный код подтверждения.» на
        # первом же экране, журнал аудита получал `login_failed_totp` на каждый
        # нормальный вход, а лимит входа тратил две попытки из пяти.
        without = await client.post(
            "/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD}
        )
        assert without.status_code == 200, without.text
        assert without.json()["status"] == "totp_required"
        assert without.json()["tokens"] is None

        wrong_code = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "totp_code": "000000"},
        )
        assert wrong_code.status_code == 401

        with_code = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": PASSWORD,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert with_code.status_code == 200
        assert with_code.json()["status"] == "ok"

    async def test_step_of_login_is_not_written_to_audit_as_failure(
        self, client, make_user, monkeypatch
    ):
        """Журнал аудита ведётся ради перебора кодов — и должен его показывать.

        Пока «кода ещё не спрашивали» было ошибкой, `login_failed_totp`
        появлялся на КАЖДЫЙ вход врача. Администратор, открывший журнал, видел
        столько же фальшивых провалов, сколько было нормальных входов, и
        настоящий перебор в этом шуме не отличался ничем.

        Проверяется вызов, а не строка в таблице: неудачный вход пишется
        `write_audit_log_independent` — в собственной транзакции, которая в
        тестах не видит ещё не закоммиченного пользователя и молча падает на
        внешнем ключе (ошибка аудита не должна превращать 401 в 500). То есть
        строку здесь не увидеть в принципе, а вызов — увидеть можно.
        """
        from api.routers import auth as auth_router

        calls: list[str] = []
        original = auth_router.audit_repo.write_audit_log_independent

        async def spy(**kwargs: object) -> None:
            calls.append(str(kwargs.get("action")))
            await original(**kwargs)  # type: ignore[arg-type]

        monkeypatch.setattr(auth_router.audit_repo, "write_audit_log_independent", spy)

        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        await client.post("/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD})
        assert calls == [], "шаг входа — не провал второго фактора"

        await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "totp_code": "000000"},
        )
        assert calls == ["login_failed_totp"], "а вот неверный код — провал"

    async def test_login_response_shape_for_web_cabinet(self, client, session, make_user):
        """Потребитель — `apps/web` (`LoginPage`): по `status` он решает, какой
        шаг показать, и своих догадок о втором факторе не делает.

        Тест здесь, а не только во фронтенде, по правилу «стык проверяется на
        стороне поставщика»: подделка в тестах кабинета повторяет представления
        автора о контракте, а не сам контракт.
        """
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        step = await client.post(
            "/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD}
        )
        body = step.json()

        assert step.status_code == 200
        assert set(body) >= {"status", "tokens"}
        assert body["status"] == "totp_required"
        # Ни токенов, ни токена настройки: это ещё не вход и не первичная
        # настройка — только запрос кода.
        assert body["tokens"] is None
        assert body["totp_setup_token"] is None

    async def test_parent_who_enabled_totp_must_supply_code(self, client, session, make_user):
        """Для родителя 2FA опциональна, но если включена — обязательна при входе."""
        secret = pyotp.random_base32()
        parent = await make_user(UserRole.PARENT, totp_secret=secret)

        without = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        assert without.status_code == 200, without.text
        assert without.json()["status"] == "totp_required"
        assert without.json()["tokens"] is None


class TestTotpChange:
    async def test_changing_existing_totp_requires_current_code(
        self, client, session, make_user, auth_headers
    ):
        """Угнанный access-токен не должен позволять молча заменить второй фактор."""
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        headers = auth_headers(doctor)

        without_code = await client.post("/api/v1/auth/totp/setup", json={}, headers=headers)
        assert without_code.status_code == 401

        with_code = await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=headers,
        )
        assert with_code.status_code == 200

    async def test_pending_secret_does_not_replace_active_until_verified(
        self, client, session, make_user, auth_headers
    ):
        """До подтверждения действующий второй фактор продолжает работать."""
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)

        await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=auth_headers(doctor),
        )

        await session.refresh(doctor)
        assert doctor.totp_secret == secret, "старый секрет не меняется до verify"
        assert doctor.totp_pending_secret is not None

    async def test_verify_activates_new_secret(self, client, session, make_user, auth_headers):
        old_secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=old_secret)
        headers = auth_headers(doctor)

        setup = await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(old_secret).now()},
            headers=headers,
        )
        new_secret = setup.json()["secret"]

        verified = await client.post(
            "/api/v1/auth/totp/verify",
            json={"code": pyotp.TOTP(new_secret).now()},
            headers=headers,
        )
        assert verified.status_code == 200

        await session.refresh(doctor)
        assert doctor.totp_secret == new_secret
        assert doctor.totp_pending_secret is None

    async def test_verify_with_wrong_code_rejected(self, client, session, make_user, auth_headers):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        headers = auth_headers(doctor)
        await client.post(
            "/api/v1/auth/totp/setup",
            json={"current_code": pyotp.TOTP(secret).now()},
            headers=headers,
        )

        response = await client.post(
            "/api/v1/auth/totp/verify", json={"code": "000000"}, headers=headers
        )
        assert response.status_code == 401

        await session.refresh(doctor)
        assert doctor.totp_secret == secret, "неверный код не активирует новый секрет"


class TestRefresh:
    async def test_refresh_returns_new_pair(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        refresh_token = login.json()["tokens"]["refresh_token"]

        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert response.status_code == 200, response.text
        assert response.json()["access_token"]

    async def test_access_token_not_accepted_as_refresh(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        access_token = login.json()["tokens"]["access_token"]

        response = await client.post("/api/v1/auth/refresh", json={"refresh_token": access_token})
        assert response.status_code == 401

    async def test_missing_token_rejected(self, client):
        response = await client.post("/api/v1/auth/refresh", json={})
        assert response.status_code == 401


class TestRateLimiting:
    """Раздел 11 ТЗ: `/auth/*` — 5 запросов в минуту на IP.

    Без лимита `POST /auth/login` открыт для перебора пароля и шестизначного
    TOTP-кода.
    """

    async def test_login_is_rate_limited(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        statuses = [
            (await client.post("/api/v1/auth/login", json=payload)).status_code for _ in range(7)
        ]

        assert 429 in statuses, f"перебор пароля не ограничивается: {statuses}"
        assert statuses.index(429) >= 5, f"лимит сработал раньше 5 попыток: {statuses}"

    async def test_rate_limited_response_uses_standard_error_shape(
        self, client, session, make_user
    ):
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        response = None
        for _ in range(8):
            response = await client.post("/api/v1/auth/login", json=payload)
            if response.status_code == 429:
                break

        assert response is not None and response.status_code == 429
        error = response.json()["error"]
        assert error["code"] == "rate_limited"
        assert isinstance(error["message"], str) and error["message"]


class TestTotpSetupIdempotency:
    """Повторный вызов /totp/setup обязан вернуть тот же секрет-кандидат.

    Иначе пользователь, перезагрузивший страницу после сканирования QR (или любой
    повторный вызов — двойной клик, повторный запуск эффекта в React), получил бы
    новый секрет, а код из приложения перестал бы подходить к сохранённому в базе.
    """

    async def test_repeated_setup_returns_same_secret(
        self, client, session, make_user, auth_headers
    ):
        secret = pyotp.random_base32()
        doctor = await make_user(UserRole.DOCTOR, totp_secret=secret)
        headers = auth_headers(doctor)
        body = {"current_code": pyotp.TOTP(secret).now()}

        first = await client.post("/api/v1/auth/totp/setup", json=body, headers=headers)
        second = await client.post("/api/v1/auth/totp/setup", json=body, headers=headers)

        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["secret"] == second.json()["secret"]

    async def test_code_from_first_response_still_verifies_after_second_call(
        self, client, session, make_user, auth_headers
    ):
        """Именно этот сценарий ломался: показанный пользователю секрет расходился
        с сохранённым, и правильный код отклонялся."""
        doctor = await make_user(UserRole.DOCTOR)
        headers = auth_headers(doctor)

        first = await client.post("/api/v1/auth/totp/setup", json={}, headers=headers)
        shown_secret = first.json()["secret"]
        await client.post("/api/v1/auth/totp/setup", json={}, headers=headers)

        verified = await client.post(
            "/api/v1/auth/totp/verify",
            json={"code": pyotp.TOTP(shown_secret).now()},
            headers=headers,
        )
        assert verified.status_code == 200, verified.text


class TestRefreshRateLimit:
    """Обновление сессии не должно попадать под антибрутфорс-лимит входа.

    SPA вызывает /auth/refresh при каждой загрузке страницы; со строгим лимитом
    пары перезагрузок хватало, чтобы запереть пользователя на минуту, а за одним
    NAT под лимит попадали все сразу.
    """

    async def test_repeated_refresh_not_locked_out(self, client, session, make_user):
        parent = await make_user(UserRole.PARENT)
        login = await client.post(
            "/api/v1/auth/login", json={"email": parent.email, "password": PASSWORD}
        )
        token = login.json()["tokens"]["refresh_token"]

        statuses = [
            (await client.post("/api/v1/auth/refresh", json={"refresh_token": token})).status_code
            for _ in range(10)
        ]
        assert 429 not in statuses, f"обновление сессии заблокировано лимитом: {statuses}"

    async def test_login_still_strictly_limited(self, client, session, make_user):
        """Послабление касается только refresh: подбор пароля по-прежнему ограничен."""
        parent = await make_user(UserRole.PARENT)
        payload = {"email": parent.email, "password": "wrong-password"}

        statuses = [
            (await client.post("/api/v1/auth/login", json=payload)).status_code for _ in range(7)
        ]
        assert 429 in statuses
