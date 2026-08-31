"""`/products`: права, ревизии, аудит и CSV-импорт через ручку (раздел 5.3, 8.3 ТЗ)."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy import func, select

from core.models import AuditLog, Product, ProductCategory
from core.models.enums import UserRole
from core.repositories import products as products_repo

pytestmark = pytest.mark.asyncio

CSV_HEADER = (
    "name_ru,category,kcal_100g,fat_100g,protein_100g,carbs_100g,fiber_100g,"
    "source,source_version,verified_at"
)


async def _category(session) -> ProductCategory:
    category = ProductCategory(name_ru="Тестовая", sort=0)
    session.add(category)
    await session.flush()
    return category


def _product_payload(category_id, name: str | None = None) -> dict:
    return {
        # Уникально: на products есть уникальный индекс по нормализованному имени
        "name_ru": name or f"Масло сливочное {uuid.uuid4().hex[:8]}",
        "category_id": str(category_id),
        "kcal_100g": 717,
        "fat_100g": 81.1,
        "protein_100g": 0.9,
        "carbs_100g": 0.1,
        "fiber_100g": 0.0,
        "source": "USDA",
        "source_version": "SR28",
        "verified_at": str(date(2026, 1, 1)),
    }


class TestCategories:
    async def test_lists_categories_for_any_authenticated_role(
        self, client, session, make_user, auth_headers
    ):
        # Без списка категорий продукт заводится только копированием UUID, а в
        # новую категорию — не заводится вовсе: POST /products требует
        # category_id, тогда как CSV-импорт принимает название.
        category = await _category(session)
        parent = await make_user(UserRole.PARENT)

        response = await client.get("/api/v1/products/categories", headers=auth_headers(parent))

        assert response.status_code == 200, response.text
        assert {c["name_ru"] for c in response.json()} >= {category.name_ru}

    async def test_requires_authentication(self, client):
        assert (await client.get("/api/v1/products/categories")).status_code == 401


class TestProductWrites:
    async def test_admin_creates_product_with_revision_and_audit(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        assert response.status_code == 201, response.text
        product_id = response.json()["id"]

        revisions = await products_repo.list_revisions(session, product_id=product_id)
        assert len(revisions) == 1, "создание продукта пишет ревизию (раздел 4.2 ТЗ)"

        audit_count = await session.scalar(
            select(func.count())
            .select_from(AuditLog)
            .where(AuditLog.entity == "products", AuditLog.action == "create")
        )
        assert audit_count == 1, "правка базы продуктов обязана попадать в audit_log"

    async def test_update_appends_revision_and_audits_before_after(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        created = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        product_id = created.json()["id"]

        updated = await client.put(
            f"/api/v1/products/{product_id}",
            json={
                **_product_payload(category.id),
                "fat_100g": 82.5,
                # Источник меняется вместе с числами: иначе строка утверждала бы,
                # что новое значение опубликовал USDA (см. TestSourceSignature).
                "source": "Лаборатория клиники",
                "source_version": "измерение 2026-08",
                "is_active": True,
            },
            headers=auth_headers(admin),
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["fat_100g"] == 82.5

        revisions = await products_repo.list_revisions(session, product_id=product_id)
        assert len(revisions) == 2

        # Отбор по entity_id обязателен: без него запрос без сортировки и лимита
        # берёт произвольную строку журнала и цепляет запись постороннего прогона,
        # оставшуюся в базе разработчика. Тест падал не по своей причине.
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "products",
                AuditLog.action == "update",
                AuditLog.entity_id == uuid.UUID(product_id),
            )
        )
        assert entry is not None
        assert entry.before["fat_100g"] == 81.1
        assert entry.after["fat_100g"] == 82.5

    async def test_dietitian_may_write_parent_may_not(
        self, client, session, make_user, auth_headers
    ):
        category = await _category(session)
        dietitian = await make_user(UserRole.DIETITIAN)
        parent = await make_user(UserRole.PARENT)

        allowed = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(dietitian)
        )
        denied = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(parent)
        )
        assert allowed.status_code == 201
        assert denied.status_code == 403

    async def test_update_missing_product_returns_404(
        self, client, session, make_user, auth_headers
    ):
        import uuid

        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        response = await client.put(
            f"/api/v1/products/{uuid.uuid4()}",
            json={**_product_payload(category.id), "is_active": True},
            headers=auth_headers(admin),
        )
        assert response.status_code == 404


class TestSameChecksAtEveryDoor:
    """Проверки состава не должны зависеть от того, какой дверью зашли.

    Раньше сумму макронутриентов и «клетчатка ≤ углеводы» сверял только
    CSV-импорт, а ручное заведение — лишь границы отдельных полей. Продукт,
    который импорт отклонял, диетолог заводил руками, и по нему потом считали
    ребёнку.
    """

    async def test_macro_sum_over_100_is_rejected(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products",
            json={
                **_product_payload(category.id),
                "fat_100g": 60,
                "protein_100g": 30,
                "carbs_100g": 20,
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text

    async def test_fiber_over_carbs_is_rejected(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products",
            json={**_product_payload(category.id), "carbs_100g": 2, "fiber_100g": 5},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text

    async def test_duplicate_name_is_a_conflict_not_a_server_error(
        self, client, session, make_user, auth_headers
    ):
        """Уникальность держит индекс, и без перехвата это был 500.

        Администратор, добавляющий «Масло сливочное», которое уже пришло из
        USDA, видел «Внутренняя ошибка сервера» и не понимал, что это дубль.
        """

        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        name = f"Масло сливочное {uuid.uuid4().hex[:8]}"

        first = await client.post(
            "/api/v1/products",
            json=_product_payload(category.id, name=name),
            headers=auth_headers(admin),
        )
        assert first.status_code == 201, first.text

        second = await client.post(
            "/api/v1/products",
            json=_product_payload(category.id, name=name),
            headers=auth_headers(admin),
        )

        assert second.status_code == 409, second.text
        assert "уже есть" in second.json()["error"]["message"]


class TestCategoriesAreManaged:
    """Категория была побочным эффектом импорта.

    Чем написана колонка файла — то и появлялось в справочнике; сверка шла
    точным совпадением, поэтому «Жиры» и «жиры» заводились как две разные
    категории. Переименовать или слить было нечем, а на пустом справочнике
    завести продукт руками нельзя вовсе: форма требует `category_id`.
    """

    async def test_editor_creates_and_renames(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)

        created = await client.post(
            "/api/v1/products/categories",
            json={"name_ru": f"Жиры {uuid.uuid4().hex[:6]}", "sort": 3},
            headers=auth_headers(dietitian),
        )
        assert created.status_code == 201, created.text
        category_id = created.json()["id"]

        renamed = await client.put(
            f"/api/v1/products/categories/{category_id}",
            json={"name_ru": f"Жиры и масла {uuid.uuid4().hex[:6]}", "sort": 1},
            headers=auth_headers(dietitian),
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["sort"] == 1

    async def test_case_only_difference_is_a_conflict(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        name = f"Жиры {uuid.uuid4().hex[:6]}"

        first = await client.post(
            "/api/v1/products/categories",
            json={"name_ru": name},
            headers=auth_headers(admin),
        )
        assert first.status_code == 201

        second = await client.post(
            "/api/v1/products/categories",
            json={"name_ru": f"  {name.upper()}  "},
            headers=auth_headers(admin),
        )
        # 409 с объяснением, а не 500 от уникального индекса.
        assert second.status_code == 409, second.text
        assert second.json()["error"]["code"] == "conflict"

    async def test_family_cannot_touch_the_dictionary(
        self, client, session, make_user, auth_headers
    ):
        parent = await make_user(UserRole.PARENT)
        response = await client.post(
            "/api/v1/products/categories",
            json={"name_ru": "Жиры"},
            headers=auth_headers(parent),
        )
        assert response.status_code == 403

    async def test_merge_moves_products_and_removes_the_source(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        source = await _category(session)
        target = ProductCategory(name_ru=f"Целевая {uuid.uuid4().hex[:6]}", sort=0)
        session.add(target)
        await session.flush()

        product = await client.post(
            "/api/v1/products",
            json=_product_payload(source.id),
            headers=auth_headers(admin),
        )
        assert product.status_code == 201

        merged = await client.post(
            f"/api/v1/products/categories/{source.id}/merge",
            json={"into_id": str(target.id)},
            headers=auth_headers(admin),
        )
        assert merged.status_code == 200, merged.text
        assert merged.json()["moved"] == 1
        assert merged.json()["category"]["id"] == str(target.id)

        moved = await client.get(
            f"/api/v1/products/{product.json()['id']}", headers=auth_headers(admin)
        )
        assert moved.json()["category_id"] == str(target.id)

        gone = await session.get(ProductCategory, source.id)
        assert gone is None

        # Слияние — операция над справочником продуктов, она обязана попадать
        # в журнал (правило 7 CLAUDE.md).
        entry = await session.scalar(
            select(AuditLog).where(
                AuditLog.entity == "product_categories",
                AuditLog.action == "merge",
                AuditLog.entity_id == source.id,
            )
        )
        assert entry is not None and entry.after["moved"] == 1

    async def test_delete_refuses_while_products_remain(
        self, client, session, make_user, auth_headers
    ):
        """Иначе продукты остались бы без категории — а по ней их ищут."""

        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        await client.post(
            "/api/v1/products",
            json=_product_payload(category.id),
            headers=auth_headers(admin),
        )

        refused = await client.delete(
            f"/api/v1/products/categories/{category.id}", headers=auth_headers(admin)
        )
        assert refused.status_code == 409, refused.text
        assert refused.json()["error"]["details"]["products"] == 1

    async def test_empty_category_is_deleted(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.delete(
            f"/api/v1/products/categories/{category.id}", headers=auth_headers(admin)
        )
        assert response.status_code == 204, response.text
        assert await session.get(ProductCategory, category.id) is None

    async def test_import_does_not_split_a_category_by_case(
        self, client, session, make_user, auth_headers
    ):
        """Тот самый случай: колонка файла написана иначе, чем в справочнике."""

        admin = await make_user(UserRole.ADMIN)
        name = f"Жиры {uuid.uuid4().hex[:6]}"
        session.add(ProductCategory(name_ru=name, sort=0))
        await session.flush()

        csv = (
            f"{CSV_HEADER}\n"
            f"Масло импортное {uuid.uuid4().hex[:6]},{name.lower()},717,81.1,0.9,0.1,0.0,"
            "USDA,SR28,2026-01-01\n"
        )
        report = await client.post(
            "/api/v1/products/import",
            files={"file": ("products.csv", csv.encode(), "text/csv")},
            params={"dry_run": "false"},
            headers=auth_headers(admin),
        )
        assert report.status_code == 200, report.text
        assert report.json()["imported"] == 1

        same = await session.scalars(
            select(ProductCategory).where(
                func.lower(func.trim(ProductCategory.name_ru)) == name.casefold()
            )
        )
        assert len(list(same)) == 1, "категория не должна раздваиваться из-за регистра"


class TestRatioComesFromTheEngine:
    """Кетосоотношение позиции считает ядро, а не интерфейс.

    Формула F / (P + C) выглядит тривиальной ровно до первого масла: у чистого
    жира знаменатель равен нулю. `fat / (p + c)` в браузере дало бы `Infinity`
    в колонке, по которой врач выбирает продукт; ядро отвечает «соотношения
    нет», и это разные утверждения.
    """

    async def test_ratio_is_returned_and_matches_the_engine(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )

        assert response.status_code == 201, response.text
        body = response.json()
        # Масло: 81.1 / (0.9 + 0.1) = 81.1
        assert body["ratio"] == pytest.approx(81.1)

    async def test_pure_fat_has_no_ratio(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        response = await client.post(
            "/api/v1/products",
            json={
                **_product_payload(category.id),
                "kcal_100g": 884,
                "fat_100g": 100,
                "protein_100g": 0,
                "carbs_100g": 0,
                "fiber_100g": 0,
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 201, response.text
        assert response.json()["ratio"] is None


class TestSourceSignature:
    """Числа изменились — источник обязан измениться вместе с ними.

    У каждой позиции справочника есть подпись: откуда взяты значения, какая это
    версия базы, когда сверяли. Пока подпись стоит от USDA, строка утверждает,
    что её числа опубликовал USDA. Правка жиров с сохранением подписи делает
    утверждение ложным — и проверить значение по источнику становится нельзя
    ни задним числом, ни при следующем обновлении базы. Это правило работы с
    базами состава продуктов (EuroFIR), а не наша выдумка.

    Запрета на правку здесь нет: менять числа можно, нельзя оставлять чужую
    подпись под своими числами.
    """

    async def _create(self, client, session, admin, auth_headers):
        category = await _category(session)
        created = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        return category, created.json()["id"]

    async def test_changing_numbers_under_the_old_source_rejected(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category, product_id = await self._create(client, session, admin, auth_headers)

        response = await client.put(
            f"/api/v1/products/{product_id}",
            json={**_product_payload(category.id), "fat_100g": 90.0, "is_active": True},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text
        body = response.json()["error"]
        assert body["code"] == "validation_error"
        assert body["details"]["fields"] == ["fat_100g"]

    async def test_changing_numbers_with_a_new_source_allowed(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category, product_id = await self._create(client, session, admin, auth_headers)

        response = await client.put(
            f"/api/v1/products/{product_id}",
            json={
                **_product_payload(category.id),
                "fat_100g": 90.0,
                "source": "Лаборатория клиники",
                "source_version": "измерение 2026-08",
                "is_active": True,
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["fat_100g"] == 90.0

    async def test_editing_name_under_the_same_source_allowed(
        self, client, session, make_user, auth_headers
    ):
        """Правило про ЧИСЛА, а не про карточку.

        Опечатка в названии, смена категории, вывод из оборота — всё это не
        меняет того, что утверждает источник, и требовать новую подпись значило
        бы мешать работе без причины.
        """

        admin = await make_user(UserRole.ADMIN)
        category, product_id = await self._create(client, session, admin, auth_headers)

        response = await client.put(
            f"/api/v1/products/{product_id}",
            json={
                **_product_payload(category.id),
                "name_ru": f"Масло сливочное 82,5% {uuid.uuid4().hex[:8]}",
                "is_active": False,
            },
            headers=auth_headers(admin),
        )

        assert response.status_code == 200, response.text
        assert response.json()["is_active"] is False


class TestRevisionsAreReadable:
    """История продукта писалась с первого дня и не отдавалась никуда.

    Экран показывал вместо неё журнал аудита, отобранный по `entity_id`, — а
    импорт пишет одну запись на весь файл, без идентификатора продукта. Поэтому
    у всех импортированных позиций история выглядела пустой, хотя в базе она
    была с самого их появления.
    """

    async def test_returns_history_newest_first_with_author_names(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        created = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        product_id = created.json()["id"]

        await client.put(
            f"/api/v1/products/{product_id}",
            json={
                **_product_payload(category.id),
                "fat_100g": 82.5,
                "source": "Лаборатория клиники",
                "source_version": "измерение 2026-08",
                "is_active": True,
            },
            headers=auth_headers(admin),
        )

        response = await client.get(
            f"/api/v1/products/{product_id}/revisions", headers=auth_headers(admin)
        )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["total"] == 2
        # От новых к старым: последнее изменение — то, по которому сейчас считают.
        assert body["items"][0]["snapshot"]["fat_100g"] == 82.5
        assert body["items"][1]["snapshot"]["fat_100g"] == 81.1
        # Идентификатор без имени отвечает «кто-то», а вопрос «кто поменял жиры»
        # задают после инцидента.
        assert body["items"][0]["changed_by_name"] == admin.full_name

    async def test_doctor_may_read_but_parent_may_not(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)
        created = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        product_id = created.json()["id"]

        doctor = await make_user(UserRole.DOCTOR)
        parent = await make_user(UserRole.PARENT)

        allowed = await client.get(
            f"/api/v1/products/{product_id}/revisions", headers=auth_headers(doctor)
        )
        assert allowed.status_code == 200, allowed.text

        # Содержимое справочника открыто всем ролям, а имена сотрудников рядом с
        # правками — сведения о работе клиники, и семье они не нужны ни для чего.
        denied = await client.get(
            f"/api/v1/products/{product_id}/revisions", headers=auth_headers(parent)
        )
        assert denied.status_code == 403

    async def test_unknown_product_is_404(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.get(
            f"/api/v1/products/{uuid.uuid4()}/revisions", headers=auth_headers(admin)
        )
        assert response.status_code == 404

    async def test_imported_products_have_history(self, client, session, make_user, auth_headers):
        """Тот самый случай: у всех 98 позиций прода история выглядела пустой."""

        admin = await make_user(UserRole.ADMIN)
        csv = (
            f"{CSV_HEADER}\n"
            "Авокадо импортное,Жиры,160,14.7,2,8.5,6.7,USDA FoodData Central,SR Legacy,2026-01-01\n"
        )
        report = await client.post(
            "/api/v1/products/import",
            files={"file": ("products.csv", csv.encode(), "text/csv")},
            params={"dry_run": "false"},
            headers=auth_headers(admin),
        )
        assert report.status_code == 200, report.text
        assert report.json()["imported"] == 1

        product = await session.scalar(
            select(Product).where(Product.name_ru == "Авокадо импортное")
        )
        assert product is not None

        response = await client.get(
            f"/api/v1/products/{product.id}/revisions", headers=auth_headers(admin)
        )
        assert response.status_code == 200, response.text
        assert response.json()["total"] == 1


class TestCsvImportEndpoint:
    def _file(self, *rows: str, suffix: str | None = None) -> dict:
        # Названия уникальны в пределах прогона: уникальный индекс на products
        # иначе столкнётся с данными, уже лежащими в базе разработчика.
        # Тест на дубли передаёт один suffix в оба импорта, чтобы имя совпало.
        suffix = suffix or uuid.uuid4().hex[:8]
        unique_rows = [row.replace(",", f" {suffix},", 1) for row in rows]
        content = ("\n".join([CSV_HEADER, *unique_rows]) + "\n").encode("utf-8")
        return {"file": ("products.csv", content, "text/csv")}

    async def test_non_admin_forbidden(self, client, session, make_user, auth_headers):
        dietitian = await make_user(UserRole.DIETITIAN)
        response = await client.post(
            "/api/v1/products/import",
            files=self._file("Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"),
            headers=auth_headers(dietitian),
        )
        assert response.status_code == 403

    async def test_dry_run_is_default_and_writes_nothing(
        self, client, session, make_user, auth_headers
    ):
        admin = await make_user(UserRole.ADMIN)
        before = await session.scalar(select(func.count()).select_from(Product))

        response = await client.post(
            "/api/v1/products/import",
            files=self._file("Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01"),
            headers=auth_headers(admin),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["dry_run"] is True
        assert body["imported"] == 0
        assert body["total_rows"] == 1

        after = await session.scalar(select(func.count()).select_from(Product))
        assert after == before, "превью не должно ничего записывать"

    async def test_commit_imports_rows(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        response = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file(
                "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",
                "Курица,Мясо,165,3.6,31,0,0,USDA,SR28,2026-01-01",
            ),
            headers=auth_headers(admin),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["imported"] == 2
        assert body["dry_run"] is False

        found, total = await products_repo.search(session, q="масло")
        assert total >= 1

    async def test_file_with_errors_imports_nothing(self, client, session, make_user, auth_headers):
        """Частичный импорт недопустим: половина базы продуктов хуже, чем отказ."""
        admin = await make_user(UserRole.ADMIN)
        before = await session.scalar(select(func.count()).select_from(Product))

        response = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file(
                "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",
                "Плохой,Жиры,нечисло,1,1,1,0,USDA,SR28,2026-01-01",
            ),
            headers=auth_headers(admin),
        )
        assert response.status_code == 200
        body = response.json()
        assert body["imported"] == 0
        assert body["errors"], "ошибки должны быть перечислены построчно"
        assert body["errors"][0]["line"] == 3

        after = await session.scalar(select(func.count()).select_from(Product))
        assert after == before

    async def test_duplicate_names_reported_and_skipped(
        self, client, session, make_user, auth_headers
    ):
        """Дубль с расходящимися значениями — риск выбрать «не тот» продукт в меню,
        поэтому импорт сообщает о совпадении, а не создаёт вторую запись."""
        admin = await make_user(UserRole.ADMIN)
        shared = uuid.uuid4().hex[:8]

        first = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file("Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01", suffix=shared),
            headers=auth_headers(admin),
        )
        assert first.json()["imported"] == 1

        # То же название, другие значения — именно этот случай опасен при расчёте меню
        second = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file("Масло,Жиры,900,99,0,0,0,ДругойИсточник,v2,2026-01-01", suffix=shared),
            headers=auth_headers(admin),
        )
        body = second.json()
        assert body["imported"] == 0
        assert any("уже есть в базе" in e["message"] for e in body["errors"]), body["errors"]

        found, total = await products_repo.search(session, q=f"Масло {shared}")
        assert total == 1, "второй записи с тем же названием быть не должно"


class TestProductNameUniqueness:
    """Уникальность названия обеспечена индексом в БД, а не только проверкой в коде:
    «прочитать, затем вставить» не защищает от двух одновременных импортов."""

    async def test_database_rejects_duplicate_name_case_insensitively(
        self, client, session, make_user, auth_headers
    ):
        from sqlalchemy.exc import IntegrityError

        admin = await make_user(UserRole.ADMIN)
        category = await _category(session)

        created = await client.post(
            "/api/v1/products", json=_product_payload(category.id), headers=auth_headers(admin)
        )
        assert created.status_code == 201

        # В обход API — как это сделал бы конкурирующий импорт
        created_name = created.json()["name_ru"]
        session.add(
            Product(
                # Тот же продукт в другом регистре и с пробелами
                name_ru=f"  {created_name.upper()}  ",
                category_id=category.id,
                kcal_100g=900,
                fat_100g=99,
                protein_100g=0,
                carbs_100g=0,
                fiber_100g=0,
                source="Другой",
                source_version="v2",
                verified_at=date(2026, 1, 1),
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()


class TestDeactivationIsReversible:
    """Клиническое не удаляется, а выводится из оборота (правило 4) — но вывод
    обязан быть обратимым.

    Параметр `only_active` жил в репозитории и не пробрасывался ниоткуда,
    поэтому снятие флажка было необратимым: позиция исчезала из выдачи для ВСЕХ,
    включая администратора, и вернуть её можно было только через базу.
    """

    async def _deactivated(self, client, session, admin, auth_headers):
        category = await _category(session)
        created = await client.post(
            "/api/v1/products",
            json=_product_payload(category.id),
            headers=auth_headers(admin),
        )
        assert created.status_code == 201, created.text
        product = created.json()

        turned_off = await client.put(
            f"/api/v1/products/{product['id']}",
            json={**_product_payload(category.id, name=product["name_ru"]), "is_active": False},
            headers=auth_headers(admin),
        )
        assert turned_off.status_code == 200, turned_off.text
        return product

    async def test_hidden_from_the_ordinary_list(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        product = await self._deactivated(client, session, admin, auth_headers)

        response = await client.get(
            "/api/v1/products", params={"q": product["name_ru"]}, headers=auth_headers(admin)
        )

        assert response.status_code == 200
        assert product["id"] not in [row["id"] for row in response.json()["items"]]

    async def test_editor_can_find_it_again(self, client, session, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)
        product = await self._deactivated(client, session, admin, auth_headers)

        response = await client.get(
            "/api/v1/products",
            params={"q": product["name_ru"], "include_inactive": True},
            headers=auth_headers(admin),
        )

        assert response.status_code == 200
        assert product["id"] in [row["id"] for row in response.json()["items"]]

    async def test_family_does_not_see_it_even_when_asking(
        self, client, session, make_user, auth_headers
    ):
        """Смысл вывода из оборота в том, чтобы позиция не попадалась при
        составлении меню. Параметр в адресе этого не отменяет."""

        admin = await make_user(UserRole.ADMIN)
        parent = await make_user(UserRole.PARENT)
        product = await self._deactivated(client, session, admin, auth_headers)

        response = await client.get(
            "/api/v1/products",
            params={"q": product["name_ru"], "include_inactive": True},
            headers=auth_headers(parent),
        )

        assert response.status_code == 200
        assert product["id"] not in [row["id"] for row in response.json()["items"]]


class TestImportEndpointLimits:
    """Ручка импорта читает файл и пишет тысячи строк одной транзакцией.

    Лимита частоты у неё не было вовсе, а предел размера проверялся ПОСЛЕ
    `await file.read()` — то есть после того, как весь файл оказывался в памяти
    процесса.
    """

    def _file(self, size: int) -> bytes:
        header = f"{CSV_HEADER}\n".encode()
        row = "Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01\n".encode()
        body = row * max(1, (size - len(header)) // len(row))
        return header + body

    async def test_oversized_file_is_rejected(self, client, make_user, auth_headers):
        admin = await make_user(UserRole.ADMIN)

        response = await client.post(
            "/api/v1/products/import",
            files={"file": ("big.csv", self._file(6 * 1024 * 1024), "text/csv")},
            headers=auth_headers(admin),
        )

        assert response.status_code == 422, response.text
        assert "5 МБ" in response.json()["error"]["message"]

    async def test_import_is_rate_limited(self, client, make_user, auth_headers):
        """Лимит существует и срабатывает."""

        admin = await make_user(UserRole.ADMIN)
        csv = f"{CSV_HEADER}\n".encode()

        codes = []
        for _ in range(25):
            response = await client.post(
                "/api/v1/products/import",
                files={"file": ("products.csv", csv, "text/csv")},
                headers=auth_headers(admin),
            )
            codes.append(response.status_code)

        assert 429 in codes, "ограничение частоты не сработало"
        assert codes.index(429) >= 20, "лимит сработал раньше объявленных 20 запросов в час"
