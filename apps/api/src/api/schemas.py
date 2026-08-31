"""Pydantic-схемы запросов/ответов API."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from core.models.enums import Sex, UserRole
from keto_engine import Ingredient, verify


def _required(max_length: int) -> Any:
    """Непустая строка с обрезкой пробелов по краям.

    `Field(min_length=1)` пропускает строку из одних пробелов: длина у неё не
    нулевая. Так в базу попадало имя из пробелов — пустая строка вместо ребёнка
    в списке пациентов. Обрезка выполняется до проверки длины, поэтому «   »
    отвергается, а «  Аня  » сохраняется как «Аня».
    """

    return StringConstraints(strip_whitespace=True, min_length=1, max_length=max_length)


#: Имя человека, название продукта, заголовок рецепта.
RequiredName = Annotated[str, _required(255)]
#: Короткое обязательное поле: версия источника данных и подобное.
RequiredShortText = Annotated[str, _required(64)]
#: Длинный обязательный текст: заметка врача.
RequiredLongText = Annotated[str, _required(10000)]


class Page[T](BaseModel):
    """Формат постраничного ответа (раздел 5.1 ТЗ)."""

    items: list[T]
    total: int


# --- auth -----------------------------------------------------------------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    totp_code: str | None = Field(default=None, description="Обязателен для admin/doctor/dietitian")
    backup_code: str | None = Field(
        default=None,
        description="Резервный код вместо кода приложения, когда телефон недоступен",
    )


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class BackupCodes(BaseModel):
    """Резервные коды в открытом виде.

    Отдаются ровно один раз — при включении второго фактора и при перевыпуске:
    в базе лежит только sha256, и повторить показ невозможно.
    """

    codes: list[str]


class TotpEnabledResponse(BaseModel):
    """Второй фактор включён: пара токенов и резервные коды.

    Коды выдаются здесь, а не отдельным шагом, потому что это единственный
    момент, когда их можно показать: до включения второго фактора они не нужны,
    а после — уже не восстанавливаются.
    """

    tokens: TokenPair
    backup_codes: list[str]


class BackupCodesStatus(BaseModel):
    """Сколько кодов осталось. Набор кончается молча, и об этом надо сказать."""

    remaining: int
    total: int


class BackupCodesRegenerate(BaseModel):
    """Перевыпуск требует кода приложения: иначе чужой доступ к открытой сессии
    позволял бы выпустить себе набор кодов на будущее."""

    totp_code: str


class LoginResponse(BaseModel):
    """Вход завершается либо парой токенов, либо требованием настроить 2FA.

    Второй случай — не ошибка: приглашённому врачу/диетологу/админу 2FA
    обязательна (раздел 5.2 ТЗ), но настроить её до первого входа негде.
    `totp_setup_token` даёт доступ только к /auth/totp/setup и /auth/totp/verify.
    """

    status: Literal["ok", "totp_setup_required", "password_change_required"]
    tokens: TokenPair | None = None
    totp_setup_token: str | None = None
    #: Токен для `POST /auth/password/set`. Выдаётся, когда пароль сбросил
    #: администратор: временный пароль заведомо известен второму человеку, и
    #: работать он должен ровно до того, как владелец задаст свой.
    password_reset_token: str | None = None


class PasswordSet(BaseModel):
    """Новый пароль по токену сброса. Текущий не спрашивается: его владелец не
    знает — пароль ему выдал администратор, и задача как раз в том, чтобы
    временный перестал действовать."""

    new_password: Annotated[str, Field(min_length=12, max_length=128)]


class AdminPasswordReset(BaseModel):
    """Временный пароль, выданный администратором.

    Показывается ему один раз: в базе только argon2-хэш. Передавать его нужно
    тому, чью учётную запись сбрасывали, — голосом или в переписке, — и он
    перестанет работать сразу, как только человек задаст свой.
    """

    temporary_password: str


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
    full_name: RequiredName
    birth_date: date
    sex: Sex
    height_cm: float | None = Field(default=None, gt=0, le=250)
    allergies: list[str] = Field(default_factory=list)
    notes: str | None = None


class PatientUpdate(BaseModel):
    """Правка профиля ребёнка.

    Дата рождения и пол не меняются: это не «данные, которые уточняют», а
    идентичность записи, и их правка тихо переписала бы возраст во всех уже
    сделанных расчётах и отчётах. Ошибка в них — повод завести профиль заново
    (раздел 5.3 ТЗ прямых указаний не даёт, решение зафиксировано здесь).

    Рост и аллергии меняются обязательно: ребёнок растёт, а аллергии уточняются
    по ходу терапии — и то и другое влияет на назначение и на состав меню.
    """

    full_name: RequiredName
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
    name_ru: RequiredName
    name_uz: str | None = None
    name_en: str | None = None
    category_id: uuid.UUID
    kcal_100g: Annotated[float, Field(ge=0, le=1000)]
    fat_100g: Annotated[float, Field(ge=0, le=100)]
    protein_100g: Annotated[float, Field(ge=0, le=100)]
    carbs_100g: Annotated[float, Field(ge=0, le=100)]
    fiber_100g: Annotated[float, Field(ge=0, le=100)]
    source: RequiredName
    source_version: RequiredShortText
    verified_at: date

    @model_validator(mode="after")
    def _macros_are_physically_possible(self) -> ProductBase:
        """Те же две проверки состава, что и у CSV-импорта.

        Раньше они жили только в импорте
        (`api/services/product_import.py`), а ручное заведение проверяло лишь
        границы отдельных полей. Продукт, который импорт отклонял, диетолог
        заводил руками — и по нему потом считали ребёнку.

        Дверей две, данные одни, значит и проверка обязана быть одна.
        """

        macro_sum = self.fat_100g + self.protein_100g + self.carbs_100g
        if macro_sum > 100:
            raise ValueError(
                f"Сумма жиров, белков и углеводов ({macro_sum:g} г) "
                "превышает 100 г на 100 г продукта."
            )

        # TODO(med): вопрос 6 в docs/medical/OPEN_QUESTIONS.md — клетчатка
        # считается частью общих углеводов (согласуется с NET_CARBS_DEFAULT=False).
        # Источники с раздельным учётом клетчатки это правило отклонит.
        if self.fiber_100g > self.carbs_100g:
            raise ValueError(
                f"Клетчатка ({self.fiber_100g:g} г) не может превышать "
                f"общие углеводы ({self.carbs_100g:g} г)."
            )

        return self


class ProductCreate(ProductBase):
    pass


class ProductUpdate(ProductBase):
    is_active: bool = True


class ProductRead(ProductBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    is_active: bool

    @computed_field  # type: ignore[prop-decorator]
    @property
    def ratio(self) -> float | None:
        """Кетосоотношение 100 г продукта — F / (P + C).

        Считает ядро, а не интерфейс. Формула выглядит тривиальной ровно до
        первого масла: у чистого жира знаменатель равен нулю, и `fat / (p + c)`
        в браузере дало бы `Infinity` в колонке, по которой врач выбирает
        продукт. Ядро в этом случае отвечает «соотношения нет» — и это разные
        утверждения.

        Считается на чтении и не хранится: значение полностью определяется
        макронутриентами позиции, а сохранённая копия однажды разошлась бы с
        ними после правки.
        """

        return verify(
            [
                (
                    Ingredient(
                        product_id=str(self.id),
                        kcal=self.kcal_100g,
                        fat=self.fat_100g,
                        protein=self.protein_100g,
                        carbs=self.carbs_100g,
                        fiber=self.fiber_100g,
                    ),
                    100.0,
                )
            ]
        ).ratio


class ProductRevisionRead(BaseModel):
    """Одна запись истории продукта (`product_revisions`, раздел 4.2 ТЗ).

    История писалась с первого дня и не отдавалась ни одной ручкой. На экране
    вместо неё показывался журнал аудита, отобранный по `entity_id`, — а импорт
    пишет одну запись аудита на весь файл, без идентификатора продукта. Из-за
    этого у всех импортированных позиций история выглядела пустой, хотя в базе
    она была.

    `snapshot` — состояние продукта ПОСЛЕ изменения, целиком. Разницу считает
    тот, кто показывает: хранить её значило бы дублировать то, что и так есть.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    snapshot: dict[str, Any]
    changed_by: uuid.UUID
    #: Имя того, кто менял. Идентификатор без имени отвечает «кто-то», а вопрос
    #: «кто поменял жиры» задают после инцидента, и отвечать на него надо сразу.
    changed_by_name: str | None = None
    changed_at: datetime


class ProductRevisionPage(BaseModel):
    items: list[ProductRevisionRead]
    total: int


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
    #: Настроен ли второй фактор. Сам секрет наружу не отдаётся — только факт:
    #: кнопка «сбросить второй фактор» у учётной записи, где его нет, ведёт в
    #: заведомый 409 (правило П3 канона).
    has_totp: bool


class MeUpdate(BaseModel):
    """Правка собственного профиля.

    Роль и активность здесь недоступны намеренно: повышать себе права нельзя, а
    выключать себя — незачем. Их меняет администратор через `/admin/users`.
    Почта не меняется: она же логин, и её смена — отдельная процедура с
    подтверждением владения адресом, которой в продукте пока нет.
    """

    model_config = ConfigDict(extra="forbid")

    full_name: RequiredName
    phone: str | None = Field(default=None, max_length=32)


class PasswordChange(BaseModel):
    """Смена собственного пароля.

    Текущий пароль обязателен: без него оставленная без присмотра открытая
    сессия позволяла бы сменить пароль и запереть владельца.
    """

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class FamilyMemberRead(BaseModel):
    """Родитель, ведущий ребёнка дома.

    С контактами, в отличие от `ColleagueRead`: у флага «семья молчит N дней»
    должно быть продолжение. Врач видел красную метку первой строкой списка,
    открывал карту, находил пустые дневники — и следующего шага не
    существовало: ни телефона, ни почты, ни даже имени того, кто ведёт ребёнка.
    Триаж заканчивался констатацией проблемы.

    Симметрично `GET /patients/{id}/doctors`, которая открыта и семье: родитель
    вправе знать, кто имеет доступ к данным ребёнка, — а специалист вправе
    знать, с кем говорить о ребёнке, которого он ведёт.

    Состав контактов — решение заказчика от 30.08.2026 (ADR-0011).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    full_name: str
    phone: str | None
    email: str


class ColleagueRead(BaseModel):
    """Специалист в справочнике персонала.

    Без почты и телефона: чтобы передать пациента коллеге, достаточно имени и
    роли, а контакты сотрудников — не то, что нужно раздавать по всей клинике.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: UserRole
    full_name: str


class PatientDoctorAdd(BaseModel):
    doctor_id: uuid.UUID


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
    full_name: RequiredName
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
    title: RequiredName
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
