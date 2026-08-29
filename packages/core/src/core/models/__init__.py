"""SQLAlchemy-модели KetoCare (раздел 4 ТЗ)."""

from .accounts import (
    DoctorPatient,
    Invitation,
    LinkCode,
    ParentPatient,
    Patient,
    TelegramAccount,
    User,
)
from .ai_audit import AiConversation, AiJob, AuditLog, DoctorSummary, ReportJob
from .base import Base
from .clinical import (
    AedDrug,
    ClinicalNote,
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

__all__ = [
    "Base",
    # accounts
    "User",
    "Patient",
    "ParentPatient",
    "DoctorPatient",
    "Invitation",
    "TelegramAccount",
    "LinkCode",
    # clinical
    "AedDrug",
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
]
