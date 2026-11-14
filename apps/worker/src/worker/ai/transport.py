"""The wire to a model provider — the only module that imports LiteLLM (ADR-0082).

`AiClient` decides *whether* and *what* to ask: pseudonymisation, limits, the
journal. This module only carries an already safe request to whichever provider
the administrator connected, and brings back the text and the usage in one
shape. LiteLLM is the carrier: one call for Anthropic, OpenAI, Gemini,
OpenRouter, a local Ollama or any OpenAI-compatible gateway, so a new provider
is a row in the cabinet, not a new client in the code.

Nothing here reads prices: money is counted by the catalogue the administrator
keeps (`core.ai_catalog`), so the budget and the journal agree by construction.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

#: Sent in place of a key to servers that need none.
NO_KEY = "not-needed"

#: Retries — three, exponential (section 10.2 of the TZ). LiteLLM does them;
#: a loop of our own on top would make nine attempts out of three.
MAX_RETRIES = 3


@dataclass(frozen=True)
class ModelCall:
    """A request ready for the wire: already pseudonymised and scrubbed."""

    #: `<route>/<model id>` — the LiteLLM model string (`ResolvedModel.route`).
    route: str
    #: Out of `repr`: error reporters print local variables of a failing frame.
    api_key: str = field(repr=False)
    base_url: str | None
    system: str
    #: Text blocks of the single user message, in order.
    parts: tuple[str, ...]
    max_tokens: int
    timeout_s: float


@dataclass(frozen=True)
class Completion:
    #: `None` — the answer came without text (a refusal, an empty completion).
    text: str | None
    tokens_in: int | None
    tokens_out: int | None
    stop_reason: str | None


class Transport(Protocol):
    """What the client needs from the wire — one method. A protocol, so tests
    put their own implementation in without a network."""

    async def complete(self, call: ModelCall) -> Completion: ...


class LiteLLMTransport:
    async def complete(self, call: ModelCall) -> Completion:
        litellm = _litellm()
        response = await litellm.acompletion(
            model=call.route,
            messages=[
                {"role": "system", "content": call.system},
                {
                    "role": "user",
                    "content": [{"type": "text", "text": part} for part in call.parts],
                },
            ],
            max_tokens=call.max_tokens,
            timeout=call.timeout_s,
            num_retries=MAX_RETRIES,
            # A self-hosted server may need no key, but the carrier refuses an
            # empty one before the request leaves ("Missing credentials"). A
            # provider that does need a key never gets here without it: the
            # catalogue refuses the call first (`Provider.ready`).
            api_key=call.api_key or NO_KEY,
            api_base=call.base_url or None,
            # A parameter a provider does not know is dropped, not an error:
            # the same request must go to any of them.
            drop_params=True,
        )
        return _completion_of(response)


def _completion_of(response: Any) -> Completion:
    choices = getattr(response, "choices", None) or []
    first = choices[0] if choices else None
    message = getattr(first, "message", None)
    content = getattr(message, "content", None)
    text = content.strip() if isinstance(content, str) and content.strip() else None
    usage = getattr(response, "usage", None)
    tokens_in = getattr(usage, "prompt_tokens", None)
    tokens_out = getattr(usage, "completion_tokens", None)
    # The carrier fills a missing `usage` with zeros. A text from nothing is
    # not a free call — it is an unknown one: counted as zero, a gateway that
    # omits usage would never fill any budget.
    if text is not None and not tokens_in and not tokens_out:
        tokens_in = tokens_out = None
    return Completion(
        text=text,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        stop_reason=getattr(first, "finish_reason", None),
    )


def _litellm() -> Any:
    """The package, imported on first use — like weasyprint in reports: tasks
    that never call a model do not pay for it, and a worker whose LiteLLM is
    broken still sends reminders and renders reports."""

    # The bundled price map instead of a download from GitHub at import time:
    # the stand must not depend on a third host to start a call.
    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    import litellm

    litellm.telemetry = False
    litellm.suppress_debug_info = True
    return litellm
