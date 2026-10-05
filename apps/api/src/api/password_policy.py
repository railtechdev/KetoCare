"""Проверка нового пароля на очевидность (аудит блокеров, E7).

Длина 12 знаков была единственным правилом, и «111111111111» или
«qwerty123456» проходили. NIST SP 800-63B велит сверять новый пароль со списком
распространённых, угадываемых и скомпрометированных значений — без правил
состава («цифра, заглавная, символ»), которые люди обходят предсказуемо.

Список намеренно короткий и про очевидное: повторы, клавиатурные ряды и
алфавитные последовательности, словарные «пароль + цифры». Полная база утечек —
отдельная зависимость, а для клиники на десятки учётных записей очевидное и есть
главный риск.
"""

from __future__ import annotations

import re

#: Строки, подстрока которых — не пароль: ряды клавиатуры и последовательности.
_SEQUENCES = (
    "01234567890123456789",
    "abcdefghijklmnopqrstuvwxyz",
    "qwertyuiopasdfghjklzxcvbnm",
    "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p",
    "1q2w3e4r5t6y7u8i9o0p",
    "йцукенгшщзхъфывапролджэячсмитьбю",
    "абвгдеежзийклмнопрстуфхцчшщъыьэюя",
)

#: Слова, которые с цифрами в хвосте остаются угадываемыми.
_WORDS = frozenset(
    {
        "password",
        "passw0rd",
        "qwerty",
        "admin",
        "administrator",
        "letmein",
        "welcome",
        "iloveyou",
        "ketocare",
        "keto",
        "пароль",
        "привет",
        "кето",
        "любовь",
    }
)

MESSAGE = (
    "Пароль слишком простой: его легко подобрать. Возьмите фразу из нескольких "
    "слов — например, «синий чайник на подоконнике»."
)


def is_obvious(password: str) -> bool:
    lowered = password.lower().replace("ё", "е")
    compact = re.sub(r"\s+", "", lowered)
    if len(set(compact)) <= 2:
        return True
    for sequence in _SEQUENCES:
        if compact in sequence or compact in sequence[::-1]:
            return True
    stem = re.sub(r"[\d\W_]+$", "", compact)
    stem = re.sub(r"^[\d\W_]+", "", stem)
    if stem in _WORDS:
        return True
    # Короткий кусок, повторённый до длины: «abcabcabcabc», «12341234…».
    return any(compact == (compact[:size] * len(compact))[: len(compact)] for size in range(1, 5))


def check_new_password(password: str) -> str:
    """Валидатор pydantic для полей нового пароля."""

    if is_obvious(password):
        raise ValueError(MESSAGE)
    return password
