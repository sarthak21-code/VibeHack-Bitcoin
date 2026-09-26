import sys
import unittest
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import bdkpython as bdk
from fastapi.testclient import TestClient
from api import app
from planner import load_wallet, plan_candidates


EXTERNAL_ADDR = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
DB_PATH = BACKEND_DIR / "bitcoin" / "coinlens_wallet.sqlite3"


class TestFinalizeAndBroadcast(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not DB_PATH.exists():
            raise unittest.SkipTest("Signet wallet not initialized.")

        try:
            cls.wallet, _ = load_wallet()
        except Exception as exc:
            raise unittest.SkipTest(f"Wallet could not be loaded: {exc}")

        cls.client = TestClient(app)

    def test_unsigned_psbt_cannot_finalize(self):
        """Unsigned PSBT must not be marked finalized or succeed in finalization."""
        res = plan_candidates(
            destination=EXTERNAL_ADDR,
            amount_sats=3500,
            fee_rate_sat_vb=1,
        )

        candidate_a = next(
            candidate
            for candidate in res["candidates"]
            if candidate["candidate_id"] == "A"
        )

        self.assertTrue(candidate_a["valid"])

        unsigned_psbt_b64 = res["psbts"]["A"]

        response = self.client.post(
            "/finalize",
            json={"psbt": unsigned_psbt_b64},
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertFalse(data["success"])
        self.assertFalse(data["finalized"])
        self.assertIn("could not be finalized", data["error"])

    def test_invalid_psbt_rejected(self):
        """Malformed PSBT string must return 400."""
        response = self.client.post(
            "/finalize",
            json={"psbt": "not-a-valid-psbt-base64"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Invalid PSBT", response.json()["detail"])

    def test_broadcast_rejects_empty_and_short_hex(self):
        """Broadcast must reject empty or trivially short transaction hex."""
        response = self.client.post(
            "/broadcast",
            json={"raw_transaction_hex": "1234"},
        )

        self.assertEqual(
            response.status_code,
            422,
        )

    def test_broadcast_rejects_malformed_hex(self):
        """Broadcast must reject non-hex or non-transaction bytes."""
        response = self.client.post(
            "/broadcast",
            json={
                "raw_transaction_hex": (
                    "00112233445566778899aabbccddeeff"
                )
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn(
            "Invalid transaction hex",
            response.json()["detail"],
        )

    def test_network_guard_signet(self):
        """Wallet network must be SIGNET."""
        self.assertEqual(
            self.wallet.network(),
            bdk.Network.SIGNET,
        )


if __name__ == "__main__":
    unittest.main()