"""`/recipes` — общая база рецептов (раздел 5.3 ТЗ).

Читают все авторизованные, но родителю видны только опубликованные рецепты.
Пишут admin/dietitian; каждая правка попадает в audit_log (раздел 4.2 ТЗ).
Итоги рецепта считает только расчётное ядро и сохраняются они вместе с
`engine_version` (раздел 4.1 ТЗ).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Path, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from core.models import Recipe
from core.models.enums import AttachmentOwnerKind, RecipeCategory, RecipeStatus, UserRole
from core.repositories import attachments as attachments_repo
from core.repositories import audit as audit_repo
from core.repositories import recipes as recipes_repo

from ..client_address import client_address
from ..deps.auth import CurrentUser, CurrentUserDep, SessionDep, require_roles
from ..deps.query import PaginationDep
from ..errors import ApiError, ErrorCode
from ..schemas import Page
from ..schemas_recipes import RecipeRead, RecipeWrite
from ..services import attachments as files_service
from ..services import recipes as recipes_service

router = APIRouter(prefix="/recipes", tags=["recipes"])

_EDITOR_ROLES = (UserRole.ADMIN, UserRole.DIETITIAN)


def _visible_statuses(user: CurrentUser) -> tuple[RecipeStatus, ...] | None:
    """Родителю доступны только опубликованные рецепты (раздел 5.3 ТЗ):
    черновик — незавершённая работа диетолога, кормить по нему нельзя.
    `None` — без ограничения по статусу."""

    if user.role is UserRole.PARENT:
        return (RecipeStatus.PUBLISHED,)
    return None


async def _visible_recipe(session: SessionDep, recipe_id: uuid.UUID, user: CurrentUser) -> Recipe:
    """Рецепт, доступный этому пользователю.

    Скрытый от родителя черновик отдаём как 404, а не 403: иначе по коду ответа
    можно было бы узнать, что рецепт с таким идентификатором существует.
    """

    recipe = await recipes_repo.get(session, recipe_id)
    statuses = _visible_statuses(user)
    if recipe is None or (statuses is not None and recipe.status not in statuses):
        raise ApiError(ErrorCode.NOT_FOUND, "Рецепт не найден.")
    return recipe


def _reject_duplicates(payload: RecipeWrite) -> None:
    duplicates = recipes_service.duplicate_product_ids(payload.ingredients)
    if duplicates:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Один и тот же продукт указан в составе несколько раз.",
            details={"product_ids": [str(pid) for pid in duplicates]},
        )


async def _read(session: SessionDep, recipe: Recipe) -> RecipeRead:
    ingredients = await recipes_repo.list_ingredients(session, recipe_id=recipe.id)
    return recipes_service.to_read(recipe, ingredients)


@router.get("", response_model=Page[RecipeRead], summary="Поиск рецептов")
async def search_recipes(
    session: SessionDep,
    user: CurrentUserDep,
    page: PaginationDep,
    category: RecipeCategory | None = None,
    ratio_min: Annotated[float | None, Query(ge=0)] = None,
    ratio_max: Annotated[float | None, Query(ge=0)] = None,
    q: str | None = None,
) -> Page[RecipeRead]:
    items, total = await recipes_repo.search(
        session,
        statuses=_visible_statuses(user),
        category=category,
        ratio_min=ratio_min,
        ratio_max=ratio_max,
        q=q,
        limit=page.limit,
        offset=page.offset,
    )
    ingredients = await recipes_repo.ingredients_by_recipe(
        session, recipe_ids=[recipe.id for recipe in items]
    )
    return Page(
        items=[recipes_service.to_read(r, ingredients.get(r.id, [])) for r in items], total=total
    )


@router.get("/{recipe_id}", response_model=RecipeRead, summary="Карточка рецепта")
async def get_recipe(
    recipe_id: Annotated[uuid.UUID, Path()], session: SessionDep, user: CurrentUserDep
) -> RecipeRead:
    recipe = await _visible_recipe(session, recipe_id, user)
    return await _read(session, recipe)


@router.put(
    "/{recipe_id}/photo",
    response_model=RecipeRead,
    summary="Загрузить фото рецепта",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def upload_recipe_photo(
    recipe_id: Annotated[uuid.UUID, Path()],
    request: Request,
    session: SessionDep,
    user: CurrentUserDep,
    file: Annotated[UploadFile, File()],
) -> RecipeRead:
    """Фото рецепта отдельным действием, а не полем создания.

    Владелец вложения обязателен, а рецепт до ответа сервера идентификатора не
    имеет. Нулевой владелец породил бы сирот, которых некому убирать: уборщика
    файлов в продукте нет (ADR-0013, решения 1 и 8).

    PDF здесь не принимается, хотя подсистема его разрешает: фото рецепта
    существует ради показа в `<img>`, и документ на этом месте — ошибка ввода, а
    не выбор пользователя.

    Прежнее фото помечается удалённым: рецепт показывает одно, и оставлять
    прошлое видимым в списке вложений незачем.
    """

    recipe = await _visible_recipe(session, recipe_id, user)

    content = await file.read()
    mime = files_service.validate(content)
    if mime not in files_service.INLINE_MIMES:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Фото рецепта — картинка JPEG, PNG или WebP.")

    for previous in await attachments_repo.list_for_owner(
        session, owner_kind=AttachmentOwnerKind.RECIPE, owner_id=recipe.id
    ):
        await attachments_repo.soft_delete(session, attachment=previous)

    stored_name = files_service.generate_stored_name(mime)
    await run_in_threadpool(files_service.write_file, stored_name, content)

    attachment = await attachments_repo.create(
        session,
        owner_kind=AttachmentOwnerKind.RECIPE,
        owner_id=recipe.id,
        filename=(file.filename or "фото")[:255],
        stored_name=stored_name,
        mime=mime,
        size_bytes=len(content),
        sha256=files_service.sha256_of(content),
        uploaded_by=user.id,
    )

    # В колонке — идентификатор вложения, а не готовый адрес: адрес вшил бы
    # префикс `/api/v1` в строки базы, и его смена потребовала бы миграции
    # данных (ADR-0013, решение 7).
    recipe.photo_path = str(attachment.id)
    await session.flush()

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="recipes",
        entity_id=recipe.id,
        ip=client_address(request),
    )
    return await _read(session, recipe)


@router.get("/{recipe_id}/photo", summary="Фото рецепта")
async def get_recipe_photo(
    recipe_id: Annotated[uuid.UUID, Path()],
    session: SessionDep,
    user: CurrentUserDep,
) -> Response:
    """Отдаёт картинку рецепта.

    Читает любая аутентифицированная роль — фото рецепта клиническими данными
    не является. Но черновик по-прежнему скрыт от родителя (`_visible_recipe`):
    иначе фото стало бы способом узнать о существовании неопубликованного
    рецепта.

    `inline`, потому что показывается в `<img>`; `nosniff` — потому что тип
    определён нами по сигнатуре, и браузеру угадывать нечего.
    """

    recipe = await _visible_recipe(session, recipe_id, user)
    if recipe.photo_path is None:
        raise ApiError(ErrorCode.NOT_FOUND, "У рецепта нет фото.")

    try:
        attachment_id = uuid.UUID(recipe.photo_path)
    except ValueError as exc:
        # В колонке может лежать значение, записанное до подсистемы вложений.
        raise ApiError(ErrorCode.NOT_FOUND, "У рецепта нет фото.") from exc

    attachment = await attachments_repo.get(session, attachment_id)
    if attachment is None or attachment.owner_id != recipe.id:
        raise ApiError(ErrorCode.NOT_FOUND, "У рецепта нет фото.")

    file_path = await run_in_threadpool(files_service.resolve_file, attachment.stored_name)
    if file_path is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Файл недоступен.")

    return FileResponse(
        file_path,
        media_type=attachment.mime,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": files_service.content_disposition(
                attachment.mime, attachment.filename
            ),
        },
    )


@router.post(
    "",
    response_model=RecipeRead,
    status_code=201,
    summary="Добавить рецепт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def create_recipe(
    payload: RecipeWrite, user: CurrentUserDep, session: SessionDep
) -> RecipeRead:
    _reject_duplicates(payload)
    composition = recipes_service.to_composition(payload.ingredients)
    computed, engine_version = await recipes_service.compute_optional(
        session, composition=composition
    )

    recipe = await recipes_repo.create(
        session,
        title=payload.title,
        category=payload.category,
        photo_path=payload.photo_path,
        yield_g=payload.yield_g,
        servings=payload.servings,
        instructions=payload.instructions,
        author_id=user.id,
        ingredients=composition,
        computed=computed,
        engine_version=engine_version,
    )

    created = await _read(session, recipe)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="create",
        entity="recipes",
        entity_id=recipe.id,
        after=created.model_dump(mode="json"),
    )
    return created


@router.put(
    "/{recipe_id}",
    response_model=RecipeRead,
    summary="Изменить рецепт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def update_recipe(
    recipe_id: Annotated[uuid.UUID, Path()],
    payload: RecipeWrite,
    user: CurrentUserDep,
    session: SessionDep,
) -> RecipeRead:
    recipe = await _visible_recipe(session, recipe_id, user)
    _reject_duplicates(payload)

    before = await _read(session, recipe)
    # Состав пересчитывается при каждой записи: иначе у опубликованного рецепта
    # после правки ингредиентов остался бы `computed` от прежнего состава, и семья
    # готовила бы по одному набору продуктов, глядя на показатели другого.
    composition = recipes_service.to_composition(payload.ingredients)
    computed, engine_version = await recipes_service.compute_optional(
        session, composition=composition
    )

    updated = await recipes_repo.update(
        session,
        recipe=recipe,
        title=payload.title,
        category=payload.category,
        photo_path=payload.photo_path,
        yield_g=payload.yield_g,
        servings=payload.servings,
        instructions=payload.instructions,
        ingredients=composition,
        computed=computed,
        engine_version=engine_version,
    )

    after = await _read(session, updated)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="update",
        entity="recipes",
        entity_id=recipe_id,
        before=before.model_dump(mode="json"),
        after=after.model_dump(mode="json"),
    )
    return after


@router.post(
    "/{recipe_id}/publish",
    response_model=RecipeRead,
    summary="Опубликовать рецепт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def publish_recipe(
    recipe_id: Annotated[uuid.UUID, Path()], user: CurrentUserDep, session: SessionDep
) -> RecipeRead:
    """Пересчитывает состав ядром и фиксирует итог вместе с `engine_version`.

    Публикация — момент, когда рецепт становится виден семьям, поэтому расчёт
    делается заново, а не берётся сохранённый ранее.
    """

    recipe = await _visible_recipe(session, recipe_id, user)
    stored = await recipes_repo.list_ingredients(session, recipe_id=recipe.id)
    before = recipes_service.to_read(recipe, stored)

    if not stored:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            "Нельзя опубликовать рецепт без состава: показатели считать не по чему.",
        )

    computed, engine_version = await recipes_service.compute(
        session, composition=recipes_service.stored_composition(stored)
    )

    published = await recipes_repo.publish(
        session, recipe=recipe, computed=computed, engine_version=engine_version
    )

    after = recipes_service.to_read(published, stored)
    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="publish",
        entity="recipes",
        entity_id=recipe_id,
        before=before.model_dump(mode="json"),
        after=after.model_dump(mode="json"),
    )
    return after


@router.delete(
    "/{recipe_id}",
    status_code=204,
    summary="Удалить рецепт",
    dependencies=[Depends(require_roles(*_EDITOR_ROLES))],
)
async def delete_recipe(
    recipe_id: Annotated[uuid.UUID, Path()],
    user: CurrentUserDep,
    session: SessionDep,
) -> Response:
    recipe = await recipes_repo.get(session, recipe_id)
    if recipe is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Рецепт не найден.")

    # Меню — история питания ребёнка, и врач смотрит её задним числом. Удалить
    # рецепт, на который ссылается позиция меню, значит потерять состав того
    # приёма пищи; предлагаем снять с публикации вместо удаления.
    usages = await recipes_repo.count_menu_usages(session, recipe_id=recipe_id)
    if usages:
        raise ApiError(
            ErrorCode.CONFLICT,
            "Рецепт используется в меню и не может быть удалён. "
            "Снимите его с публикации, чтобы он не попадал в новые меню.",
            details={"menu_items": usages},
        )

    before = await _read(session, recipe)
    await recipes_repo.delete(session, recipe=recipe)

    await audit_repo.write_audit_log(
        session,
        user_id=user.id,
        action="delete",
        entity="recipes",
        entity_id=recipe_id,
        before=before.model_dump(mode="json"),
    )
    return Response(status_code=204)
