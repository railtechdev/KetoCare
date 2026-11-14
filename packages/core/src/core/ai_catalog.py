"""Providers and models the administrator connects in the cabinet (ADR-0082).

Stages 1–2 of the architecture audit left one provider and a price list in the
code: a new model, a second key or another provider needed a developer and a
deploy. Here both are data:

- a **provider** is a connection — its kind (how to talk to it), a key, and for
  self-hosted or gateway servers a base address. Several connections of one
  kind are allowed: a second key for technical work is a separate bill;
- a **model** is an entry of the catalogue: which provider serves it, its id
  there, and its price. The price list in `core.ai_pricing` is only the
  built-in part of the catalogue, and the administrator may override or extend
  it. A price of zero is a statement ("this model is free": a local one), not
  an omission — a model with no entry at all still cannot be chosen, because
  without a price the budget would not count it.

A model is referred to as `<provider id>/<model id>`; a bare id belongs to the
built-in `anthropic` provider, which keeps every value stored or set in the
environment before this module working.
"""

from __future__ import annotations

import enum
import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .ai_pricing import PRICES_USD_PER_MTOK, base_model

#: The provider that exists without a row: its key is the one typed before
#: providers appeared (`ai.api_key`) or `ANTHROPIC_API_KEY`.
BUILTIN_PROVIDER = "anthropic"

_MTOK = Decimal("1000000")

#: Length of `ai_jobs.model`, where the reference is journaled.
REF_MAX = 128

#: Upper bound of a price per million tokens: a typo guard, not a market view.
PRICE_MAX_USD = 10000


class ProviderKind(enum.StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    GEMINI = "gemini"
    OPENROUTER = "openrouter"
    MISTRAL = "mistral"
    DEEPSEEK = "deepseek"
    GROQ = "groq"
    XAI = "xai"
    OLLAMA = "ollama"
    #: Any server that speaks the OpenAI protocol: a gateway (LiteLLM Proxy),
    #: vLLM, LM Studio, a cloud not listed above.
    OPENAI_COMPATIBLE = "openai_compatible"


Auth = Literal["x-api-key", "bearer", "query", "none"]


@dataclass(frozen=True)
class KindInfo:
    """How a kind of provider is called and how its key is checked."""

    #: The route prefix of the model string handed to LiteLLM.
    route: str
    #: Where the provider lives when the administrator gave no address.
    default_base_url: str | None
    needs_key: bool
    #: The address is the administrator's to give: there is no public default.
    needs_base_url: bool
    #: The list of models — the cheapest honest answer to "does this key work".
    models_path: str
    auth: Auth
    #: Where the list and an id sit in the provider's answer.
    list_key: str = "data"
    id_key: str = "id"


KINDS: dict[ProviderKind, KindInfo] = {
    ProviderKind.ANTHROPIC: KindInfo(
        "anthropic", "https://api.anthropic.com", True, False, "/v1/models", "x-api-key"
    ),
    ProviderKind.OPENAI: KindInfo(
        "openai", "https://api.openai.com/v1", True, False, "/models", "bearer"
    ),
    ProviderKind.GEMINI: KindInfo(
        "gemini",
        "https://generativelanguage.googleapis.com/v1beta",
        True,
        False,
        "/models",
        "query",
        list_key="models",
        id_key="name",
    ),
    ProviderKind.OPENROUTER: KindInfo(
        "openrouter", "https://openrouter.ai/api/v1", True, False, "/models", "bearer"
    ),
    ProviderKind.MISTRAL: KindInfo(
        "mistral", "https://api.mistral.ai/v1", True, False, "/models", "bearer"
    ),
    ProviderKind.DEEPSEEK: KindInfo(
        "deepseek", "https://api.deepseek.com", True, False, "/models", "bearer"
    ),
    ProviderKind.GROQ: KindInfo(
        "groq", "https://api.groq.com/openai/v1", True, False, "/models", "bearer"
    ),
    ProviderKind.XAI: KindInfo("xai", "https://api.x.ai/v1", True, False, "/models", "bearer"),
    ProviderKind.OLLAMA: KindInfo(
        "ollama_chat", None, False, True, "/api/tags", "none", list_key="models", id_key="name"
    ),
    ProviderKind.OPENAI_COMPATIBLE: KindInfo("openai", None, False, True, "/models", "bearer"),
}

_PROVIDER_ID = re.compile(r"^[a-z][a-z0-9-]{1,23}$")


def _http_url(value: str | None) -> str | None:
    """A provider address: http(s), a host, a port that exists — and nothing
    else. A query, a fragment or credentials in the address are refused: the
    client appends its own path, and `?x=` or `#` would turn whatever follows
    into an arbitrary path on the server."""

    if value is None:
        return None
    value = value.strip().rstrip("/")
    if not value:
        return None
    if any(char.isspace() for char in value):
        raise ValueError("Адрес без пробелов.")
    try:
        url = httpx.URL(value)
        port = url.port
    except (httpx.InvalidURL, ValueError) as error:
        raise ValueError("Адрес не разобрать.") from error
    if url.scheme not in ("http", "https") or not url.host:
        raise ValueError("Адрес начинается с http:// или https:// и называет сервер.")
    if url.query or url.fragment or "?" in value or "#" in value:
        raise ValueError("В адресе не должно быть «?» и «#».")
    if url.userinfo:
        raise ValueError("Логин и пароль в адресе не принимаются — для этого есть ключ.")
    if port is not None and not 0 < port < 65536:
        raise ValueError("Порт — число от 1 до 65535.")
    return value


def host_allowed(url: str | None, allowed: str) -> bool:
    """Is the host of `url` on the server's list (`AI_PROVIDER_HOSTS`)?

    Empty list — any host. No custom address — the provider's public one,
    always allowed.
    """

    patterns = [item.strip().lower() for item in allowed.split(",") if item.strip()]
    if not patterns or not url:
        return True
    try:
        host = httpx.URL(url).host.lower()
    except (httpx.InvalidURL, ValueError):
        return False
    for pattern in patterns:
        if pattern.startswith("*."):
            if host.endswith(pattern[1:]):
                return True
        elif host == pattern:
            return True
    return False


class ProviderSettings(BaseModel):
    """A connection as the administrator sets it. The key is stored apart."""

    model_config = ConfigDict(extra="forbid")

    kind: ProviderKind
    name: str = Field(min_length=1, max_length=60)
    base_url: str | None = Field(default=None, max_length=300)
    enabled: bool = True

    _check_url = field_validator("base_url")(_http_url)

    @field_validator("name")
    @classmethod
    def _trim(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Назовите подключение.")
        return value


class ModelEntry(BaseModel):
    """A catalogue entry as stored: one model of one provider and its price."""

    model_config = ConfigDict(extra="forbid")

    provider: str = Field(min_length=2, max_length=24)
    model: str = Field(min_length=1, max_length=120)
    name: str | None = Field(default=None, max_length=80)
    usd_per_mtok_in: Decimal = Field(ge=0, le=PRICE_MAX_USD)
    usd_per_mtok_out: Decimal = Field(ge=0, le=PRICE_MAX_USD)
    enabled: bool = True

    @field_validator("model")
    @classmethod
    def _one_token(cls, value: str) -> str:
        value = value.strip()
        if not value or any(char.isspace() for char in value):
            raise ValueError("Идентификатор модели — одна строка без пробелов.")
        return value

    @field_validator("name")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        value = (value or "").strip()
        return value or None

    @model_validator(mode="after")
    def _ref_fits(self) -> ModelEntry:
        # A bare id belongs to the built-in provider; a slash in it would make
        # the same reference as another connection's model and take its place.
        if self.provider == BUILTIN_PROVIDER and "/" in self.model:
            raise ValueError("У модели встроенного подключения в идентификаторе нет «/».")
        # The reference is written to `ai_jobs.model` (128 characters).
        if len(self.ref) > REF_MAX:
            raise ValueError("Слишком длинный идентификатор модели.")
        return self

    @property
    def ref(self) -> str:
        return model_ref(self.provider, self.model)


def is_provider_id(value: str) -> bool:
    return bool(_PROVIDER_ID.match(value))


def model_ref(provider_id: str, model: str) -> str:
    """How settings refer to a model. Bare for the built-in provider: values
    stored and set in the environment before providers existed stay valid."""

    return model if provider_id == BUILTIN_PROVIDER else f"{provider_id}/{model}"


@dataclass(frozen=True)
class Provider:
    id: str
    kind: ProviderKind
    name: str
    base_url: str | None
    enabled: bool
    #: Out of `repr`: error reporters print local variables of a failing frame.
    api_key: str = field(repr=False)
    #: `admin` — typed in the cabinet; `env` — the environment fallback (only
    #: the built-in provider has one).
    key_source: Literal["admin", "env"] | None
    builtin: bool
    #: The address is on the server's list of hosts (`AI_PROVIDER_HOSTS`).
    host_allowed: bool = True

    @property
    def info(self) -> KindInfo:
        return KINDS[self.kind]

    @property
    def ready(self) -> bool:
        """Can a call go out: switched on, and has what its kind needs."""

        if not self.enabled or not self.host_allowed:
            return False
        if self.info.needs_key and not self.api_key:
            return False
        return not (self.info.needs_base_url and not self.base_url)


@dataclass(frozen=True)
class CatalogModel:
    ref: str
    provider_id: str
    #: The id the provider knows the model by.
    model: str
    name: str | None
    usd_per_mtok_in: Decimal
    usd_per_mtok_out: Decimal
    enabled: bool
    #: From the price list in the code (`core.ai_pricing`).
    builtin: bool
    #: A built-in entry whose price or switch the administrator changed.
    overridden: bool = False

    def cost(self, *, tokens_in: int | None, tokens_out: int | None) -> Decimal | None:
        """What a call cost, or `None` when the answer carried no usage."""

        if tokens_in is None or tokens_out is None:
            return None
        return (
            self.usd_per_mtok_in * Decimal(tokens_in) + self.usd_per_mtok_out * Decimal(tokens_out)
        ) / _MTOK


@dataclass(frozen=True)
class ResolvedModel:
    """A model reference resolved to what a call needs."""

    provider: Provider
    entry: CatalogModel
    #: The id to send — the reference as typed, so a dated snapshot
    #: (`claude-haiku-4-5-20251001`) is called as such at the model's price.
    model: str

    @property
    def route(self) -> str:
        return f"{self.provider.info.route}/{self.model}"


def builtin_models() -> dict[str, CatalogModel]:
    return {
        model: CatalogModel(
            ref=model,
            provider_id=BUILTIN_PROVIDER,
            model=model,
            name=None,
            usd_per_mtok_in=price_in,
            usd_per_mtok_out=price_out,
            enabled=True,
            builtin=True,
        )
        for model, (price_in, price_out) in PRICES_USD_PER_MTOK.items()
    }


@dataclass(frozen=True)
class Catalog:
    providers: dict[str, Provider]
    models: dict[str, CatalogModel]

    def resolve(self, ref: str | None) -> ResolvedModel | None:
        """The model behind a reference, or `None` when nothing may be called:
        no such entry, the entry or its provider is switched off, or the
        provider lacks its key or address."""

        ref = (ref or "").strip()
        if not ref:
            return None
        entry = self.models.get(ref)
        model = entry.model if entry is not None else ""
        if entry is None and "/" not in ref:
            # A dated snapshot or `-latest` alias of a built-in provider model.
            entry = self.models.get(base_model(ref))
            model = ref
        if entry is None or not entry.enabled:
            return None
        provider = self.providers.get(entry.provider_id)
        if provider is None or not provider.ready:
            return None
        return ResolvedModel(provider=provider, entry=entry, model=model)

    def usable(self, ref: str | None) -> bool:
        return self.resolve(ref) is not None


def merge_models(
    stored: list[dict[str, Any]], providers: dict[str, Provider]
) -> dict[str, CatalogModel]:
    """The effective catalogue: the built-in list overlaid by stored entries.

    Entries that no longer validate or whose provider is gone are skipped, not
    fatal: one bad row must not take every AI function down.
    """

    models: dict[str, CatalogModel] = builtin_models()
    for raw in stored:
        try:
            entry = ModelEntry.model_validate(raw)
        except ValueError:
            continue
        if entry.provider not in providers:
            continue
        ref = entry.ref
        builtin = ref in models and models[ref].builtin
        models[ref] = CatalogModel(
            ref=ref,
            provider_id=entry.provider,
            model=entry.model,
            name=entry.name,
            usd_per_mtok_in=entry.usd_per_mtok_in,
            usd_per_mtok_out=entry.usd_per_mtok_out,
            enabled=entry.enabled,
            builtin=builtin,
            overridden=builtin,
        )
    return models


__all__ = [
    "BUILTIN_PROVIDER",
    "KINDS",
    "Catalog",
    "CatalogModel",
    "KindInfo",
    "ModelEntry",
    "Provider",
    "ProviderKind",
    "ProviderSettings",
    "ResolvedModel",
    "builtin_models",
    "host_allowed",
    "is_provider_id",
    "merge_models",
    "model_ref",
]
