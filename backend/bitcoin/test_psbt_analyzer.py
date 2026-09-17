"""
Unit and integration tests for PSBT Analyzer (Member 1).
"""

import sys
import unittest
from pathlib import Path

import bdkpython as bdk

# Add backend directory to sys.path so sibling imports resolve
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from bitcoin.candidate_psbt_test import (
    FEE_RATE_SAT_VB,
    TARGET_SATS,
    get_real_utxos,
    load_wallet,
)
from bitcoin.psbt_analyzer import (
    analyze_psbt,
    calculate_fee,
    extract_inputs,
    extract_outputs,
    identify_recipient_amount,
)
from candidate_engine.selector import largest_first, two_utxo_pair
from privacy_engine import analyze_candidate, compare_candidates


class TestPsbtAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.wallet, cls.persister = load_wallet()
        cls.utxos = get_real_utxos(cls.wallet)
        # Use a well-known testnet external address to ensure distinct ownership
        cls.external_recipient = bdk.Address(
            "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
            bdk.Network.SIGNET,
        )

    def _build_test_psbt(self, selected_utxos, target_sats=TARGET_SATS):
        builder = bdk.TxBuilder()
        builder = builder.add_utxos([u["outpoint"] for u in selected_utxos])
        builder = builder.manually_selected_only()
        builder = builder.add_recipient(
            self.external_recipient.script_pubkey(),
            bdk.Amount.from_sat(target_sats),
        )
        builder = builder.fee_rate(bdk.FeeRate.from_sat_per_vb(FEE_RATE_SAT_VB))
        return builder.finish(self.wallet)

    def test_one_input_candidate(self):
        """Test 1: One-input candidate extraction has input_count = 1."""
        candidate_utxos = largest_first(self.utxos, TARGET_SATS)
        self.assertEqual(len(candidate_utxos), 1)

        psbt = self._build_test_psbt(candidate_utxos)
        facts = analyze_psbt(psbt, self.wallet, candidate_id="Candidate_1Input")

        self.assertEqual(len(facts["inputs"]), 1)
        self.assertEqual(
            facts["inputs"][0]["amount_sats"],
            candidate_utxos[0]["amount_sats"],
        )
        self.assertIn(":", facts["inputs"][0]["outpoint"])

    def test_two_input_candidate(self):
        """Test 2: Two-input candidate extraction has input_count = 2."""
        candidate_utxos = two_utxo_pair(self.utxos, TARGET_SATS)
        self.assertEqual(len(candidate_utxos), 2)

        psbt = self._build_test_psbt(candidate_utxos)
        facts = analyze_psbt(psbt, self.wallet, candidate_id="Candidate_2Input")

        self.assertEqual(len(facts["inputs"]), 2)
        total_extracted = sum(inp["amount_sats"] for inp in facts["inputs"])
        expected_total = sum(u["amount_sats"] for u in candidate_utxos)
        self.assertEqual(total_extracted, expected_total)

    def test_output_extraction(self):
        """Test 3: Verify output amounts and addresses are correctly extracted."""
        candidate_utxos = two_utxo_pair(self.utxos, TARGET_SATS)
        psbt = self._build_test_psbt(candidate_utxos)
        facts = analyze_psbt(psbt, self.wallet)

        outputs = facts["outputs"]
        self.assertGreaterEqual(len(outputs), 2)  # Recipient + Change

        # Check recipient output exists with exact TARGET_SATS
        recipient_outs = [o for o in outputs if o["amount_sats"] == TARGET_SATS]
        self.assertEqual(len(recipient_outs), 1)
        self.assertEqual(
            recipient_outs[0]["address"],
            str(self.external_recipient),
        )

        # Check each output has valid satoshi amount > 0
        for out in outputs:
            self.assertGreater(out["amount_sats"], 0)
            self.assertIsNotNone(out["address"])

    def test_fee_calculation(self):
        """Test 4: Fee calculation equals inputs total minus outputs total."""
        candidate_utxos = two_utxo_pair(self.utxos, TARGET_SATS)
        psbt = self._build_test_psbt(candidate_utxos)
        facts = analyze_psbt(psbt, self.wallet)

        inputs_total = sum(inp["amount_sats"] for inp in facts["inputs"])
        outputs_total = sum(out["amount_sats"] for out in facts["outputs"])
        expected_fee = inputs_total - outputs_total

        self.assertIsNotNone(facts["fee_sats"])
        self.assertEqual(facts["fee_sats"], expected_fee)
        self.assertGreater(facts["fee_sats"], 0)
        # Verify BDK's native psbt.fee() matches
        self.assertEqual(facts["fee_sats"], psbt.fee())

    def test_wallet_controlled_output(self):
        """Test 5: BDK wallet ownership is correctly identified."""
        candidate_utxos = two_utxo_pair(self.utxos, TARGET_SATS)
        psbt = self._build_test_psbt(candidate_utxos)
        facts = analyze_psbt(psbt, self.wallet)

        outputs = facts["outputs"]
        # Recipient output is external -> is_wallet_controlled must be False
        recipient_out = next(o for o in outputs if o["amount_sats"] == TARGET_SATS)
        self.assertFalse(recipient_out["is_wallet_controlled"])

        # Change output belongs to this wallet -> is_wallet_controlled must be True
        change_out = next(o for o in outputs if o["amount_sats"] != TARGET_SATS)
        self.assertTrue(change_out["is_wallet_controlled"])

    def test_candidate_a_and_b_privacy_engine_integration(self):
        """Test 6: Candidate A and B real PSBTs are analyzed and accepted by Privacy Engine."""
        # Candidate A: Two UTXOs
        cand_a_utxos = two_utxo_pair(self.utxos, TARGET_SATS)
        psbt_a = self._build_test_psbt(cand_a_utxos)
        facts_a = analyze_psbt(psbt_a, self.wallet, candidate_id="A")

        # Candidate B: Largest first
        cand_b_utxos = largest_first(self.utxos, TARGET_SATS)
        psbt_b = self._build_test_psbt(cand_b_utxos)
        facts_b = analyze_psbt(psbt_b, self.wallet, candidate_id="B")

        # Create demo sidecar metadata for these UTXOs
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

        # Privacy Engine analyzes both candidates
        analysis_a = analyze_candidate(facts_a, utxo_metadata)
        analysis_b = analyze_candidate(facts_b, utxo_metadata)

        self.assertEqual(analysis_a.candidate_id, "A")
        self.assertEqual(analysis_b.candidate_id, "B")
        self.assertEqual(analysis_a.transaction.input_count, 2)
        self.assertEqual(analysis_b.transaction.input_count, 1)

        # Candidate B consumed rare UTXO
        self.assertTrue(analysis_b.future_optionality.rare_utxo_consumed)
        self.assertFalse(analysis_a.future_optionality.rare_utxo_consumed)

        # Compare candidates
        comparison = compare_candidates([analysis_a, analysis_b])
        self.assertEqual(comparison.candidate_ids, ["A", "B"])
        self.assertEqual(len(comparison.tradeoffs), 2)
        self.assertIn("Candidate 'A'", comparison.summary)
        self.assertIn("Candidate 'B'", comparison.summary)


if __name__ == "__main__":
    unittest.main()
