"""`POST /calc/energy-requirement` (question 56, Yonsei table)."""

from __future__ import annotations

import pytest

from core.models.enums import UserRole


class TestEnergyRequirement:
    """Reader: the prescription form hint in the web cabinet (question 56)."""

    async def test_range_by_age_and_weight(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        response = await client.post(
            "/api/v1/calc/energy-requirement",
            json={"age_years": 5, "weight_kg": 18},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["kcal_min"] == pytest.approx(1170)
        assert body["kcal_max"] == pytest.approx(1224)
        assert body["kcal_per_kg_min"] == pytest.approx(65)
        assert set(body) == {
            "kcal_min",
            "kcal_max",
            "kcal_per_kg_min",
            "kcal_per_kg_max",
            "engine_version",
        }

    async def test_zero_weight_is_a_validation_error(self, client, make_user, auth_headers):
        doctor = await make_user(UserRole.DOCTOR)
        response = await client.post(
            "/api/v1/calc/energy-requirement",
            json={"age_years": 5, "weight_kg": 0},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 422

    async def test_needs_a_session(self, client):
        response = await client.post(
            "/api/v1/calc/energy-requirement", json={"age_years": 5, "weight_kg": 18}
        )
        assert response.status_code == 401
