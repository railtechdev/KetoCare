"""SQLAlchemy-модели KetoCare (раздел 4 ТЗ)."""

from .accounts import (
    AccessCode,
    DoctorPatient,
    FamilyNudge,
    Invitation,
    ParentPatient,
    Patient,
    ReminderDelivery,
    ReminderSettings,
    RevokedSession,
    TelegramAccount,
    User,
    UserBackupCode,
)
from .ai_audit import AiConversation, AiJob, AuditLog, DoctorSummary, ReportJob
from .base import Base
from .clinical import (
    AedDrug,
    ClinicalNote,
    ControlVisit,
    IntakeOption,
    MedicalProfile,
    Medication,
    PatientIntake,
    Prescription,
)
from .content import (
    CustomDish,
    Product,
    ProductCategory,
    ProductRevision,
    Recipe,
    RecipeIngredient,
)
from .diary import (
    KetoneLog,
    KetoneMethodDict,
    MealLog,
    MedicationLog,
    Menu,
    MenuItem,
    SeizureLog,
    SeizureType,
    SideEffectLog,
    WeightLog,
)
from .files import Attachment
from .idempotency import IdempotencyKey
from .knowledge import KbChunk
from .marketing import Lead

__all__ = [
    "Attachment",
    "Base",
    "IdempotencyKey",
    # accounts
    "User",
    "Patient",
    "ParentPatient",
    "DoctorPatient",
    "FamilyNudge",
    "Invitation",
    "ReminderDelivery",
    "ReminderSettings",
    "TelegramAccount",
    "RevokedSession",
    "UserBackupCode",
    "AccessCode",
    # clinical
    "AedDrug",
    "ControlVisit",
    "IntakeOption",
    "MedicalProfile",
    "PatientIntake",
    "Prescription",
    "Medication",
    "ClinicalNote",
    # content
    "ProductCategory",
    "Product",
    "ProductRevision",
    "Recipe",
    "RecipeIngredient",
    "CustomDish",
    # diary
    "SeizureType",
    "KetoneMethodDict",
    "SeizureLog",
    "KetoneLog",
    "WeightLog",
    "MedicationLog",
    "MealLog",
    "SideEffectLog",
    "Menu",
    "MenuItem",
    # ai/audit
    "AiJob",
    "AiConversation",
    "DoctorSummary",
    "ReportJob",
    "AuditLog",
    # marketing
    "KbChunk",
    "Lead",
]
