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
    # Закоммиченные Alembic-миграции не правятся (ТЗ §0.3)
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
# править ЗАКОММИЧЕННУЮ миграцию, а свежесозданная ревизия — обычный рабочий
# файл, который приходится и править, и удалять, и добавлять в индекс.
MIGRATION_FILE_RE = re.compile(r"[\w./-]*(?:migrations|alembic)/versions/[\w.-]+\.py")

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
    "env",
}

# git — только читающие подкоманды
GIT_READ_ONLY = {"log", "diff", "show", "status", "ls-files", "blame", "cat-file", "rev-parse"}

# Подкоманды git, создающие коммит в текущей ветке. На main запрещены целиком.
GIT_COMMIT_VERBS = {"commit", "merge", "rebase", "cherry-pick", "revert", "am"}

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


def _tracked_by_git(path: str) -> bool:
    """Файл под контролем версий? Незакоммиченный — не защищён."""

    try:
        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", path],
            cwd=_project_dir(),
            capture_output=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        # Git недоступен — считаем защищённым: лучше лишний вопрос человеку,
        # чем правка закоммиченной миграции по недосмотру.
        return True
    return result.returncode == 0


def _tracked_migration_names() -> frozenset[str]:
    """Имена файлов закоммиченных миграций — без каталогов.

    Сверять полный путь нельзя: `cd packages/core && rm migrations/versions/x.py`
    даёт путь, которого нет в индексе от корня репозитория, и проверка сочла бы
    закоммиченную миграцию новой. Имя ревизии несёт хеш и уникально, поэтому
    сравнение по имени и строже, и честнее.
    """

    try:
        result = subprocess.run(
            ["git", "ls-files", "--", "*/versions/*.py"],
            cwd=_project_dir(),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return frozenset()
    if result.returncode != 0:
        return frozenset()
    return frozenset(line.rsplit("/", 1)[-1] for line in result.stdout.split() if line)


def _mask_allowed(text: str) -> str:
    masked = text
    for allowed in ALLOWED:
        masked = masked.replace(allowed, "@ALLOWED@")
    # Свежая, ещё не добавленная в индекс ревизия — обычный файл. Скрываем её
    # от проверки, чтобы `rm`/`git add` по ней работали: правило ТЗ говорит
    # именно о закоммиченной миграции.
    candidates = MIGRATION_FILE_RE.findall(masked)
    if candidates:
        tracked = _tracked_migration_names()
        for candidate in candidates:
            if candidate.rsplit("/", 1)[-1] not in tracked:
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
    """

    segments: list[str] = []
    current: list[str] = []
    quote: str | None = None
    pending: list[str] = []
    index = 0
    while index < len(command):
        char = command[index]
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


def first_word(segment: str) -> str:
    """Имя команды сегмента без присваиваний окружения и обёрток."""
    skip_prefix = {"sudo", "command", "nohup", "time", "xargs", "nice"}
    for token in _tokens(segment):
        if "=" in token and not token.startswith("-") and "/" not in token.split("=")[0]:
            continue  # FOO=bar
        if token in skip_prefix:
            continue
        return token.rsplit("/", maxsplit=1)[-1]
    return ""


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
        subcommands = [t for t in _tokens(segment)[1:] if not t.startswith("-")]
        return bool(subcommands) and subcommands[0] in GIT_READ_ONLY

    # cd в защищённый каталог открывает запись относительными путями дальше
    if name == "cd":
        return not mentions_protected(segment)

    return name in READ_ONLY


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
        if body.strip() and any(segment_blocked(s) for s in split_segments(body)):
            return True

    command_part = strip_heredocs(segment)

    if mentions_protected_paths(command_part) and not segment_is_read_only(command_part):
        return True
    return mentions_env(command_part) and not (
        segment_is_read_only(command_part) or env_usage_is_read_only(command_part)
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


def _git_verb(segment: str) -> str | None:
    if first_word(segment) != "git":
        return None
    for token in _tokens(segment)[1:]:
        if token.startswith("-"):
            continue
        return token
    return None


def _switches_to_main(segment: str) -> bool:
    verb = _git_verb(segment)
    if verb not in {"switch", "checkout"}:
        return False
    args = [t for t in _tokens(segment)[2:] if not t.startswith("-")]
    # `git checkout -b main` — тоже переход на main; `git checkout -- main.py` нет.
    return "main" in args and "--" not in _tokens(segment)


def _pushes_main(segment: str, on_main: bool) -> bool:
    if _git_verb(segment) != "push":
        return False
    args = [t for t in _tokens(segment)[2:] if not t.startswith("-")]
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
    if not _inside_project(target):
        return False

    branch = current_branch(target)
    on_main = branch == "main"
    goes_to_main = on_main or any(_switches_to_main(s) for s in segments)

    for segment in segments:
        verb = _git_verb(segment)
        if verb is None:
            continue
        if verb in GIT_COMMIT_VERBS and goes_to_main:
            return True
        if _pushes_main(segment, on_main):
            return True
    return False


BLOCK_MESSAGE = """BLOCKED: команда затрагивает защищённый путь и не распознана как read-only.

Защищено:
  docs/medical/*            — спецификации и эталоны меняет медицинская команда (ТЗ §0.1, правило 1)
  */migrations/versions/*   — ЗАКОММИЧЕННАЯ миграция не правится (ТЗ §0.3, правило 3);
                              свежая, ещё не добавленная в индекс, — правится свободно
  .env                      — секреты редактирует человек (правило 7); чтение (--env-file) разрешено
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

    if re.search(r"(^|/)(migrations|alembic)/versions/.*\.py$", rel):
        # Свежесозданная ревизия ещё не в индексе — её правка легитимна.
        if _tracked_by_git(rel):
            return (
                f"{rel} — закоммиченная миграция не правится (ТЗ §0.3, правило 3 CLAUDE.md). "
                'Создай новую ревизию: cd packages/core && uv run alembic revision --autogenerate -m "..."'
            )
        return None

    if rel == ".env" or rel.startswith(".env."):
        return f"{rel} — файлы с секретами редактирует человек (правило 7). Меняй .env.example."

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

    segments = split_segments(command)
    for segment in segments:
        if segment_blocked(segment):
            print(BLOCK_MESSAGE, file=sys.stderr)
            return 2

    # Путь упомянут, но каждый сегмент, где он встречается, только читает.
    # Отдельно ловим случай, когда защищённый путь «внесён» через cd, а пишет
    # следующий сегмент уже относительным путём.
    if any(first_word(s) == "cd" and mentions_protected_paths(local_part(s)) for s in segments):
        print(BLOCK_MESSAGE, file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
