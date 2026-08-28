"""Репозитории — единственный слой, обращающийся к БД (раздел 5.1 ТЗ).

В роутерах и сервисах `apps/api` SQL/ORM-запросов быть не должно.
"""

from . import access, audit, custom_dishes, patients, prescriptions, products, users

__all__ = [
    "access",
    "audit",
    "custom_dishes",
    "patients",
    "prescriptions",
    "products",
    "users",
]
