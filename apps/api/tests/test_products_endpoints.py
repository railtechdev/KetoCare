"""`/products`: права, ревизии, аудит и CSV-импорт через ручку (раздел 5.3, 8.3 ТЗ)."""

from __future__ import annotations

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


def _product_payload(category_id) -> dict:
    return {
        "name_ru": "Масло сливочное",
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
            json={**_product_payload(category.id), "fat_100g": 82.5, "is_active": True},
            headers=auth_headers(admin),
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["fat_100g"] == 82.5

        revisions = await products_repo.list_revisions(session, product_id=product_id)
        assert len(revisions) == 2

        entry = await session.scalar(
            select(AuditLog).where(AuditLog.entity == "products", AuditLog.action == "update")
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


class TestCsvImportEndpoint:
    def _file(self, *rows: str) -> dict:
        content = ("\n".join([CSV_HEADER, *rows]) + "\n").encode("utf-8")
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
        rows = ("Масло,Жиры,717,81.1,0.9,0.1,0,USDA,SR28,2026-01-01",)

        first = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file(*rows),
            headers=auth_headers(admin),
        )
        assert first.json()["imported"] == 1

        second = await client.post(
            "/api/v1/products/import?dry_run=false",
            files=self._file("Масло,Жиры,900,99,0,0,0,ДругойИсточник,v2,2026-01-01"),
            headers=auth_headers(admin),
        )
        body = second.json()
        assert body["imported"] == 0
        assert any("уже есть в базе" in e["message"] for e in body["errors"]), body["errors"]

        found, total = await products_repo.search(session, q="масло")
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
        session.add(
            Product(
                name_ru="  масло сливочное  ",
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
