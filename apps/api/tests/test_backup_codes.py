"""Восстановление доступа: резервные коды и сброс второго фактора.

До этого потерянный телефон означал потерю учётной записи навсегда: отключить
второй фактор нельзя (раздел 7 ТЗ требует его для admin/doctor/dietitian),
сброса не было ни у кого, восстановления пароля в продукте нет. Для системы, где
врач должен попасть в данные ребёнка сейчас, это неприемлемо.

Практика — NIST SP 800-63B, §5.1.2 (look-up secrets).
"""

from __future__ import annotations

import pyotp
import pytest

from core.models.enums import UserRole
from core.repositories import backup_codes as backup_codes_repo

pytestmark = pytest.mark.asyncio

PASSWORD = "correct horse battery staple"


async def _enable_totp(client, user) -> list[str]:
    """Проходит первичную настройку 2FA и возвращает выданные резервные коды."""

    login = await client.post(
        "/api/v1/auth/login", json={"email": user.email, "password": PASSWORD}
    )
    assert login.json()["status"] == "totp_setup_required"
    headers = {"Authorization": f"Bearer {login.json()['totp_setup_token']}"}

    setup = await client.post("/api/v1/auth/totp/setup", json={}, headers=headers)
    secret = setup.json()["secret"]

    verify = await client.post(
        "/api/v1/auth/totp/verify",
        json={"code": pyotp.TOTP(secret).now()},
        headers=headers,
    )
    assert verify.status_code == 200
    return verify.json()["backup_codes"]


class TestBackupCodes:
    async def test_enabling_totp_issues_codes_once(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)

        codes = await _enable_totp(client, doctor)

        assert len(codes) == backup_codes_repo.BACKUP_CODE_COUNT
        assert len(set(codes)) == len(codes)
        # Показать повторно невозможно: в базе только sha256.
        assert all("-" in code for code in codes)

    async def test_login_with_backup_code(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]},
        )

        assert response.status_code == 200
        assert response.json()["tokens"]["access_token"]

    async def test_backup_code_works_once(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)
        body = {"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]}

        assert (await client.post("/api/v1/auth/login", json=body)).status_code == 200

        # Иначе список кодов, попавший в чужие руки, открывал бы вход
        # неограниченно долго — то есть переставал быть одноразовым.
        repeat = await client.post("/api/v1/auth/login", json=body)
        assert repeat.status_code == 401

    async def test_code_accepted_as_written_down(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        # Код переписывают с экрана на бумагу и набирают руками. Отвергать
        # строчные буквы, пробелы и пропущенный дефис значило бы отказывать в
        # доступе за форматирование при верном коде.
        sloppy = codes[0].replace("-", " ").lower()
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": sloppy},
        )

        assert response.status_code == 200

    async def test_wrong_backup_code_rejected(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        await _enable_totp(client, doctor)

        response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": PASSWORD,
                "backup_code": "ZZZZZ-ZZZZZ",
            },
        )

        assert response.status_code == 401

    async def test_backup_code_of_another_user_rejected(self, client, make_user):
        one = await make_user(UserRole.DOCTOR)
        two = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, one)
        await _enable_totp(client, two)

        response = await client.post(
            "/api/v1/auth/login",
            json={"email": two.email, "password": PASSWORD, "backup_code": codes[0]},
        )

        assert response.status_code == 401

    async def test_deactivated_account_rejected_even_with_valid_code(
        self, client, make_user, session
    ):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        doctor.is_active = False
        await session.flush()

        # Резервный код — второй фактор, а не обход первого: он проверяется
        # после пароля и после признака активности. Перестановка проверок
        # открыла бы вход отключённой учётной записи, у которой на руках
        # остался старый список кодов.
        response = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]},
        )

        assert response.status_code == 401

    async def test_wrong_password_with_valid_code_rejected(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        response = await client.post(
            "/api/v1/auth/login",
            json={
                "email": doctor.email,
                "password": "не тот пароль",
                "backup_code": codes[0],
            },
        )

        assert response.status_code == 401

        # И код при этом не сгорел: неудачная попытка с чужим паролем не должна
        # расходовать коды владельца — иначе перебор пароля выжигал бы их все.
        good = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]},
        )
        assert good.status_code == 200

    async def test_status_and_regenerate(self, client, make_user, session):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        login = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]},
        )
        headers = {"Authorization": f"Bearer {login.json()['tokens']['access_token']}"}

        status = await client.get("/api/v1/auth/backup-codes", headers=headers)
        assert status.json()["remaining"] == backup_codes_repo.BACKUP_CODE_COUNT - 1

        await session.refresh(doctor)
        assert doctor.totp_secret is not None
        fresh = await client.post(
            "/api/v1/auth/backup-codes",
            json={"totp_code": pyotp.TOTP(doctor.totp_secret).now()},
            headers=headers,
        )
        assert fresh.status_code == 200
        new_codes = fresh.json()["codes"]
        assert set(new_codes).isdisjoint(codes)

        # Прежний набор перестаёт работать: ради этого перевыпуск и затевают.
        stale = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[1]},
        )
        assert stale.status_code == 401

    async def test_regenerate_requires_totp_code(self, client, make_user):
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)
        login = await client.post(
            "/api/v1/auth/login",
            json={"email": doctor.email, "password": PASSWORD, "backup_code": codes[0]},
        )
        headers = {"Authorization": f"Bearer {login.json()['tokens']['access_token']}"}

        # Иначе чужой доступ к незакрытой вкладке превращался бы в постоянный:
        # выпустил себе набор кодов — и второй фактор больше не нужен.
        response = await client.post(
            "/api/v1/auth/backup-codes",
            json={"totp_code": "000000"},
            headers=headers,
        )

        assert response.status_code == 401


class TestAdminResetTotp:
    async def test_admin_resets_and_user_sets_up_again(
        self, client, make_user, auth_headers, session
    ):
        admin = await make_user(UserRole.ADMIN)
        doctor = await make_user(UserRole.DOCTOR)
        codes = await _enable_totp(client, doctor)

        response = await client.post(
            f"/api/v1/admin/users/{doctor.id}/reset-totp", headers=auth_headers(admin)
        )
        assert response.status_code == 200

        await session.refresh(doctor)
        assert doctor.totp_secret is None

        # Не отключение второго фактора: следующий вход ведёт на его настройку.
        login = await client.post(
            "/api/v1/auth/login", json={"email": doctor.email, "password": PASSWORD}
        )
        assert login.json()["status"] == "totp_setup_required"

        # Прежние резервные коды стёрты вместе с секретом: они были выпущены под
        # утерянное устройство.
        assert await backup_codes_repo.count_unused(session, user_id=doctor.id) == 0
        assert codes

    async def test_admin_cannot_reset_own_totp(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        await _enable_totp(client, admin)

        # Иначе доступ к открытой сессии администратора становился бы способом
        # снять второй фактор с себя, то есть обойти требование раздела 7 ТЗ.
        response = await client.post(
            f"/api/v1/admin/users/{admin.id}/reset-totp", headers=auth_headers(admin)
        )

        assert response.status_code == 409

    async def test_doctor_cannot_reset_totp(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        victim = await make_user(UserRole.DOCTOR)

        response = await client.post(
            f"/api/v1/admin/users/{victim.id}/reset-totp", headers=auth_headers(doctor)
        )

        assert response.status_code == 403

    async def test_reset_without_totp_configured_is_conflict(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)

        response = await client.post(
            f"/api/v1/admin/users/{parent.id}/reset-totp", headers=auth_headers(admin)
        )

        assert response.status_code == 409
