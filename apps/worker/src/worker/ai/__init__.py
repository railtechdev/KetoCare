"""ИИ-модуль воркера (раздел 10 ТЗ, этап 4 раздела 15).

Готово (п. 18): единственная дверь к модели `client.AiClient` с журналом
`ai_jobs`, предохранителями (суточный предел пользователя, дневной бюджет
проекта) и обязательной псевдонимизацией.

Самих задач здесь пока нет: `parse_free_text` — п. 19, ассистент — п. 20,
сводка врачу и черновики контента — п. 21. Промпты живут в `prompts/` и
меняются отдельным PR с ревью человека (раздел 10.4 ТЗ).
"""

from .client import (
    AiAnswer,
    AiClient,
    AiError,
    AiLimitExceeded,
    AiUnavailable,
    NotConfigured,
    build_ai_client,
)
from .pseudonymize import patient_label, pseudonymize

__all__ = [
    "AiAnswer",
    "AiClient",
    "AiError",
    "AiLimitExceeded",
    "AiUnavailable",
    "NotConfigured",
    "build_ai_client",
    "patient_label",
    "pseudonymize",
]
