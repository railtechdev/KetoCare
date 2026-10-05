#!/usr/bin/env python3
"""Анализ Bash-команды и правки файла на нарушение правил проекта.

Две задачи, разные по природе:

1. **Защищённые пути.** Принцип — fail-closed: если в команде упомянут
   защищённый путь, она блокируется, пока не доказано, что каждый её сегмент
   только читает. Обратный принцип («блокировать по списку опасных шаблонов»)
   неизбежно дырявый: запись возможна через python3 -c, node -e, perl -pi,
   cd в каталог, подстановку переменной — перечислить все способы нельзя.

2. **Порядок работы с main.** Ветка → PR → merge. Это не защита от злого умысла,
   а страховка от привычки: коммит в main проходит мимо ревью и мимо CI, а с
   автодеплоем — сразу уезжает на стенд.

Хук защищает от НЕОСТОРОЖНОСТИ, а не от намеренного обхода: закодировать команду
в base64 и выполнить всё равно можно. Задача — чтобы правки медицинских данных,
миграций и боевой ветки не происходили мимоходом, незаметно для человека.

Код самих хуков намеренно НЕ защищён (в отличие от `.claude/settings.json`).
Механический запрет стоил дороже, чем давал: любая правка правил требовала
ручного вмешательства человека, а обойти запрет всё равно можно было. Вместо
него — два других контроля: правило «main только через PR» делает изменение
правил видимым в ревью, а `tests/test_guard.py` падает, если набор запретов
поредел. `settings.json` остаётся под защитой: он выключает все хуки разом,
и его правка не роняет ни одного теста.

Вход: JSON от Claude Code на stdin. Выход: 0 — разрешить, 2 — заблокировать.
"""

from __future__ import annotations

import functools
import json
import os
import re
import shlex
import subprocess
import sys

# --- защищённые пути -------------------------------------------------------
# Единственное место, где перечислены пути: и protect-paths.sh (Edit/Write), и
# protect-bash.sh (Bash) вызывают этот же файл, только с разным режимом. Две
# копии списка — на bash и на регулярках — однажды разошлись бы незаметно.

PROTECTED_DIRS = (
    # Медицинские спецификации и эталоны — только медицинская команда (ТЗ §0.1)
    "docs/medical",
    # Клиническая часть базы знаний помощника: её текст семья читает как ответ
    # приложения, и подписывает его медицинская команда (раздел 10.4 ТЗ,
    # правило 1). Соседний каталог `product/` не защищён — там про кнопки.
    "docs/knowledge-base/clinical",
    # Alembic-миграции, попавшие в main, не правятся (ТЗ §0.3)
    "migrations/versions",
    "alembic/versions",
)

PROTECTED_FILES = (".claude/settings.json",)

# Каталог считается упомянутым и без завершающего слэша: иначе `cd docs/medical`
# проходил бы мимо проверки, а следующий сегмент писал бы относительным путём.
PROTECTED_RE = re.compile(
    "|".join(re.escape(d) + r"(?:/|\b)" for d in PROTECTED_DIRS)
    + "|"
    + "|".join(re.escape(f) for f in PROTECTED_FILES)
)

# Исключения: агент обязан писать вопросы медкоманде и переменные окружения-примеры
ALLOWED = (
    "docs/medical/OPEN_QUESTIONS.md",
    ".env.example",
)

# .env обрабатывается отдельно: как отдельное слово, чтобы .env.example и
# упоминания вида "environment" не считались совпадением.
ENV_RE = re.compile(r"(^|[\s\"'/=])\.env(\.[A-Za-z0-9_-]+)?([\s\"';&|)]|$)")

# Путь до файла миграции. Нужен отдельно от PROTECTED_RE: правило запрещает
# править миграцию, ПОПАВШУЮ В MAIN, а ревизия ветки — обычный рабочий файл,
# который приходится и править по замечанию ревью, и удалять, и добавлять в индекс.
MIGRATION_FILE_RE = re.compile(r"[\w./-]*(?:migrations|alembic)/versions/[\w.-]+\.py")

# Ветка, попадание в которую замораживает миграцию (ТЗ §0.3: «после их
# попадания в main»). Сверяется с удалённой веткой: локальная main в рабочих
# деревьях не перематывается и отстаёт.
FROZEN_REF = "origin/main"

# --- команды, которые заведомо только читают -------------------------------
READ_ONLY = {
    "cat",
    "bat",
    "head",
    "tail",
    "less",
    "more",
    "nl",
    "grep",
    "egrep",
    "fgrep",
    "rg",
    "ack",
    "ls",
    "ll",
    "tree",
    "find",
    "stat",
    "file",
    "du",
    "wc",
    "basename",
    "dirname",
    "sort",
    "uniq",
    "cut",
    "column",
    "diff",
    "cmp",
    "md5",
    "md5sum",
    "shasum",
    "echo",
    "printf",
    "true",
    "test",
    "which",
    "type",
    "jq",
    "yq",
    "date",
    "pwd",
}

# Флаги, с которыми «читающая» команда пишет файл. `find -delete` и `-exec rm`
# удаляют, `yq -i` правит на месте, `sort -o` и `tree -o` пишут результат в файл.
# Без этого списка они проходили как чтение: имя команды стояло в READ_ONLY.
WRITING_FLAGS = {
    "find": (
        "-delete",
        "-exec",
        "-execdir",
        "-ok",
        "-okdir",
        "-fprint",
        "-fprint0",
        "-fprintf",
        "-fls",
    ),
    "yq": ("-i", "--inplace", "--in-place"),
    "sort": ("-o", "--output"),
    "tree": ("-o",),
}

# git — только читающие подкоманды
GIT_READ_ONLY = {"log", "diff", "show", "status", "ls-files", "blame", "cat-file", "rev-parse"}

# Подкоманды git, создающие коммит в текущей ветке. На main запрещены целиком.
GIT_COMMIT_VERBS = {"commit", "merge", "rebase", "cherry-pick", "revert", "am"}

# Глобальные параметры git, которые стоят ДО подкоманды и забирают следующее
# слово: `git -C <каталог> commit`, `git -c k=v commit`. Без их разбора
# подкомандой считался каталог или `k=v`, и коммит в main проходил мимо правила.
GIT_OPTIONS_WITH_VALUE = {
    "-C",
    "-c",
    "--git-dir",
    "--work-tree",
    "--namespace",
    "--super-prefix",
    "--config-env",
}

# Флаги, у которых `.env` — читаемый вход, а не цель записи.
ENV_READ_FLAGS = ("--env-file", "--envfile", "--env_file")

# Команды, для которых `.env` в аргументах означает запись в него.
ENV_WRITERS = {
    "rm",
    "mv",
    "cp",
    "sed",
    "tee",
    "truncate",
    "install",
    "chmod",
    "chown",
    "ln",
    "touch",
    "dd",
    "vim",
    "vi",
    "nano",
    "emacs",
    "sponge",
    "shred",
}


def _project_dir() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())


_MIGRATION_IN_LISTING_RE = re.compile(r"(?:^|/)(?:migrations|alembic)/versions/([^/]+\.py)$")


def _migration_names_from(args: list[str]) -> frozenset[str] | None:
    """Имена файлов миграций из листинга git; None — git не ответил."""

    try:
        result = subprocess.run(
            args,
            cwd=_project_dir(),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    names = set()
    for line in result.stdout.splitlines():
        match = _MIGRATION_IN_LISTING_RE.search(line.strip())
        if match:
            names.add(match.group(1))
    return frozenset(names)


@functools.lru_cache(maxsize=1)
def _frozen_migration_names() -> frozenset[str] | None:
    """Имена миграций, которые уже нельзя править, — без каталогов.

    Правило ТЗ §0.3: «никаких правок старых миграций после их попадания в
    main». Поэтому сверка идёт с `origin/main`: ревизия, закоммиченная в ветке,
    но ещё не слитая, правится по замечанию ревью без участия человека. Прежде
    хук замораживал миграцию уже при `git add`, и правка до слияния требовала
    человека ради правила, которое её не запрещает.

    Если `origin/main` недоступна (клон без удалённой ветки, неглубокая выгрузка
    в CI), запасной ответ — индекс: защищено всё, что закоммичено или добавлено.
    Это строже правила, но не слабее. `None` — git не ответил вовсе.

    Сверять полный путь нельзя: `cd packages/core && rm migrations/versions/x.py`
    даёт путь от другого корня, и проверка сочла бы замороженную миграцию новой.
    Имя ревизии несёт хеш и уникально, поэтому сравнение по имени и строже, и
    честнее.
    """

    frozen = _migration_names_from(["git", "ls-tree", "-r", "--name-only", FROZEN_REF])
    if frozen is not None:
        return frozen
    return _migration_names_from(["git", "ls-files", "--", "*/versions/*.py"])


def _migration_is_frozen(path: str) -> bool:
    """Миграция уже в main (или, без доступа к main, в индексе)?"""

    frozen = _frozen_migration_names()
    if frozen is None:
        # Git недоступен — считаем защищённым: лучше лишний вопрос человеку,
        # чем правка слитой миграции по недосмотру.
        return True
    return path.rsplit("/", 1)[-1] in frozen


def _mask_allowed(text: str) -> str:
    masked = text
    for allowed in ALLOWED:
        masked = masked.replace(allowed, "@ALLOWED@")
    # Ревизия, ещё не попавшая в main, — обычный файл. Скрываем её от проверки,
    # чтобы `rm`/`git add`/правка по ней работали: правило ТЗ говорит именно о
    # миграции, попавшей в main.
    candidates = MIGRATION_FILE_RE.findall(masked)
    if candidates:
        for candidate in candidates:
            if not _migration_is_frozen(candidate):
                masked = masked.replace(candidate, "@ALLOWED@")
    return masked


def mentions_protected_paths(text: str) -> bool:
    return bool(PROTECTED_RE.search(_mask_allowed(text)))


def mentions_env(text: str) -> bool:
    return bool(ENV_RE.search(_mask_allowed(text)))


def mentions_protected(text: str) -> bool:
    """Совместимость со старым интерфейсом: путь ИЛИ .env."""

    return mentions_protected_paths(text) or mentions_env(text)


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def split_segments(command: str) -> list[str]:
    """Разбивает команду на сегменты по ; && || | & и переводам строк.

    С учётом кавычек: `ssh host 'a && b'` — это ОДИН сегмент, обращённый к
    другой машине. Наивное разбиение регуляркой делило его пополам, второй
    кусок выглядел локальной командой, и разбор `ssh` не срабатывал никогда.

    С учётом heredoc: тело `<<EOF … EOF` — это ДАННЫЕ команды, а не команды.
    Раньше оно резалось по переводам строк наравне с кодом, и каждая его
    строка выглядела отдельной локальной командой. Отсюда два ложных
    срабатывания: сообщение коммита, в котором упомянут `git push origin
    main`, упиралось в правило про main, а `ssh host <<EOF` с работой над
    файлом секретов сервера — в защиту локального файла секретов. Тело
    остаётся при своём сегменте; что с ним делать дальше, решают
    `strip_heredocs` и `heredoc_bodies`.

    С учётом обратной косой черты, как у оболочки: внутри двойных кавычек `\\"`
    кавычку не закрывает, а вне кавычек `\\;` — не разделитель (`find … -exec
    rm {} \\;`). Внутри одинарных кавычек черта — обычный знак. Пока экранирование
    не учитывалось, `grep "a\\"; b" файл` резался посередине строки, и обломок
    с незакрытой кавычкой выглядел пишущей командой.
    """

    segments: list[str] = []
    current: list[str] = []
    quote: str | None = None
    pending: list[str] = []
    index = 0
    while index < len(command):
        char = command[index]
        if char == "\\" and quote != "'" and index + 1 < len(command):
            current.append(command[index : index + 2])
            index += 2
            continue
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            index += 1
            continue
        if char in "'\"":
            quote = char
            current.append(char)
            index += 1
            continue
        # `<<<` — это here-string, тела у него нет.
        if command.startswith("<<", index) and not command.startswith("<<<", index):
            match = HEREDOC_RE.match(command, index)
            if match:
                pending.append(match.group(2))
                current.append(match.group(0))
                index = match.end()
                continue
        if command.startswith(("&&", "||"), index):
            segments.append("".join(current))
            current = []
            index += 2
            continue
        if char == "\n" and pending:
            # Строка кончилась, а heredoc открыт: дальше идут данные до
            # ограничителя, и делить их нельзя.
            body, index = _consume_heredocs(command, index + 1, pending)
            current.append("\n" + body)
            pending = []
            continue
        if char in ";|&\n":
            segments.append("".join(current))
            current = []
            index += 1
            continue
        current.append(char)
        index += 1
    segments.append("".join(current))
    return [s for s in segments if s.strip()]


def _consume_heredocs(command: str, index: int, delimiters: list[str]) -> tuple[str, int]:
    """Тело всех открытых heredoc от `index` до последнего ограничителя."""

    body: list[str] = []
    remaining = list(delimiters)
    while remaining and index < len(command):
        end = command.find("\n", index)
        line = command[index:] if end == -1 else command[index:end]
        body.append(line)
        index = len(command) if end == -1 else end + 1
        if line.strip() == remaining[0]:
            remaining.pop(0)
    return "\n".join(body), index


def strip_heredocs(segment: str) -> str:
    """Сегмент без тел heredoc — только то, что выполняет оболочка."""

    result: list[str] = []
    pending: list[str] = []
    for line in segment.split("\n"):
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
            continue
        result.append(line)
        for match in HEREDOC_RE.finditer(line):
            pending.append(match.group(2))
    return "\n".join(result)


def heredoc_bodies(segment: str) -> str:
    """Только тела heredoc: для команд, которые их ИСПОЛНЯЮТ."""

    body: list[str] = []
    pending: list[str] = []
    for line in segment.split("\n"):
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
                continue
            body.append(line)
            continue
        for match in HEREDOC_RE.finditer(line):
            pending.append(match.group(2))
    return "\n".join(body)


#: Команды, для которых тело heredoc — это код, а не данные. Для них тело
#: разбирается наравне с остальным: оболочка, получившая скрипт на вход,
#: выполняет его целиком, и защита обязана видеть каждую строку.
HEREDOC_INTERPRETERS = {
    "bash",
    "sh",
    "zsh",
    "dash",
    "ksh",
    "python",
    "python3",
    "node",
    "perl",
    "ruby",
    "php",
    "psql",
    "mysql",
    "docker",
    "kubectl",
    "uv",
}


def _tokens(segment: str) -> list[str]:
    try:
        return shlex.split(segment, posix=True)
    except ValueError:
        # Незакрытая кавычка (частый случай — heredoc)
        return segment.split()


#: Параметры `env`, забирающие следующее слово: `env -u NAME cmd`, `env -C dir cmd`.
_ENV_OPTIONS_WITH_VALUE = {"-u", "--unset", "-C", "--chdir", "-S", "--split-string"}

#: Параметры `xargs` (GNU и BSD), забирающие следующее слово: `xargs -I {} cmd`,
#: `xargs -n 1 cmd`, `xargs -a список cmd`. Без их разбора командой считалось
#: значение параметра.
_XARGS_OPTIONS_WITH_VALUE = {
    "-I",
    "-J",
    "-L",
    "-n",
    "-P",
    "-s",
    "-E",
    "-d",
    "-a",
    "-R",
    "-S",
    "--arg-file",
    "--delimiter",
    "--max-args",
    "--max-procs",
    "--max-chars",
    "--process-slot-var",
}


def _unwrap(segment: str) -> tuple[list[str], bool]:
    """Слова сегмента с настоящей команды — и стоял ли перед ней `xargs`.

    `xargs` разбирается как `env`: судят по команде, которую он запускает.
    Вдобавок он получает аргументы из стандартного ввода, то есть защищённый
    путь в сегменте может не стоять вовсе: `ls каталог | xargs rm`. Поэтому
    признак «через xargs» отдаётся наружу — его проверяет `segments_blocked`.
    """

    skip_prefix = {"sudo", "command", "nohup", "time", "nice"}
    tokens = _tokens(segment)
    via_xargs = False
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if "=" in token and not token.startswith("-") and "/" not in token.split("=")[0]:
            index += 1  # FOO=bar
            continue
        if token in skip_prefix:
            index += 1
            continue
        if token.rsplit("/", maxsplit=1)[-1] == "xargs":
            via_xargs = True
            rest = index + 1
            while rest < len(tokens) and tokens[rest].startswith("-"):
                if tokens[rest] == "--":
                    rest += 1
                    break
                rest += 2 if tokens[rest] in _XARGS_OPTIONS_WITH_VALUE else 1
            if rest >= len(tokens):
                # Голый `xargs` запускает `echo`: печатает, ничего не пишет.
                return tokens[index:], via_xargs
            index = rest
            continue
        if token.rsplit("/", maxsplit=1)[-1] == "env":
            rest = index + 1
            while rest < len(tokens) and tokens[rest].startswith("-"):
                rest += 2 if tokens[rest] in _ENV_OPTIONS_WITH_VALUE else 1
            while rest < len(tokens) and "=" in tokens[rest] and not tokens[rest].startswith("-"):
                rest += 1
            if rest >= len(tokens):
                return tokens[index:], via_xargs
            index = rest
            continue
        return tokens[index:], via_xargs
    return [], via_xargs


def command_tokens(segment: str) -> list[str]:
    """Слова сегмента, начиная с имени настоящей команды.

    Снимаются присваивания окружения (`FOO=bar`), обёртки (`sudo`, `nohup` …),
    `env` и `xargs` с их параметрами. `env` — не читающая команда, а обёртка:
    `env rm файл` удаляет файл. Пока он стоял в списке читающих, такая команда
    проходила как чтение. Голый `env` (печать окружения) остаётся самим собой.
    """

    return _unwrap(segment)[0]


def runs_through_xargs(segment: str) -> bool:
    return _unwrap(segment)[1]


def first_word(segment: str) -> str:
    """Имя команды сегмента без присваиваний окружения и обёрток."""

    tokens = command_tokens(segment)
    return tokens[0].rsplit("/", maxsplit=1)[-1] if tokens else ""


def _redirects(segment: str) -> bool:
    return bool(re.search(r"(?<![0-9<>])>>?", segment))


def segment_is_read_only(segment: str) -> bool:
    # Любое перенаправление вывода делает сегмент пишущим
    if _redirects(segment):
        return False

    name = first_word(segment)
    if not name:
        return False

    if name == "git":
        # `-c core.pager=…`, `diff.external`, `core.fsmonitor` исполняют
        # произвольную команду, `--output=` пишет в файл: с ними чтения нет
        # (находка ревью, 05.10.2026).
        tokens = command_tokens(segment)
        if any(
            token in ("-c", "--config-env", "--exec-path")
            or token.startswith(("--config-env=", "--exec-path=", "--output"))
            for token in tokens
        ):
            return False
        verb, rest, _ = _git_parts(segment)
        if verb == "grep":
            return _git_grep_is_read_only(rest)
        return verb in GIT_READ_ONLY

    # cd в защищённый каталог открывает запись относительными путями дальше
    if name == "cd":
        return not mentions_protected(segment)

    # Голый `env` печатает окружение; с командой его снимает `command_tokens`.
    # `-S`/`--split-string` исполняют строку — это команда, а не чтение.
    if name == "env":
        return not any(
            token in ("-S", "--split-string") or token.startswith("--split-string=")
            for token in _tokens(segment)
        )

    # Голый `xargs` (без команды) запускает `echo`.
    if name == "xargs":
        return True

    args = command_tokens(segment)[1:]

    if name == "uniq":
        # Через `xargs` аргументы приходят из ввода, и сколько их, не видно:
        # `ls каталог | xargs uniq` перезапишет второй файл первым.
        return not runs_through_xargs(segment) and _uniq_is_read_only(args)

    if name == "sed":
        return _sed_is_read_only(args)

    if name in ("awk", "gawk", "mawk", "nawk"):
        return _awk_is_read_only(args)

    writing = WRITING_FLAGS.get(name, ())
    if any(arg in writing or arg.startswith(tuple(f"{f}=" for f in writing)) for arg in args):
        return False

    return name in READ_ONLY


#: Параметры `uniq`, забирающие следующее слово: `uniq -f 1 файл`.
_UNIQ_OPTIONS_WITH_VALUE = {"-f", "-s", "-w", "--skip-fields", "--skip-chars", "--check-chars"}


def _uniq_is_read_only(args: list[str]) -> bool:
    """`uniq ВХОД` печатает; `uniq ВХОД ВЫХОД` пишет во второй аргумент."""

    positional = 0
    index = 0
    options_done = False
    while index < len(args):
        arg = args[index]
        if not options_done and arg == "--":
            options_done = True
        elif not options_done and arg.startswith("-") and arg != "-":
            if arg in _UNIQ_OPTIONS_WITH_VALUE:
                index += 1
        else:
            positional += 1
        index += 1
    return positional < 2


def _git_grep_is_read_only(args: list[str]) -> bool:
    """`git grep` читает, пока не открывает найденное программой.

    `-O`/`--open-files-in-pager[=программа]` запускает произвольную команду над
    найденными файлами. Короткие флаги git склеивает (`-iO`), длинные — понимает
    по однозначному началу (`--open`), поэтому проверка нарочно грубая.
    """

    # `--` не обрывает проверку: `-e` и `-f` забирают следующее слово, даже если
    # это `--`, и `git grep -e -- -Ovim …` открывает найденное программой.
    for arg in args:
        if arg == "--":
            continue
        if arg.startswith("--op"):
            return False
        if arg.startswith("-") and not arg.startswith("--") and "O" in arg:
            return False
    return True


# Скрипт `sed -n`, который только печатает: адреса (номер, `$`, `/регулярка/`,
# диапазон) и команды `p`, `l`, `=`, `q`, через `;`. Всё остальное — `w файл`,
# `s///w`, `e` у GNU sed — пишет или исполняет, и разбирать их тоньше незачем.
_SED_ADDRESS = r"(?:\d+|\$|/(?:[^/\\]|\\.)*/)"
_SED_PRINT_SCRIPT_RE = re.compile(
    rf"^\s*(?:{_SED_ADDRESS}(?:\s*[,~]\s*{_SED_ADDRESS})?\s*!?\s*[pl=q]\s*(?:;\s*|$))+$"
)


def _sed_is_read_only(args: list[str]) -> bool:
    """`sed -n '1,20p' файл` — чтение; `-i`, `w` и прочее — запись."""

    quiet = any(
        a in ("--quiet", "--silent")
        or (a.startswith("-") and not a.startswith("--") and "n" in a[1:])
        for a in args
    )
    if not quiet:
        # Без `-n` скрипт обычно правит текст (`s///`), а у `s` есть флаг
        # `w файл`. Читающий случай, ради которого правило, один — `sed -n`.
        return False
    scripts: list[str] = []
    positional: list[str] = []
    index = 0
    while index < len(args):
        arg = args[index]
        if arg in ("-e", "--expression"):
            if index + 1 >= len(args):
                return False
            scripts.append(args[index + 1])
            index += 2
            continue
        if arg.startswith("--expression="):
            scripts.append(arg.split("=", 1)[1])
        elif arg.startswith("-"):
            # Короткие флаги пачкой (`-nE`); `-i`/`--in-place` и `-f файл`
            # (скрипт неизвестен) — не чтение.
            if arg.startswith("--"):
                if arg not in ("--quiet", "--silent", "--regexp-extended", "--posix"):
                    return False
            elif set(arg[1:]) - set("nEr"):
                return False
        else:
            positional.append(arg)
        index += 1
    if not scripts:
        if not positional:
            return False
        scripts.append(positional[0])
    return all(_SED_PRINT_SCRIPT_RE.match(script) for script in scripts)


def _awk_is_read_only(args: list[str]) -> bool:
    """`awk '{print $1}' файл` — чтение.

    Пишет awk тремя путями: `print > "файл"` (ловит общая проверка
    перенаправления — она смотрит и внутрь кавычек), `print | "команда"` и
    `system()`, плюс `gawk -i inplace`. Программа из файла (`-f`) неизвестна —
    не чтение.
    """

    # Белый список, а не перечень опасного: у gawk десятки способов писать —
    # `@include "inplace"`, `-e`/`--source` с программой во флаге, `--file=`,
    # `-l`/`--load` с расширением (находка ревью, 05.10.2026). Разрешены только
    # `-F` и `-v`; любой другой флаг — не чтение.
    skip_value = False
    for arg in args:
        if skip_value:
            skip_value = False
            continue
        if arg in ("-F", "-v"):
            skip_value = True
            continue
        if arg.startswith(("-F", "-v")) and len(arg) > 2:
            continue
        if arg.startswith("-"):
            return False
        if any(marker in arg for marker in ("system", "|", "@include", "@load", "getline")):
            return False
    return True


def env_usage_is_read_only(segment: str) -> bool:
    """`.env` в сегменте только читается?

    Отдельно от `segment_is_read_only`, потому что защищается ФАЙЛ, а не
    операция. `docker compose --env-file .env ... up -d` поднимает контейнеры и
    ничего в `.env` не пишет — блокировать его бессмысленно, а раньше он
    блокировался: имя команды не входило в список читающих.

    Правило: чтение, если каждое вхождение `.env` — значение читающего флага
    (`--env-file .env`, `--env-file=.env`), нет перенаправления в файл и команда
    не из списка тех, для кого `.env` в аргументах означает запись.
    """

    if _redirects(segment):
        return False

    name = first_word(segment)
    if name in ENV_WRITERS:
        return False

    tokens = _tokens(segment)
    for index, token in enumerate(tokens):
        if not ENV_RE.search(f" {token} "):
            continue
        # `--env-file=.env`
        if any(token.startswith(f"{flag}=") for flag in ENV_READ_FLAGS):
            continue
        # `--env-file .env`
        if index > 0 and tokens[index - 1] in ENV_READ_FLAGS:
            continue
        return False
    return True


QUOTED_RE = re.compile(r"'[^']*'|\"[^\"]*\"")


def local_part(segment: str) -> str:
    """Часть команды, которая действует на ЭТОЙ машине.

    Нужна для `ssh`: `ssh host 'cat > /srv/ketocare/.env'` не трогает файлы
    репозитория — путь и перенаправление относятся к удалённой машине. Без
    этого разбора любая работа с сервером упиралась в защиту локального `.env`,
    ничего при этом не защищая.

    Кавычки снимаются только у `ssh`. У локальных команд содержимое кавычек —
    это код (`python3 -c "open('.env','w')"`), и снимать его нельзя.
    """

    if first_word(segment) != "ssh":
        return segment
    # Остаётся то, что вне кавычек и вне тела heredoc: там же окажется и
    # перенаправление в локальный файл, если кто-то его напишет. Тело heredoc
    # уходит на ту сторону целиком — это скрипт удалённой машины, и наш
    # репозиторий он не трогает по определению.
    return QUOTED_RE.sub(" ", strip_heredocs(segment))


def segment_blocked(segment: str) -> bool:
    """Сегмент нарушает защиту путей?

    Тело heredoc разбирается отдельно и только у интерпретаторов. Для всех
    остальных команд это данные: текст сообщения коммита, содержимое файла,
    скрипт для удалённой машины. Разбирать их как локальные команды значило бы
    блокировать работу за упоминание пути в тексте — что и происходило.
    """

    segment = local_part(segment)

    if first_word(segment) in HEREDOC_INTERPRETERS:
        body = heredoc_bodies(segment)
        if body.strip() and segments_blocked(split_segments(body)):
            return True

    command_part = strip_heredocs(segment)

    if mentions_protected_paths(command_part) and not segment_is_read_only(command_part):
        return True
    return mentions_env(command_part) and not (
        segment_is_read_only(command_part) or env_usage_is_read_only(command_part)
    )


def segments_blocked(segments: list[str]) -> bool:
    """Команда, в которой упомянут защищённый путь, нарушает защиту?

    Кроме сегментов, пишущих по защищённому пути сами, ловятся два случая, где
    путь «внесён» в пишущую команду без упоминания в её сегменте:

    - `cd` в защищённый каталог — дальше пишут относительным путём;
    - `xargs` с пишущей командой — пути приходят из стандартного ввода
      (`ls каталог | xargs rm`, `find … | xargs sed -i`). Откуда именно идёт
      ввод, не разбирается: в команде с защищённым путём `xargs` с пишущей
      командой блокируется всегда.
    """

    if any(segment_blocked(s) for s in segments):
        return True
    if any(first_word(s) == "cd" and mentions_protected_paths(local_part(s)) for s in segments):
        return True
    return any(
        runs_through_xargs(local_part(s))
        and not segment_is_read_only(strip_heredocs(local_part(s)))
        for s in segments
    )


# --- правило «main только через ветку и PR» --------------------------------


def current_branch(cwd: str | None = None) -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd or _project_dir(),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _git_parts(segment: str) -> tuple[str | None, list[str], str | None]:
    """Подкоманда git, слова после неё и каталог из `-C` (если задан).

    Глобальные параметры с значением (`-C <каталог>`, `-c k=v`, `--git-dir
    <путь>`) стоят до подкоманды и забирают следующее слово. Пока они не
    разбирались, подкомандой считался каталог или `k=v`: `git -C . commit` на
    main проходил мимо правила, а `git -C dir log` выглядел пишущим.
    """

    tokens = command_tokens(segment)
    if not tokens or tokens[0].rsplit("/", maxsplit=1)[-1] != "git":
        return None, [], None
    directory: str | None = None
    index = 1
    while index < len(tokens):
        token = tokens[index]
        if token in GIT_OPTIONS_WITH_VALUE:
            if token == "-C" and index + 1 < len(tokens):
                # Несколько `-C` складываются, как у самого git.
                step = tokens[index + 1]
                directory = os.path.join(directory, step) if directory else step
            index += 2
            continue
        if token.startswith("-"):
            index += 1
            continue
        return token, tokens[index + 1 :], directory
    return None, [], directory


def _git_verb(segment: str) -> str | None:
    return _git_parts(segment)[0]


_NEW_BRANCH_FLAGS = {"-b", "-B", "-c", "-C"}


def _is_local_branch(name: str, cwd: str) -> bool:
    """Существующая локальная ветка?

    Нужно, чтобы отличить `git checkout feat/x` (переход) от `git checkout
    файл` (восстановление файла): git различает их так же — сначала ищет ветку.
    """

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", f"refs/heads/{name}"],
            cwd=cwd,
            capture_output=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return result.returncode == 0


def _switch_target(segment: str, cwd: str) -> str | None:
    """На какую ветку переводит сегмент; None — переключения нет.

    Возвращает имя ветки и при уходе С главной, и при переходе НА неё. Раньше
    распознавался только переход на main, и `git switch feat/x && git rebase
    origin/main` блокировался: правило считало, что мы всё ещё на main, хотя
    первая же команда с неё уходит.
    """

    verb, rest, _ = _git_parts(segment)
    if verb not in {"switch", "checkout"}:
        return None

    if "--" in rest:
        # `git checkout -- main.py` — это восстановление файла.
        return None

    flags = {t for t in rest if t.startswith("-")}
    args = [t for t in rest if not t.startswith("-")]
    if not args:
        return None

    if flags & _NEW_BRANCH_FLAGS:
        return args[0]
    # Без флага создания аргумент может быть и веткой, и файлом. Ветка ли это,
    # знает git — гадать здесь нельзя: ошибка в любую сторону либо открывает
    # дыру, либо мешает работе.
    return args[0] if _is_local_branch(args[0], cwd) else None


def _pushes_main(segment: str, on_main: bool) -> bool:
    verb, rest, _ = _git_parts(segment)
    if verb != "push":
        return False
    args = [t for t in rest if not t.startswith("-")]
    if any(a == "main" or a.endswith(":main") for a in args):
        return True
    # Голый `git push` из main отправляет main.
    return on_main and not args


MAIN_BLOCK_MESSAGE = """BLOCKED: работа с main идёт только через ветку и pull request.

Почему: коммит прямо в main проходит мимо ревью и мимо зелёного CI, а с
автодеплоем (.github/workflows/deploy.yml) сразу уезжает на боевой стенд.

Что делать:
  git switch -c feat/<кратко>     # или fix/<кратко>
  git add … && git commit -m "…"
  git push -u origin feat/<кратко>
  gh pr create --fill             # merge — после зелёного CI

Если ветка уже создана, просто переключитесь на неё: git switch <ветка>."""


def _target_dir(command: str, cwd: str | None) -> str:
    """Каталог, в котором команда на самом деле выполнится.

    `cd /tmp/чужой-репозиторий && git commit` выполняется НЕ в проекте, а
    правило про main читало ветку всегда в каталоге проекта. Из-за этого любой
    коммит в одноразовом репозитории под scratchpad блокировался за то, что в
    KetoCare сейчас выбрана main.
    """

    base = cwd or _project_dir()
    for segment in split_segments(command):
        if first_word(segment) != "cd":
            continue
        args = [t for t in _tokens(segment)[1:] if not t.startswith("-")]
        if args:
            base = os.path.abspath(os.path.join(base, os.path.expanduser(args[0])))
    return base


def _inside_project(path: str) -> bool:
    project = os.path.realpath(_project_dir())
    try:
        return os.path.commonpath([os.path.realpath(path), project]) == project
    except ValueError:
        # Разные тома — общего пути нет, значит каталог точно чужой.
        return False


def main_rule_violation(command: str, cwd: str | None = None) -> bool:
    """Команда создаёт коммит в main этого проекта или отправляет его напрямую?"""

    segments = split_segments(command)
    if not any(first_word(s) == "git" for s in segments):
        return False

    target = _target_dir(command, cwd)
    # Правило защищает main ЭТОГО проекта. Чужой репозиторий — не наша ветка и
    # не наш деплой; блокировать там коммиты значит мешать работе, ничего не
    # защищая.
    target_in_project = _inside_project(target)

    # Ветка отслеживается ПО ХОДУ команды: `git switch feat/x && git commit`
    # коммитит уже не в main, а `git switch main && git commit` — в main.
    on_main = target_in_project and current_branch(target) == "main"

    for segment in segments:
        verb, _, directory = _git_parts(segment)
        if verb is None:
            continue

        # `git -C <каталог>` работает в другом каталоге — ветку читаем там.
        where = target
        if directory is not None:
            where = os.path.abspath(os.path.join(target, os.path.expanduser(directory)))
        if not _inside_project(where):
            continue
        same_place = os.path.realpath(where) == os.path.realpath(target)
        segment_on_main = on_main if same_place else current_branch(where) == "main"

        moved = _switch_target(segment, where)
        if moved is not None:
            if same_place:
                on_main = moved == "main"
            continue

        if verb in GIT_COMMIT_VERBS and segment_on_main:
            return True
        if _pushes_main(segment, segment_on_main):
            return True
    return False


BLOCK_MESSAGE = """BLOCKED: команда затрагивает защищённый путь и не распознана как read-only.

Защищено:
  docs/medical/*            — спецификации и эталоны меняет медицинская команда (ТЗ §0.1, правило 1)
  docs/knowledge-base/clinical/* — клинические статьи помощника подписывает медкоманда (10.4)
  */migrations/versions/*   — миграция, ПОПАВШАЯ В MAIN, не правится (ТЗ §0.3, правило 3);
                              ревизия ветки, ещё не слитая в main, — правится свободно
                              (сверка с origin/main: перед правкой — git fetch)
  .env                      — секреты редактирует человек (ТЗ §0.7); чтение (--env-file) разрешено
  .claude/settings.json     — выключает все хуки разом

Разрешено без ограничений:
  docs/medical/OPEN_QUESTIONS.md — вопросы и допущения пиши сюда
  .env.example                   — новые переменные объявляй здесь

Проверка идёт по принципу «запрещено, пока не доказано чтение»: python3/node/perl и
подобное считаются пишущими, даже если в конкретном случае только читают.

Что делать:
  • читаешь — используй cat/grep/ls/head (они разрешены);
  • нужна новая миграция — cd packages/core && uv run alembic revision --autogenerate -m "..."
  • правка действительно нужна — попроси пользователя выполнить её самому."""


FILE_BLOCK_TEMPLATE = """BLOCKED: {reason}

Разрешено без ограничений:
  docs/medical/OPEN_QUESTIONS.md — вопросы и допущения медицинской команде
  .env.example                   — объявление новых переменных окружения"""


def file_block_reason(file_path: str) -> str | None:
    """Причина блокировки правки файла, либо None."""
    root = _project_dir()
    rel = file_path
    if rel.startswith(root + os.sep):
        rel = rel[len(root) + 1 :]
    # removeprefix, а не lstrip: lstrip("./") срезает ВСЕ ведущие точки и слэши,
    # превращая ".env" в "env" и ".claude/hooks/x" в "claude/hooks/x" — защита
    # молча переставала срабатывать ровно на тех путях, ради которых написана.
    rel = rel.removeprefix("./")

    if rel in ALLOWED:
        return None

    if rel.startswith("docs/medical/"):
        return (
            f"{rel} — медицинские спецификации и эталоны меняет только медицинская команда "
            "(ТЗ §0.1, правило 1 CLAUDE.md). Вопросы и допущения пиши в "
            "docs/medical/OPEN_QUESTIONS.md; новые provisional-эталоны согласуй с человеком."
        )

    if rel.startswith("docs/knowledge-base/clinical/"):
        return (
            f"{rel} — клиническую статью помощника подписывает медицинская команда "
            "(раздел 10.4 ТЗ, правило 1 CLAUDE.md): её текст семья читает как ответ "
            "приложения. Статьи про работу приложения пиши в "
            "docs/knowledge-base/product/."
        )

    if re.search(r"(^|/)(migrations|alembic)/versions/.*\.py$", rel):
        # Ревизия ветки, ещё не попавшая в main, правится легитимно.
        if _migration_is_frozen(rel):
            return (
                f"{rel} — миграция уже в main и не правится (ТЗ §0.3, правило 3 CLAUDE.md). "
                'Создай новую ревизию: cd packages/core && uv run alembic revision --autogenerate -m "..."'
            )
        return None

    if rel == ".env" or rel.startswith(".env."):
        return f"{rel} — файлы с секретами редактирует человек (ТЗ §0.7). Меняй .env.example."

    if rel == ".claude/settings.json":
        return (
            f"{rel} — этот файл выключает все хуки разом, и его правка не роняет ни одного "
            "теста. Код самих хуков править можно: изменение видно в PR, а "
            ".claude/hooks/tests/test_guard.py падает, если запрет исчез."
        )

    return None


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "command"

    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0

    if mode == "file":
        file_path = payload.get("tool_input", {}).get("file_path", "")
        if not file_path:
            return 0
        reason = file_block_reason(file_path)
        if reason:
            print(FILE_BLOCK_TEMPLATE.format(reason=reason), file=sys.stderr)
            return 2
        return 0

    command = payload.get("tool_input", {}).get("command", "")
    if not command:
        return 0

    if main_rule_violation(command, payload.get("cwd")):
        print(MAIN_BLOCK_MESSAGE, file=sys.stderr)
        return 2

    if not mentions_protected(command):
        return 0

    if segments_blocked(split_segments(command)):
        print(BLOCK_MESSAGE, file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
