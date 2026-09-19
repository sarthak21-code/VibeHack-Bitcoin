import sys
import unittest
from pathlib import Path

import bdkpython as bdk

# Add backend directory to sys.path so sibling imports resolve.
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from bitcoin.candidate_psbt_test import (
    FEE_RATE_SAT_VB,
    TARGET_SATS,
    get_real_utxos,
    load_wallet,
)
from bitcoin.psbt_analyzer import analyze_psbt
from candidate_engine.selector import largest_first, two_utxo_pair
from privacy_engine import analyze_candidate, compare_candidates


DB_PATH = Path(__file__).resolve().parent / "vibehack_wallet.sqlite3"

EXTERNAL_RECIPIENT_ADDR = (
    "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
)


class TestPsbtAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # This is a Signet integration test.
        # A fresh clone does not contain the ignored wallet database.
        if not DB_PATH.exists():
            raise unittest.SkipTest(
                "Signet wallet not initialized. "
                "Run: python backend/setup_demo.py"
            )

        try:
            cls.wallet, cls.persister = load_wallet()
        except Exception as exc:
            raise unittest.SkipTest(
                "Signet wallet could not be loaded. "
                "Run: python backend/setup_demo.py"
            ) from exc

        cls.utxos = get_real_utxos(cls.wallet)

        if len(cls.utxos) < 2:
            raise unittest.SkipTest(
                "At least two Signet UTXOs are required for PSBT integration tests."
            )

        cls.external_recipient = bdk.Address(
            EXTERNAL_RECIPIENT_ADDR,
            bdk.Network.SIGNET,
        )

    def _build_test_psbt(self, selected_utxos, target_sats=TARGET_SATS):
        builder = bdk.TxBuilder()

        builder = builder.add_utxos(
            [u["outpoint"] for u in selected_utxos]
        )

        builder = builder.manually_selected_only()

        builder = builder.add_recipient(
            self.external_recipient.script_pubkey(),
            bdk.Amount.from_sat(target_sats),
        )

        builder = builder.fee_rate(
            bdk.FeeRate.from_sat_per_vb(FEE_RATE_SAT_VB)
        )

        return builder.finish(self.wallet)

    def test_one_input_candidate(self):
        """One-input candidate extraction has input_count = 1."""
        candidate_utxos = largest_first(self.utxos, TARGET_SATS)

        self.assertEqual(len(candidate_utxos), 1)

        psbt = self._build_test_psbt(candidate_utxos)

        facts = analyze_psbt(
            psbt,
            self.wallet,
            candidate_id="Candidate_1Input",
        )

        self.assertEqual(len(facts["inputs"]), 1)

        self.assertEqual(
            facts["inputs"][0]["amount_sats"],
            candidate_utxos[0]["amount_sats"],
        )

        self.assertIn(":", facts["inputs"][0]["outpoint"])

    def test_two_input_candidate(self):
        """Two-input candidate extraction has input_count = 2."""
        candidate_utxos = two_utxo_pair(
            self.utxos,
            TARGET_SATS,
        )

        self.assertEqual(len(candidate_utxos), 2)

        psbt = self._build_test_psbt(candidate_utxos)

        facts = analyze_psbt(
            psbt,
            self.wallet,
            candidate_id="Candidate_2Input",
        )

        self.assertEqual(len(facts["inputs"]), 2)

        total_extracted = sum(
            inp["amount_sats"]
            for inp in facts["inputs"]
        )

        expected_total = sum(
            u["amount_sats"]
            for u in candidate_utxos
        )

        self.assertEqual(
            total_extracted,
            expected_total,
        )

    def test_output_extraction(self):
        """Verify output amounts and addresses are correctly extracted."""
        candidate_utxos = two_utxo_pair(
            self.utxos,
            TARGET_SATS,
        )

        psbt = self._build_test_psbt(candidate_utxos)

        facts = analyze_psbt(
            psbt,
            self.wallet,
        )

        outputs = facts["outputs"]

        self.assertGreaterEqual(
            len(outputs),
            2,
        )

        recipient_outs = [
            o
            for o in outputs
            if o["amount_sats"] == TARGET_SATS
        ]

        self.assertEqual(
            len(recipient_outs),
            1,
        )

        self.assertEqual(
            recipient_outs[0]["address"],
            str(self.external_recipient),
        )

        for out in outputs:
            self.assertGreater(
                out["amount_sats"],
                0,
            )
            self.assertIsNotNone(
                out["address"],
            )

    def test_fee_calculation(self):
        """Fee equals total inputs minus total outputs."""
        candidate_utxos = two_utxo_pair(
            self.utxos,
            TARGET_SATS,
        )

        psbt = self._build_test_psbt(candidate_utxos)

        facts = analyze_psbt(
            psbt,
            self.wallet,
        )

        inputs_total = sum(
            inp["amount_sats"]
            for inp in facts["inputs"]
        )

        outputs_total = sum(
            out["amount_sats"]
            for out in facts["outputs"]
        )

        expected_fee = inputs_total - outputs_total

        self.assertIsNotNone(
            facts["fee_sats"],
        )

        self.assertEqual(
            facts["fee_sats"],
            expected_fee,
        )

        self.assertGreater(
            facts["fee_sats"],
            0,
        )

        self.assertEqual(
            facts["fee_sats"],
            psbt.fee(),
        )

    def test_wallet_controlled_output(self):
        """Verify wallet ownership detection."""
        candidate_utxos = two_utxo_pair(
            self.utxos,
            TARGET_SATS,
        )

        psbt = self._build_test_psbt(candidate_utxos)

        facts = analyze_psbt(
            psbt,
            self.wallet,
        )

        outputs = facts["outputs"]

        recipient_out = next(
            o
            for o in outputs
            if o["amount_sats"] == TARGET_SATS
        )

        self.assertFalse(
            recipient_out["is_wallet_controlled"],
        )

        change_out = next(
            o
            for o in outputs
            if o["amount_sats"] != TARGET_SATS
        )

        self.assertTrue(
            change_out["is_wallet_controlled"],
        )

    def test_candidate_a_and_b_privacy_engine_integration(self):
        """Analyze real Candidate A/B PSBTs through the privacy engine."""
        cand_a_utxos = two_utxo_pair(
            self.utxos,
            TARGET_SATS,
        )

        psbt_a = self._build_test_psbt(
            cand_a_utxos,
        )

        facts_a = analyze_psbt(
            psbt_a,
            self.wallet,
            candidate_id="A",
        )

        cand_b_utxos = largest_first(
            self.utxos,
            TARGET_SATS,
        )

        psbt_b = self._build_test_psbt(
            cand_b_utxos,
        )

        facts_b = analyze_psbt(
            psbt_b,
            self.wallet,
            candidate_id="B",
        )

        utxo_metadata = {
            facts_a["inputs"][0]["outpoint"]: {
                "cluster": "Alpha",
                "label": "clean_signet",
                "rare": False,
            },
            facts_a["inputs"][1]["outpoint"]: {
                "cluster": "Alpha",
                "label": "clean_signet",
                "rare": False,
            },
            facts_b["inputs"][0]["outpoint"]: {
                "cluster": "Beta",
                "label": "faucet_reserve",
                "rare": True,
            },
        }

        analysis_a = analyze_candidate(
            facts_a,
            utxo_metadata,
        )

        analysis_b = analyze_candidate(
            facts_b,
            utxo_metadata,
        )

        self.assertEqual(
            analysis_a.candidate_id,
            "A",
        )

        self.assertEqual(
            analysis_b.candidate_id,
            "B",
        )

        self.assertEqual(
            analysis_a.transaction.input_count,
            2,
        )

        self.assertEqual(
            analysis_b.transaction.input_count,
            1,
        )

        self.assertTrue(
            analysis_b.future_optionality.rare_utxo_consumed,
        )

        self.assertFalse(
            analysis_a.future_optionality.rare_utxo_consumed,
        )

        comparison = compare_candidates(
            [analysis_a, analysis_b]
        )

        self.assertEqual(
            comparison.candidate_ids,
            ["A", "B"],
        )

        self.assertEqual(
            len(comparison.tradeoffs),
            2,
        )

        self.assertIn(
            "Candidate 'A'",
            comparison.summary,
        )

        self.assertIn(
            "Candidate 'B'",
            comparison.summary,
        )


if __name__ == "__main__":
    unittest.main()
