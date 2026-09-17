"""Проверка восстановления работает на ЗАШИФРОВАННОЙ копии (раздел 11 ТЗ).

Единственное, что отличает бэкап от файла на диске, — доказанное
восстановление. Доказывает его `verify-backup.sh`, и до 17.09.2026 он падал
ровно на том виде копий, который у нас теперь единственный: перед разворачиванием
вызывался `cleanup`, а тот удалял только что расшифрованный дамп. Проверка
сообщала «в восстановленной базе 0 таблиц», то есть обвиняла копию в том, что
сама же и сделала.

Открытый дамп дефекта не замечал — `rm -f ""` ничего не делает, — поэтому
прогон 31.08.2026 на незашифрованной копии прошёл и создал ложную уверенность.

Проверяется прогоном с подделками `docker` и `age`: настоящих контейнера и
ключа тесту не нужно, а вот то, что до `pg_restore` доехали байты дампа, —
нужно, и это единственный способ отличить работающий скрипт от сломанного.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

_VERIFY = Path(__file__).resolve().parents[1] / "scripts" / "verify-backup.sh"

#: Подделка docker: отвечает на запросы скрипта правдоподобными числами и
#: записывает, сколько байт получил `pg_restore` на вход.
_DOCKER_STUB = """#!/usr/bin/env bash
args="$*"
case "$args" in
    *pg_restore*)
        wc -c > "$RESTORE_BYTES"
        exit 0
        ;;
    *information_schema.tables*) echo 43 ;;
    *alembic_version*)           echo 600d231323d6 ;;
    *"FROM patients"*)           echo 2 ;;
    *"FROM users"*)              echo 7 ;;
    *)                           : ;;
esac
exit 0
"""

#: Подделка age: «расшифровывает» копированием. Разбирает ровно те флаги,
#: которыми её зовёт скрипт: `age -d -i <ключ> -o <куда> <откуда>`.
_AGE_STUB = """#!/usr/bin/env bash
out=""; src=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -i) shift 2 ;;
        -d) shift ;;
        *)  src="$1"; shift ;;
    esac
done
cp "$src" "$out"
"""


def _stub(directory: Path, name: str, body: str) -> None:
    path = directory / name
    path.write_text(body)
    path.chmod(0o755)


@pytest.fixture
def sandbox(tmp_path: Path) -> dict[str, Path]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    _stub(fake_bin, "docker", _DOCKER_STUB)
    _stub(fake_bin, "age", _AGE_STUB)

    # Содержимое неважно, важен размер: он и доказывает, что до pg_restore
    # доехал именно дамп, а не пустота.
    dump = tmp_path / "postgres-2026-09-17.dump.age"
    dump.write_bytes(b"PGDMP" + b"x" * 4096)
    identity = tmp_path / "key.txt"
    identity.write_text("AGE-SECRET-KEY-НЕНАСТОЯЩИЙ\n")

    return {"bin": fake_bin, "dump": dump, "identity": identity, "bytes": tmp_path / "bytes.txt"}


def _run(sandbox: dict[str, Path]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(_VERIFY), str(sandbox["dump"]), "ketocare-test-postgres"],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "PATH": f"{sandbox['bin']}:{os.environ['PATH']}",
            "BACKUP_AGE_IDENTITY": str(sandbox["identity"]),
            "RESTORE_BYTES": str(sandbox["bytes"]),
        },
    )


class TestEncryptedBackupIsVerifiable:
    def test_decrypted_dump_survives_until_restore(self, sandbox: dict[str, Path]) -> None:
        """Байты дампа обязаны доехать до pg_restore.

        Это и есть проверяемое поведение: расшифровали — развернули. Проверять
        код возврата мало, он был бы нулевым и у скрипта, развернувшего пустоту.
        """

        result = _run(sandbox)

        assert result.returncode == 0, result.stdout + result.stderr
        assert sandbox["bytes"].exists(), "pg_restore не был вызван вовсе"
        delivered = int(sandbox["bytes"].read_text().strip())
        assert delivered == sandbox["dump"].stat().st_size, (
            "до pg_restore доехало не то, что расшифровали: "
            f"{delivered} байт вместо {sandbox['dump'].stat().st_size}"
        )

    def test_reports_success(self, sandbox: dict[str, Path]) -> None:
        result = _run(sandbox)

        assert "Восстановление проверено" in result.stdout
        # Числа берутся из восстановленной базы, а не выдумываются скриптом.
        assert "43" in result.stdout
        assert "600d231323d6" in result.stdout

    def test_decrypted_copy_does_not_outlive_the_run(self, sandbox: dict[str, Path]) -> None:
        """Расшифрованная копия живёт секунды, но эти секунды она содержит всё.

        Обратная сторона починки: убирать временный файл всё равно обязательно —
        просто не до того, как его развернули.
        """

        result = _run(sandbox)

        assert result.returncode == 0
        temporary = [p for p in Path("/tmp").glob("tmp.*") if p.is_file()]
        for path in temporary:
            assert path.read_bytes()[:5] != b"PGDMP", f"дамп остался в {path}"
