"""Изменилась ли в ядре сама программа, а не только пояснения к ней.

**Зачем.** `engine-guard.sh` требует поднять `ENGINE_VERSION` после любой правки
`packages/keto_engine/src`. Правило верное — но страж не отличал правку формулы
от правки комментария, и на исправление устаревшего пояснения предлагал ровно
два выхода: соврать semver'ом (patch без изменения поведения) или оставить в
расчётном ядре текст, который больше не соответствует коду. Оба хуже третьего.

Случай не выдуманный: ADR-0030 перевёл соотношение на чистые углеводы, и
docstring `max_non_fat_grams` стал утверждать про белок с ОБЩИМИ углеводами
неправду. Поведение при этом не изменилось ни на йоту.

**Как.** Файл разбирается в синтаксическое дерево, из дерева убираются
docstring'и, деревья «до» и «после» сравниваются. Комментариев в дереве нет
вовсе, номеров строк в сравнении тоже. Совпало — правились одни пояснения, и
bump не нужен. Отличается — это правка программы, и страж требует версию, как
прежде.

Проверка **консервативна намеренно**: она умеет только СНИМАТЬ требование, и
только когда дерево совпало полностью. Любое сомнение — разбор не удался, файл
не .py, файла нет в git — считается изменением программы. Ошибиться в опасную
сторону она не может: изменение математики неизбежно меняет дерево.

**У исключения есть предпосылка, и она проверяется тестом.** Выбрасывать
docstring из сравнения можно ровно до тех пор, пока ядро само их не читает:
`argparse(description=__doc__)`, собираемый doctest или отдача docstring наружу
сделали бы текст поведением, и тогда проверка начала бы пропускать настоящие
изменения — молча. За этим следит `TestEngineDocstringsAreNotBehaviour` в
`tests/test_guard.py`; трогая эту логику, не выключайте его.

Печатает пути файлов, где изменилась программа (пусто — значит одни пояснения).
Аргументы: пути файлов, изменённых относительно HEAD.
"""

from __future__ import annotations

import ast
import pathlib
import subprocess
import sys

_DEFINITIONS = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def _without_docstrings(source: str) -> str | None:
    """Дерево файла без docstring'ов, строкой. `None` — разобрать не удалось."""

    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return None

    for node in ast.walk(tree):
        if not isinstance(node, _DEFINITIONS):
            continue
        body = node.body
        if not body:
            continue
        first = body[0]
        if (
            isinstance(first, ast.Expr)
            and isinstance(first.value, ast.Constant)
            and isinstance(first.value.value, str)
        ):
            body.pop(0)
            # Пустое тело — синтаксическая ошибка; заглушка сохраняет форму и
            # одинакова у обеих сравниваемых версий.
            if not body:
                body.append(ast.Pass())

    return ast.dump(tree)


def _blob_at_head(path: str) -> str | None:
    """Содержимое файла в HEAD; `None` — файла там нет (новый файл)."""

    completed = subprocess.run(
        ["git", "show", f"HEAD:{path}"],
        capture_output=True,
        text=True,
        check=False,
    )
    return completed.stdout if completed.returncode == 0 else None


def code_changed(path: str) -> bool:
    """Изменилась ли программа в файле. При любом сомнении — да."""

    if not path.endswith(".py"):
        return True

    before = _blob_at_head(path)
    if before is None:
        return True

    try:
        after = pathlib.Path(path).read_text(encoding="utf-8")
    except OSError:
        return True

    before_tree = _without_docstrings(before)
    after_tree = _without_docstrings(after)
    if before_tree is None or after_tree is None:
        return True
    return before_tree != after_tree


def main(argv: list[str]) -> int:
    for path in argv:
        if path and code_changed(path):
            print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
