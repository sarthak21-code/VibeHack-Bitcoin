import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from planner import load_wallet, plan_candidates


EXTERNAL_ADDR = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
DB_PATH = BACKEND_DIR / "bitcoin" / "coinlens_wallet.sqlite3"


def get_candidate(result, candidate_id):
    """Return a candidate by its current planner ID."""
    return next(
        candidate
        for candidate in result["candidates"]
        if candidate["candidate_id"] == candidate_id
    )


class TestWhatIfEngine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DB_PATH.exists():
            raise unittest.SkipTest("Signet wallet not initialized.")

        try:
            cls.wallet, _ = load_wallet()
        except Exception as exc:
            raise unittest.SkipTest(f"Wallet could not be loaded: {exc}")

    def test_fee_rate_increase(self):
        """Fee-rate changes affect candidate construction and fee totals."""
        res_1 = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
        )
        res_2 = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=2,
        )
        res_10 = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=10,
        )

        candidate_a_1 = get_candidate(res_1, "A")
        candidate_a_2 = get_candidate(res_2, "A")
        candidate_a_10 = get_candidate(res_10, "A")

        self.assertTrue(candidate_a_1["valid"])
        self.assertTrue(candidate_a_2["valid"])

        fee_1 = candidate_a_1["transaction"]["fee_sats"]
        fee_2 = candidate_a_2["transaction"]["fee_sats"]

        self.assertGreater(fee_2, fee_1)

        # At 10 sat/vB, the two-UTXO pair cannot cover payment + fee.
        self.assertFalse(candidate_a_10["valid"])
        self.assertTrue(candidate_a_10["error"])

        # Largest First still has the large reserve UTXO available.
        candidate_b_1 = get_candidate(res_1, "B")
        candidate_b_10 = get_candidate(res_10, "B")

        self.assertTrue(candidate_b_10["valid"])

        fee_b_1 = candidate_b_1["transaction"]["fee_sats"]
        fee_b_10 = candidate_b_10["transaction"]["fee_sats"]

        self.assertGreater(fee_b_10, fee_b_1)

    def test_amount_increase(self):
        """Payment amount is reflected correctly in generated candidates."""
        res_small = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=2000,
            fee_rate_sat_vb=1,
        )
        res_large = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=4000,
            fee_rate_sat_vb=1,
        )

        candidate_small = get_candidate(res_small, "A")
        candidate_large = get_candidate(res_large, "A")

        self.assertTrue(candidate_small["valid"])
        self.assertTrue(candidate_large["valid"])

        self.assertEqual(
            candidate_small["transaction"]["payment_sats"],
            2000,
        )

        self.assertEqual(
            candidate_large["transaction"]["payment_sats"],
            4000,
        )

    def test_reserve_exclusion(self):
        """Excluding reserve UTXO prevents Candidate B from consuming it."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
            exclude_utxo_ids=["reserve"],
        )

        candidate_b = get_candidate(res, "B")

        if candidate_b["valid"]:
            self.assertFalse(
                candidate_b["future_optionality"]["rare_utxo_consumed"]
            )
            self.assertNotEqual(
                candidate_b["transaction"]["inputs_total_sats"],
                142653,
            )

    def test_single_input_constraint(self):
        """Max inputs = 1 prevents multi-input candidates."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
            max_inputs=1,
        )

        for candidate_id in ("A", "B", "C", "D"):
            candidate = get_candidate(res, candidate_id)

            if candidate["valid"]:
                self.assertLessEqual(
                    candidate["transaction"]["input_count"],
                    1,
                )

    def test_insufficient_funds_invalid_scenario(self):
        """Excessive payment amount produces no valid candidates."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=999_999_999,
            fee_rate_sat_vb=1,
        )

        for candidate in res["candidates"]:
            self.assertFalse(candidate["valid"])

        self.assertEqual(res["psbts"], {})


if __name__ == "__main__":
    unittest.main()