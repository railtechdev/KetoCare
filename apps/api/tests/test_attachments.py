"""Вложения пациента (ADR-0004, ADR-0013).

Это тесты безопасности не меньше, чем функциональности: вложение — клинический
документ, который семья принесла из стационара, а загрузка файла традиционно
самая уязвимая ручка приложения (OWASP File Upload Cheat Sheet).
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import select

from core.models import Product, ProductCategory
from core.models.enums import UserRole
from core.repositories import patients as patients_repo

pytestmark = pytest.mark.asyncio

# Настоящие сигнатуры: тип определяется по первым байтам, и подделать его
# заголовком нельзя — тесты обязаны проверять именно это.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
PDF = b"%PDF-1.7\n" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBP" + b"\x00" * 32


def url(patient_id) -> str:
    return f"/api/v1/patients/{patient_id}/attachments"


def upload(content: bytes, name: str = "выписка.png", mime: str = "image/png") -> dict:
    return {"file": (name, content, mime)}


async def _linked_doctor(session, make_user, make_patient):
    doctor = await make_user(UserRole.DOCTOR)
    patient = await make_patient()
    await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=patient.id)
    return doctor, patient


class TestUpload:
    async def test_doctor_uploads_and_sees_it_in_the_list(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        created = await client.post(
            url(patient.id),
            files=upload(PDF, "epilepsy.pdf", "application/pdf"),
            data={"doc_kind": "eeg", "doc_date": "2026-07-15", "description": "ЭЭГ сна"},
            headers=auth_headers(doctor),
        )

        assert created.status_code == 201, created.text
        body = created.json()
        assert body["mime"] == "application/pdf"
        assert body["doc_kind"] == "eeg"
        assert body["doc_date"] == "2026-07-15"
        assert body["description"] == "ЭЭГ сна"
        # Имя файла на диске наружу не уходит: обращаться к файлу мимо ручки
        # незачем.
        assert "stored_name" not in body

        listed = await client.get(url(patient.id), headers=auth_headers(doctor))
        assert [item["id"] for item in listed.json()] == [body["id"]]

    async def test_description_is_optional(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        # Семья фотографирует выписку в стационаре: требовать заполнения формы в
        # этот момент значило бы получить пустую карту.
        created = await client.post(
            url(patient.id), files=upload(PNG), headers=auth_headers(doctor)
        )

        assert created.status_code == 201, created.text
        assert created.json()["doc_kind"] is None

    @pytest.mark.parametrize(
        ("content", "mime"),
        [(PNG, "image/png"), (JPEG, "image/jpeg"), (PDF, "application/pdf"), (WEBP, "image/webp")],
    )
    async def test_all_allowed_types_pass(
        self, client, session, make_user, make_patient, auth_headers, content, mime
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        created = await client.post(
            url(patient.id), files=upload(content, "файл", mime), headers=auth_headers(doctor)
        )

        assert created.status_code == 201, created.text
        assert created.json()["mime"] == mime


class TestUploadRejections:
    async def test_type_is_taken_from_signature_not_from_header(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        # Заголовок и расширение подделываются тривиально; исполняемый файл,
        # названный картинкой, обязан быть отвергнут (OWASP).
        response = await client.post(
            url(patient.id),
            files=upload(b"#!/bin/sh\nrm -rf /\n", "photo.png", "image/png"),
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422
        assert response.json()["error"]["code"] == "validation_error"

    async def test_svg_is_rejected(self, client, session, make_user, make_patient, auth_headers):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        # SVG — это документ со скриптами, а не картинка. В белом списке его нет.
        response = await client.post(
            url(patient.id),
            files=upload(b'<svg onload="alert(1)"></svg>', "x.svg", "image/svg+xml"),
            headers=auth_headers(doctor),
        )

        assert response.status_code == 422

    async def test_oversized_file_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        too_big = PNG + b"\x00" * (10 * 1024 * 1024)
        response = await client.post(
            url(patient.id), files=upload(too_big), headers=auth_headers(doctor)
        )

        assert response.status_code == 422
        assert "МБ" in response.json()["error"]["message"]

    async def test_empty_file_rejected(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        response = await client.post(
            url(patient.id), files=upload(b""), headers=auth_headers(doctor)
        )

        assert response.status_code == 422


class TestAccess:
    async def test_foreign_doctor_denied(
        self, client, session, make_user, make_patient, auth_headers
    ):
        _, patient = await _linked_doctor(session, make_user, make_patient)
        stranger = await make_user(UserRole.DOCTOR)

        assert (
            await client.get(url(patient.id), headers=auth_headers(stranger))
        ).status_code == 403
        assert (
            await client.post(url(patient.id), files=upload(PNG), headers=auth_headers(stranger))
        ).status_code == 403

    async def test_admin_denied(self, client, session, make_user, make_patient, auth_headers):
        _, patient = await _linked_doctor(session, make_user, make_patient)
        admin = await make_user(UserRole.ADMIN)

        # Администратор к клиническим данным доступа не имеет (правило 5).
        assert (await client.get(url(patient.id), headers=auth_headers(admin))).status_code == 403

    async def test_attachment_of_another_patient_is_not_reachable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, one = await _linked_doctor(session, make_user, make_patient)
        two = await make_patient("Второй Ребёнок")
        await patients_repo.link_doctor(session, doctor_id=doctor.id, patient_id=two.id)

        created = await client.post(url(one.id), files=upload(PNG), headers=auth_headers(doctor))
        attachment_id = created.json()["id"]

        # Доступ к своему пациенту не должен открывать вложение другого — даже
        # если оба ведёт один врач. Иначе принадлежность подразумевалась бы, а
        # не проверялась.
        response = await client.get(
            f"{url(two.id)}/{attachment_id}/file", headers=auth_headers(doctor)
        )
        assert response.status_code == 404

    async def test_unknown_attachment_is_404(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        response = await client.get(
            f"{url(patient.id)}/{uuid.uuid4()}/file", headers=auth_headers(doctor)
        )
        assert response.status_code == 404


class TestDownload:
    async def test_image_is_served_inline_pdf_as_attachment(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        image = await client.post(
            url(patient.id), files=upload(PNG, "фото.png"), headers=auth_headers(doctor)
        )
        pdf = await client.post(
            url(patient.id),
            files=upload(PDF, "выписка.pdf", "application/pdf"),
            headers=auth_headers(doctor),
        )

        got_image = await client.get(
            f"{url(patient.id)}/{image.json()['id']}/file", headers=auth_headers(doctor)
        )
        got_pdf = await client.get(
            f"{url(patient.id)}/{pdf.json()['id']}/file", headers=auth_headers(doctor)
        )

        # Из четырёх разрешённых типов опасен один: PDF открывается встроенным
        # просмотрщиком с origin кабинета (ADR-0013, решение 4).
        assert got_image.headers["content-disposition"].startswith("inline")
        assert got_pdf.headers["content-disposition"].startswith("attachment")
        assert got_image.headers["x-content-type-options"] == "nosniff"
        assert got_pdf.headers["x-content-type-options"] == "nosniff"
        assert got_image.content == PNG

    async def test_cyrillic_filename_survives(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)

        created = await client.post(
            url(patient.id),
            files=upload(PDF, "выписка из стационара.pdf", "application/pdf"),
            headers=auth_headers(doctor),
        )
        got = await client.get(
            f"{url(patient.id)}/{created.json()['id']}/file", headers=auth_headers(doctor)
        )

        # Голый `filename=` допускает только latin-1: без RFC 5987 ответ упал бы
        # на кодировании заголовка.
        assert "filename*=UTF-8''" in got.headers["content-disposition"]

    async def test_download_is_audited_without_filename(
        self, client, session, make_user, make_patient, auth_headers
    ):
        from sqlalchemy import select

        from core.models import AuditLog

        doctor, patient = await _linked_doctor(session, make_user, make_patient)
        created = await client.post(
            url(patient.id),
            files=upload(PDF, "Иванов Пётр выписка.pdf", "application/pdf"),
            headers=auth_headers(doctor),
        )
        attachment_id = created.json()["id"]

        await client.get(f"{url(patient.id)}/{attachment_id}/file", headers=auth_headers(doctor))

        rows = (
            await session.scalars(
                select(AuditLog).where(AuditLog.entity_id == uuid.UUID(attachment_id))
            )
        ).all()
        exports = [row for row in rows if row.action == "export"]
        assert len(exports) == 1
        # Имя файла в журнал не идёт: оно пришло от семьи и может содержать ФИО
        # ребёнка, а журнал читает администратор без доступа к клинике.
        assert "Иванов" not in str(exports[0].after) + str(exports[0].before)


class TestDelete:
    async def test_uploader_deletes_own(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)
        created = await client.post(
            url(patient.id), files=upload(PNG), headers=auth_headers(doctor)
        )

        deleted = await client.delete(
            f"{url(patient.id)}/{created.json()['id']}", headers=auth_headers(doctor)
        )

        assert deleted.status_code == 204
        listed = await client.get(url(patient.id), headers=auth_headers(doctor))
        assert listed.json() == []

    async def test_another_specialist_cannot_delete(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)
        colleague = await make_user(UserRole.DOCTOR)
        await patients_repo.link_doctor(session, doctor_id=colleague.id, patient_id=patient.id)

        created = await client.post(
            url(patient.id), files=upload(PNG), headers=auth_headers(doctor)
        )

        # Решение заказчика (ADR-0013): чужой документ из карты не убирает
        # никто, даже другой ведущий специалист.
        response = await client.delete(
            f"{url(patient.id)}/{created.json()['id']}", headers=auth_headers(colleague)
        )
        assert response.status_code == 403

        listed = await client.get(url(patient.id), headers=auth_headers(colleague))
        assert len(listed.json()) == 1

    async def test_deleted_attachment_is_not_downloadable(
        self, client, session, make_user, make_patient, auth_headers
    ):
        doctor, patient = await _linked_doctor(session, make_user, make_patient)
        created = await client.post(
            url(patient.id), files=upload(PNG), headers=auth_headers(doctor)
        )
        attachment_id = created.json()["id"]

        await client.delete(f"{url(patient.id)}/{attachment_id}", headers=auth_headers(doctor))

        response = await client.get(
            f"{url(patient.id)}/{attachment_id}/file", headers=auth_headers(doctor)
        )
        assert response.status_code == 404


class TestRecipePhoto:
    """Второй владелец той же подсистемы: фото рецепта — не клинические данные."""

    async def _recipe(self, client, session, dietitian, auth_headers) -> str:
        # Состав обязателен: без него рецепт нельзя опубликовать («показатели
        # считать не по чему»), а тест читает фото именно опубликованного.
        category = await session.scalar(select(ProductCategory).limit(1))
        if category is None:
            category = ProductCategory(name_ru="Тестовая", sort=0)
            session.add(category)
            await session.flush()
        product = Product(
            name_ru=f"Масло {uuid.uuid4().hex[:8]}",
            category_id=category.id,
            source="USDA",
            source_version="SR28",
            verified_at=date(2026, 1, 1),
            kcal_100g=717,
            fat_100g=81.1,
            protein_100g=0.9,
            carbs_100g=0.1,
            fiber_100g=0.0,
        )
        session.add(product)
        await session.flush()

        created = await client.post(
            "/api/v1/recipes",
            json={
                "title": f"Омлет {uuid.uuid4().hex[:6]}",
                "category": "breakfast",
                "servings": 1,
                "yield_g": 180,
                "instructions": "Взбить и пожарить.",
                "ingredients": [{"product_id": str(product.id), "grams": 100}],
            },
            headers=auth_headers(dietitian),
        )
        assert created.status_code == 201, created.text
        return created.json()["id"]

    async def test_dietitian_uploads_and_anyone_reads(
        self, client, session, make_user, auth_headers
    ):
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)
        recipe_id = await self._recipe(client, session, dietitian, auth_headers)

        uploaded = await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(JPEG, "омлет.jpg", "image/jpeg"),
            headers=auth_headers(dietitian),
        )
        assert uploaded.status_code == 200, uploaded.text
        # В колонке идентификатор вложения, а не готовый адрес: адрес вшил бы
        # префикс API в строки базы (ADR-0013, решение 7).
        uuid.UUID(uploaded.json()["photo_path"])

        # Опубликованное фото читает любая аутентифицированная роль: фото
        # рецепта клиническими данными не является.
        published = await client.post(
            f"/api/v1/recipes/{recipe_id}/publish", headers=auth_headers(dietitian)
        )
        assert published.status_code == 200, published.text
        got = await client.get(f"/api/v1/recipes/{recipe_id}/photo", headers=auth_headers(parent))
        assert got.status_code == 200
        assert got.headers["content-disposition"].startswith("inline")
        assert got.content == JPEG

    async def test_parent_cannot_upload(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)
        recipe_id = await self._recipe(client, session, dietitian, auth_headers)

        response = await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(JPEG, "x.jpg", "image/jpeg"),
            headers=auth_headers(parent),
        )
        assert response.status_code == 403

    async def test_pdf_rejected_as_recipe_photo(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        recipe_id = await self._recipe(client, session, dietitian, auth_headers)

        # Подсистема PDF разрешает, но фото рецепта существует ради показа в
        # `<img>`: документ на этом месте — ошибка ввода, а не выбор.
        response = await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(PDF, "x.pdf", "application/pdf"),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 422

    async def test_draft_photo_hidden_from_parent(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)
        recipe_id = await self._recipe(client, session, dietitian, auth_headers)
        await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(PNG),
            headers=auth_headers(dietitian),
        )

        # Иначе фото стало бы способом узнать о существовании чернового рецепта.
        response = await client.get(
            f"/api/v1/recipes/{recipe_id}/photo", headers=auth_headers(parent)
        )
        assert response.status_code == 404

    async def test_new_photo_replaces_the_previous(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        recipe_id = await self._recipe(client, session, dietitian, auth_headers)

        await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(PNG),
            headers=auth_headers(dietitian),
        )
        second = await client.put(
            f"/api/v1/recipes/{recipe_id}/photo",
            files=upload(JPEG, "новое.jpg", "image/jpeg"),
            headers=auth_headers(dietitian),
        )

        got = await client.get(
            f"/api/v1/recipes/{recipe_id}/photo", headers=auth_headers(dietitian)
        )
        assert got.content == JPEG
        assert second.json()["photo_path"] != ""
