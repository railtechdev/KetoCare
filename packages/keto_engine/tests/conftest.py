from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
REFERENCE_CASES_DIR = REPO_ROOT / "docs" / "medical" / "reference-cases"


@pytest.fixture(scope="session")
def reference_cases_dir() -> Path:
    return REFERENCE_CASES_DIR
