import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from reference_cases_path import REFERENCE_CASES_DIR  # noqa: E402


@pytest.fixture(scope="session")
def reference_cases_dir() -> Path:
    return REFERENCE_CASES_DIR
