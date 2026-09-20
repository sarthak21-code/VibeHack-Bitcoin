"""
Unit tests for future optionality and rare/important UTXO preservation.
"""

import unittest

from backend.privacy_engine.models import CandidateInput, UTXOMetadata
from backend.privacy_engine.optionality import analyze_optionality


class TestOptionalityAnalysis(unittest.TestCase):
    def test_rare_utxo_consumed(self):
        """Test 6: Rare UTXO consumed when marked rare=True."""
        inputs = [CandidateInput(outpoint="txid_rare:0", amount_sats=142653)]
        metadata = {
            "txid_rare:0": UTXOMetadata(rare=True, label="large_reserve"),
        }

        opt, findings = analyze_optionality(inputs, metadata)

        self.assertTrue(opt.rare_utxo_consumed)
        self.assertIsNotNone(opt.warning)
        self.assertIn("consumes a tagged rare", opt.warning)

        rare_finding = next((f for f in findings if f.type == "rare_utxo_consumed"), None)
        self.assertIsNotNone(rare_finding)
        self.assertEqual(rare_finding.severity, "warning")

    def test_rare_utxo_preserved(self):
        """Standard UTXO does not trigger rare UTXO warning."""
        inputs = [CandidateInput(outpoint="txid_common:0", amount_sats=4200)]
        metadata = {
            "txid_common:0": UTXOMetadata(rare=False, label="standard"),
        }

        opt, findings = analyze_optionality(inputs, metadata)

        self.assertFalse(opt.rare_utxo_consumed)
        self.assertIsNone(opt.warning)

        preserved_finding = next((f for f in findings if f.type == "rare_utxo_preserved"), None)
        self.assertIsNotNone(preserved_finding)
        self.assertEqual(preserved_finding.severity, "info")

    def test_important_label_treated_as_rare(self):
        """UTXO labeled 'important' triggers preservation warning even if rare flag not explicitly set."""
        inputs = [CandidateInput(outpoint="txid_imp:0", amount_sats=50000)]
        metadata = {
            "txid_imp:0": {"label": "important hodl bag", "rare": False},
        }

        opt, findings = analyze_optionality(inputs, metadata)

        self.assertTrue(opt.rare_utxo_consumed)
        self.assertIsNotNone(opt.warning)

    def test_remaining_utxo_count_and_cluster_exhaustion(self):
        """Remaining UTXO count and unique cluster exhaustion calculation."""
        inputs = [
            CandidateInput(outpoint="txid_a1:0", amount_sats=1000),
            CandidateInput(outpoint="txid_a2:0", amount_sats=2000),
        ]
        metadata = {
            "txid_a1:0": {"cluster": "ColdStorage"},
            "txid_a2:0": {"cluster": "ColdStorage"},
            "txid_b1:0": {"cluster": "HotWallet"},
        }
        wallet_utxos = [
            {"outpoint": "txid_a1:0", "amount_sats": 1000},
            {"outpoint": "txid_a2:0", "amount_sats": 2000},
            {"outpoint": "txid_b1:0", "amount_sats": 5000},
        ]

        # Spending both ColdStorage UTXOs, with change created
        opt, findings = analyze_optionality(
            inputs=inputs,
            utxo_metadata=metadata,
            wallet_utxos=wallet_utxos,
            change_created=True,
        )

        # 3 initial - 2 spent + 1 change = 2 remaining
        self.assertEqual(opt.remaining_utxo_count, 2)
        # All ColdStorage inputs in wallet were consumed
        self.assertTrue(opt.unique_cluster_consumed)


if __name__ == "__main__":
    unittest.main()
