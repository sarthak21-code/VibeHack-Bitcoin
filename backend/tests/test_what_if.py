import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import bdkpython as bdk
from planner import load_wallet, plan_candidates

EXTERNAL_ADDR = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
DB_PATH = BACKEND_DIR / "bitcoin" / "coinlens_wallet.sqlite3"


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
        """Simulate fee rate increase: Candidate A remains valid at 2 sat/vB, invalid at 10 sat/vB."""
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

        self.assertTrue(res_1["candidate_a"]["valid"])
        self.assertTrue(res_2["candidate_a"]["valid"])
        fee_1 = res_1["candidate_a"]["transaction"]["fee_sats"]
        fee_2 = res_2["candidate_a"]["transaction"]["fee_sats"]
        self.assertGreater(fee_2, fee_1)

        # At 10 sat/vB, Candidate A cannot cover payment + fee
        self.assertFalse(res_10["candidate_a"]["valid"])
        self.assertIn("Insufficient funds", res_10["candidate_a"]["error"])

        # But Candidate B has large UTXO and remains valid at 10 sat/vB
        self.assertTrue(res_10["candidate_b"]["valid"])
        fee_b_1 = res_1["candidate_b"]["transaction"]["fee_sats"]
        fee_b_10 = res_10["candidate_b"]["transaction"]["fee_sats"]
        self.assertGreater(fee_b_10, fee_b_1)

    def test_amount_increase(self):
        """Simulate payment amount increase."""
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

        self.assertTrue(res_small["candidate_a"]["valid"])
        self.assertTrue(res_large["candidate_a"]["valid"])
        self.assertEqual(
            res_small["candidate_a"]["transaction"]["payment_sats"],
            2000,
        )
        self.assertEqual(
            res_large["candidate_a"]["transaction"]["payment_sats"],
            4000,
        )

    def test_reserve_exclusion(self):
        """Excluding reserve UTXO ensures Candidate B does not consume it."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
            exclude_utxo_ids=["reserve"],
        )

        # In demo setup, reserve coin is 142,653 sats
        if res["candidate_b"]["valid"]:
            self.assertFalse(
                res["candidate_b"]["future_optionality"]["rare_utxo_consumed"]
            )
            self.assertNotEqual(
                res["candidate_b"]["transaction"]["inputs_total_sats"],
                142653,
            )

    def test_single_input_constraint(self):
        """Max inputs constraint = 1 forces single input."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
            max_inputs=1,
        )

        if res["candidate_a"]["valid"]:
            self.assertEqual(
                res["candidate_a"]["transaction"]["input_count"],
                1,
            )
        if res["candidate_b"]["valid"]:
            self.assertEqual(
                res["candidate_b"]["transaction"]["input_count"],
                1,
            )

    def test_insufficient_funds_invalid_scenario(self):
        """Excessive payment amount should result in invalid candidates with clear reason."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=999_999_999,
            fee_rate_sat_vb=1,
        )

        self.assertFalse(res["candidate_a"]["valid"])
        self.assertTrue(
            "No suitable two-UTXO pair" in res["candidate_a"]["error"]
            or "Insufficient funds" in res["candidate_a"]["error"]
        )
        self.assertFalse(res["candidate_b"]["valid"])
        self.assertIn("Insufficient funds", res["candidate_b"]["error"])


if __name__ == "__main__":
    unittest.main()
