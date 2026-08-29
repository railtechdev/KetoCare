"""Точка входа FastAPI (раздел 5.1 ТЗ). Базовый префикс `/api/v1`."""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings

from .errors import register_exception_handlers, register_unhandled_error_middleware
from .ratelimit import register_rate_limiting
from .routers import (
    admin,
    auth,
    calc,
    clinical,
    custom_dishes,
    dictionaries,
    intake,
    logs,
    menus,
    overview,
    patients,
    prescriptions,
    products,
    recipes,
    staff,
)

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="KetoCare API",
        version="0.1.0",
        description="API платформы сопровождения кетогенной диетотерапии.",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
    )

    # Порядок важен: add_middleware добавляет слой снаружи предыдущих, поэтому
    # CORS регистрируется ПОСЛЕДНИМ и оказывается самым внешним — только так его
    # заголовки попадают в ответы, сформированные обработчиком 500 и лимитером.
    register_exception_handlers(app)
    register_unhandled_error_middleware(app)
    register_rate_limiting(app)

    # CORS только для доменов web и miniapp (раздел 11 ТЗ)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.web_origin, settings.miniapp_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    v1 = APIRouter(prefix=API_PREFIX)
    v1.include_router(auth.router)
    v1.include_router(patients.router)
    v1.include_router(prescriptions.router)
    v1.include_router(products.router)
    v1.include_router(custom_dishes.router)
    v1.include_router(calc.router)
    v1.include_router(logs.router)
    v1.include_router(menus.router)
    v1.include_router(overview.router)
    v1.include_router(recipes.router)
    v1.include_router(clinical.router)
    v1.include_router(intake.router)
    v1.include_router(dictionaries.router)
    v1.include_router(staff.router)
    v1.include_router(admin.router)
    app.include_router(v1)

    @app.get("/health", tags=["service"], summary="Проверка живости")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
