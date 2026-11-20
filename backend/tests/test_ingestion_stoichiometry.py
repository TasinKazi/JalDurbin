import pytest
import io
try:
    import pandas as pd
except ImportError:
    pd = None
from app.services.ingestion import WaterPointIngestionService


class TestIngestionStoichiometry:
    """
    Tests stoichiometric sodium derivations and maternal safety classification:
    - Direct Na+ > 300 mg/L sets is_maternal_safe = False
    - Chloride fallback: Na+ = 0.55 * Cl-
    - TDS fallback: Na+ = 0.31 * TDS
    - Precedence: Direct Na+ > Cl- fallback > TDS fallback
    """

    def test_direct_sodium_threshold(self):
        # Above 300 mg/L -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=350.0
        )
        assert na_eff == 350.0
        assert is_safe is False

        # Exactly 300 mg/L -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=300.0
        )
        assert na_eff == 300.0
        assert is_safe is True

        # Just above 300 mg/L (300.1 mg/L) -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=300.1
        )
        assert na_eff == 300.1
        assert is_safe is False

        # Well below 300 mg/L -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=150.0
        )
        assert na_eff == 150.0
        assert is_safe is True

    def test_chloride_derived_sodium_threshold(self):
        # 0.55 * Cl: 600 mg/L Cl -> 330 mg/L Na (> 300) -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=600.0
        )
        assert na_eff == pytest.approx(330.0, rel=1e-3)
        assert is_safe is False

        # 400 mg/L Cl -> 220 mg/L Na (<= 300) -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=400.0
        )
        assert na_eff == pytest.approx(220.0, rel=1e-3)
        assert is_safe is True

        # 550 mg/L Cl -> 302.5 mg/L Na (> 300) -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=550.0
        )
        assert na_eff == pytest.approx(302.5, rel=1e-3)
        assert is_safe is False

        # 545 mg/L Cl -> 299.75 mg/L Na (<= 300) -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=545.0
        )
        assert na_eff == pytest.approx(299.75, rel=1e-3)
        assert is_safe is True

    def test_tds_derived_sodium_threshold(self):
        # 0.31 * TDS: 1200 mg/L TDS -> 372 mg/L Na (> 300) -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=None,
            tds_mg_l=1200.0
        )
        assert na_eff == pytest.approx(372.0, rel=1e-3)
        assert is_safe is False

        # 800 mg/L TDS -> 248 mg/L Na (<= 300) -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=None,
            tds_mg_l=800.0
        )
        assert na_eff == pytest.approx(248.0, rel=1e-3)
        assert is_safe is True

        # 1000 mg/L TDS -> 310 mg/L Na (> 300) -> Unsafe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=None,
            tds_mg_l=1000.0
        )
        assert na_eff == pytest.approx(310.0, rel=1e-3)
        assert is_safe is False

        # 950 mg/L TDS -> 294.5 mg/L Na (<= 300) -> Safe
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=None,
            tds_mg_l=950.0
        )
        assert na_eff == pytest.approx(294.5, rel=1e-3)
        assert is_safe is True

    def test_hierarchy_precedence(self):
        # Direct Na takes precedence over high Cl
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=180.0,
            chloride_mg_l=1500.0,  # would yield 825 mg/L Na if used
            tds_mg_l=3000.0
        )
        assert na_eff == 180.0
        assert is_safe is True

        # Chloride takes precedence over TDS when direct Na is missing
        na_eff, is_safe = WaterPointIngestionService.compute_stoichiometric_sodium(
            sodium_mg_l=None,
            chloride_mg_l=300.0,   # yields 165 mg/L Na -> Safe
            tds_mg_l=2000.0        # would yield 620 mg/L Na -> Unsafe
        )
        assert na_eff == pytest.approx(165.0, rel=1e-3)
        assert is_safe is True

    @pytest.mark.skipif(pd is None, reason="pandas not installed in this environment")
    def test_csv_ingestion_stoichiometry_parsing(self):
        csv_data = """external_code,latitude,longitude,source_type,sodium_mg_l,chloride_mg_l,tds_mg_l
WP-01,22.35,91.78,deep_tube_well,320,,
WP-02,22.36,91.79,psf,,600,
WP-03,22.37,91.80,rainwater_tank,,,800
WP-04,22.38,91.81,ro_plant,,,1200
"""
        df = WaterPointIngestionService.parse_csv(csv_data.encode("utf-8"))
        assert len(df) == 4

        # Compute safety flags
        results = [
            WaterPointIngestionService.compute_stoichiometric_sodium(
                row.get("sodium_mg_l"),
                row.get("chloride_mg_l"),
                row.get("tds_mg_l")
            )
            for _, row in df.iterrows()
        ]

        # WP-01: Direct Na=320 -> Unsafe
        assert results[0][1] is False
        # WP-02: Cl=600 -> Na=330 -> Unsafe
        assert results[1][1] is False
        # WP-03: TDS=800 -> Na=248 -> Safe
        assert results[2][1] is True
        # WP-04: TDS=1200 -> Na=372 -> Unsafe
        assert results[3][1] is False

    @pytest.mark.skipif(pd is None, reason="pandas not installed in this environment")
    def test_sample_csv_dataset(self):
        import os
        sample_path = os.path.join("..", "data", "raw", "water_points_sample.csv")
        if os.path.exists(sample_path):
            with open(sample_path, "rb") as f:
                df = WaterPointIngestionService.parse_csv(f.read())
            assert len(df) == 6
            # WP-CTG-001 has direct Na=180 -> Safe
            row1 = df[df["external_code"] == "WP-CTG-001"].iloc[0]
            assert bool(row1["is_maternal_safe"]) is True

            # WP-CTG-002 has Cl=620 -> Na=341 (>300) -> Unsafe
            row2 = df[df["external_code"] == "WP-CTG-002"].iloc[0]
            assert bool(row2["is_maternal_safe"]) is False

            # WP-CTG-004 has Na=340 (>300) -> Unsafe
            row4 = df[df["external_code"] == "WP-CTG-004"].iloc[0]
            assert bool(row4["is_maternal_safe"]) is False
