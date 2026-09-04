"""Постфильтры текста модели — общий код API и воркера.

Почему в `core`, а не рядом с остальным ИИ-кодом в `apps/worker`: фильтр сводки
нужен обоим. Воркер проверяет им черновик, ручка `POST …/summaries/{id}/approve`
— текст, который врач утверждает. Импортировать воркер из API нельзя (у него
weasyprint и системные библиотеки, веб-процессу они не нужны — это записано в
`apps/api/pyproject.toml`), а вторая копия правил разошлась бы с первой.

В БД этот пакет не ходит и ничего о ней не знает: чистые функции над строками.
"""

from .summary_guard import Finding, Kind, check, has_hard
from .textscan import find_any, normalize, sentences

__all__ = [
    "Finding",
    "Kind",
    "check",
    "find_any",
    "has_hard",
    "normalize",
    "sentences",
]
