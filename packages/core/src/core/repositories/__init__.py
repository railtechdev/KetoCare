"""Репозитории — единственный слой, обращающийся к БД (раздел 5.1 ТЗ).

В роутерах и сервисах `apps/api` SQL/ORM-запросов быть не должно.
"""

from . import (
    access,
    audit,
    clinical_notes,
    custom_dishes,
    diary,
    dictionaries,
    invitations,
    medical_profiles,
    medications,
    menus,
    overview,
    patients,
    prescriptions,
    products,
    recipes,
    users,
)

__all__ = [
    "access",
    "audit",
    "clinical_notes",
    "custom_dishes",
    "diary",
    "dictionaries",
    "invitations",
    "medical_profiles",
    "medications",
    "menus",
    "overview",
    "patients",
    "prescriptions",
    "products",
    "recipes",
    "users",
]
