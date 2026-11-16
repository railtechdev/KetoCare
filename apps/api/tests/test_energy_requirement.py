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
        # Protein follows weight, 1 g per kg from two years (clinic's answer of
        # 2026-11-11, kept on 2026-11-16).
        assert body["protein_g"] == pytest.approx(18)
        assert body["protein_g_per_kg"] == pytest.approx(1.0)
        # Fluid by Holliday-Segar: 1000 mL for 10 kg + 50 mL x 8 kg (ADR-0069).
        assert body["fluid_ml"] == pytest.approx(1400)
        assert set(body) == {
            "kcal_min",
            "kcal_max",
            "kcal_per_kg_min",
            "kcal_per_kg_max",
            "protein_g",
            "protein_g_per_kg",
            "fluid_ml",
            "engine_version",
        }

    @pytest.mark.parametrize(
        ("age", "weight", "per_kg", "protein"),
        [(0, 5.0, 1.5, 7.5), (1, 10.0, 1.2, 12.0), (2, 12.0, 1.0, 12.0)],
    )
    async def test_protein_by_age_under_two(
        self, client, make_user, auth_headers, age, weight, per_kg, protein
    ):
        """Question 59, agreed on 2026-11-16: more protein under two years."""
        doctor = await make_user(UserRole.DIETITIAN)
        response = await client.post(
            "/api/v1/calc/energy-requirement",
            json={"age_years": age, "weight_kg": weight},
            headers=auth_headers(doctor),
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["protein_g_per_kg"] == pytest.approx(per_kg)
        assert body["protein_g"] == pytest.approx(protein)

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
