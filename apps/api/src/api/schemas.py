"""Pydantic-схемы запросов/ответов API."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.models.enums import Sex, UserRole


class Page[T](BaseModel):
    """Формат постраничного ответа (раздел 5.1 ТЗ)."""

    items: list[T]
    total: int


# --- auth -----------------------------------------------------------------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = Field(default=None, description="Обязателен для admin/doctor/dietitian")


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class LoginResponse(BaseModel):
    """Вход завершается либо парой токенов, либо требованием настроить 2FA.

    Второй случай — не ошибка: приглашённому врачу/диетологу/админу 2FA
    обязательна (раздел 5.2 ТЗ), но настроить её до первого входа негде.
    `totp_setup_token` даёт доступ только к /auth/totp/setup и /auth/totp/verify.
    """

    status: Literal["ok", "totp_setup_required"]
    tokens: TokenPair | None = None
    totp_setup_token: str | None = None


class RefreshRequest(BaseModel):
    """Токен передаётся в теле (или берётся из httpOnly cookie), но не в URL:
    query-параметры оседают в логах nginx, истории браузера и Referer."""

    refresh_token: str | None = None


class TotpSetupRequest(BaseModel):
    current_code: str | None = Field(
        default=None, description="Обязателен, если 2FA уже настроена (смена второго фактора)"
    )


class TotpSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str


class TotpVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=8)


# --- patients -------------------------------------------------------------


class PatientCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    birth_date: date
    sex: Sex
    height_cm: float | None = Field(default=None, gt=0, le=250)
    allergies: list[str] = Field(default_factory=list)
    notes: str | None = None


class PatientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    birth_date: date
    sex: Sex
    height_cm: float | None
    allergies: list[str]
    notes: str | None


# --- prescriptions --------------------------------------------------------


class PrescriptionCreate(BaseModel):
    """Валидация из раздела 8.3 ТЗ: ratio 1.0-5.0, kcal 500-3000."""

    ratio: Annotated[float, Field(ge=1.0, le=5.0)]
    kcal_per_day: Annotated[int, Field(ge=500, le=3000)]
    protein_g: Annotated[float, Field(gt=0, le=300)]
    carbs_limit_g: Annotated[float, Field(ge=0, le=300)]
    meals_per_day: Annotated[int, Field(ge=1, le=10)]
    effective_from: date
    restrictions: str | None = None


class PrescriptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    ratio: float
    kcal_per_day: int
    protein_g: float
    carbs_limit_g: float
    meals_per_day: int
    restrictions: str | None
    author_id: uuid.UUID
    effective_from: date
    created_at: datetime


# --- products -------------------------------------------------------------


class ProductBase(BaseModel):
    name_ru: str = Field(min_length=1, max_length=255)
    name_uz: str | None = None
    name_en: str | None = None
    category_id: uuid.UUID
    kcal_100g: Annotated[float, Field(ge=0, le=1000)]
    fat_100g: Annotated[float, Field(ge=0, le=100)]
    protein_100g: Annotated[float, Field(ge=0, le=100)]
    carbs_100g: Annotated[float, Field(ge=0, le=100)]
    fiber_100g: Annotated[float, Field(ge=0, le=100)]
    source: str = Field(min_length=1, max_length=255)
    source_version: str = Field(min_length=1, max_length=64)
    verified_at: date


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    is_active: bool = True


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool


class ProductCategoryRead(BaseModel):
    """Категория продукта.

    Нужна отдельной ручкой, потому что `ProductRead` несёт только `category_id`:
    без списка категория в форме продукта задавалась бы идентификатором, а завести
    продукт в новую категорию было бы нельзя вовсе — CSV-импорт при этом принимает
    название и создаёт категорию сам.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name_ru: str
    sort: int


# --- users / admin --------------------------------------------------------


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: UserRole
    full_name: str
    email: str
    phone: str | None
    is_active: bool
    created_at: datetime


# --- invitations ----------------------------------------------------------


class InvitationCreate(BaseModel):
    email: EmailStr
    role: UserRole


class InvitationCreated(BaseModel):
    """`token` возвращается один раз — в БД лежит только его хеш."""

    id: uuid.UUID
    email: str
    role: UserRole
    token: str
    expires_at: datetime


class InvitationAccept(BaseModel):
    token: str
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=12, max_length=128)
    phone: str | None = None


# --- product import -------------------------------------------------------


class ImportRowError(BaseModel):
    line: int
    column: str | None
    message: str


class ProductImportReport(BaseModel):
    total_rows: int
    imported: int
    errors: list[ImportRowError]
    dry_run: bool


# --- custom dishes --------------------------------------------------------


class DishIngredientIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: uuid.UUID
    grams: Annotated[float, Field(gt=0, le=5000)]


class CustomDishWrite(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    ingredients: list[DishIngredientIn] = Field(min_length=1, max_length=100)


class DishComputed(BaseModel):
    kcal: float
    fat: float
    protein: float
    carbs: float
    fiber: float
    ratio: float | None


class CustomDishRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    patient_id: uuid.UUID
    title: str
    ingredients: list[DishIngredientIn]
    computed: DishComputed | None
    engine_version: str | None
    created_at: datetime
