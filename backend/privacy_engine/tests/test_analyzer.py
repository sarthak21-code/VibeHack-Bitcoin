"""
Unit tests for central privacy analyzer and candidate comparator.
"""

import json
import unittest

from backend.privacy_engine.analyzer import analyze_candidate, compare_candidates
from backend.privacy_engine.models import (
    CandidateInput,
    CandidateOutput,
    CandidateTransaction,
    UTXOMetadata,
)


class TestAnalyzer(unittest.TestCase):
    def setUp(self):
        # Signet test scenario matching Member 1's prototype:
        # UTXOs: 4200, 391 (Cluster A), 142653 (Cluster B, rare=True)
        # Payment = 3500 sats, fee = 200 sats
        self.metadata = {
            "txid_4200:0": {
                "cluster": "A",
                "label": "clean_signet",
                "rare": False,
            },
            "txid_391:0": {
                "cluster": "A",
                "label": "clean_signet",
                "rare": False,
            },
            "txid_142653:0": {
                "cluster": "B",
                "label": "faucet_reserve",
                "rare": True,
            },
        }

    def test_member1_candidate_a_analysis(self):
        """
        Candidate A: 4200 + 391 = 4591 sats (2 inputs, 1 cluster, change = 891).
        """
        candidate_a = {
            "candidate_id": "A",
            "inputs": [
                {"outpoint": "txid_4200:0", "amount_sats": 4200},
                {"outpoint": "txid_391:0", "amount_sats": 391},
            ],
            "outputs": [
                {
                    "address": "tb1qrecipient",
                    "amount_sats": 3500,
                    "is_wallet_controlled": False,
                },
                {
                    "address": "tb1qchange",
                    "amount_sats": 891,
                    "is_wallet_controlled": True,
                },
            ],
            "fee_sats": 200,
            "recipient_amount_sats": 3500,
        }

        result = analyze_candidate(
            candidate=candidate_a,
            utxo_metadata=self.metadata,
            known_used_addresses=None,  # Insufficient metadata
        )

        # Transaction checks
        self.assertEqual(result.candidate_id, "A")
        self.assertEqual(result.transaction.input_count, 2)
        self.assertEqual(result.transaction.output_count, 2)
        self.assertEqual(result.transaction.inputs_total_sats, 4591)
        self.assertEqual(result.transaction.payment_sats, 3500)
        self.assertEqual(result.transaction.fee_sats, 200)
        self.assertEqual(result.transaction.change_sats, 891)
        self.assertTrue(result.transaction.change_created)

        # Privacy checks
        self.assertEqual(result.privacy.clusters_used, ["A"])
        self.assertEqual(result.privacy.clusters_count, 1)
        self.assertFalse(result.privacy.clusters_merged)
        self.assertTrue(result.privacy.multiple_inputs)
        self.assertIsNone(result.privacy.address_reuse_detected)
        self.assertEqual(result.privacy.address_reuse_reason, "insufficient metadata")

        # Optionality checks
        self.assertFalse(result.future_optionality.rare_utxo_consumed)
        self.assertIsNone(result.future_optionality.warning)

        # Check serialization
        res_dict = result.to_dict()
        self.assertIsInstance(res_dict, dict)
        json_str = json.dumps(res_dict)
        self.assertIn('"candidate_id": "A"', json_str)

    def test_member1_candidate_b_analysis(self):
        """
        Candidate B: 142653 sats (1 input, 1 cluster, rare=True, change = 138953).
        """
        candidate_b = {
            "candidate_id": "B",
            "inputs": [
                {"outpoint": "txid_142653:0", "amount_sats": 142653},
            ],
            "outputs": [
                {
                    "address": "tb1qrecipient",
                    "amount_sats": 3500,
                    "is_wallet_controlled": False,
                },
                {
                    "address": "tb1qchange_b",
                    "amount_sats": 138953,
                    "is_wallet_controlled": True,
                },
            ],
            "fee_sats": 200,
            "recipient_amount_sats": 3500,
        }

        result = analyze_candidate(
            candidate=candidate_b,
            utxo_metadata=self.metadata,
            known_used_addresses=["tb1qsomeoldaddress"],
        )

        # Transaction checks
        self.assertEqual(result.candidate_id, "B")
        self.assertEqual(result.transaction.input_count, 1)
        self.assertEqual(result.transaction.inputs_total_sats, 142653)
        self.assertEqual(result.transaction.change_sats, 138953)

        # Privacy checks
        self.assertEqual(result.privacy.clusters_used, ["B"])
        self.assertFalse(result.privacy.multiple_inputs)
        self.assertFalse(result.privacy.clusters_merged)
        self.assertFalse(result.privacy.address_reuse_detected)

        # Optionality checks
        self.assertTrue(result.future_optionality.rare_utxo_consumed)
        self.assertIsNotNone(result.future_optionality.warning)

    def test_candidate_comparison_tradeoffs(self):
        """Compare Candidate A vs Candidate B and evaluate structured tradeoffs."""
        candidate_a = {
            "candidate_id": "A",
            "inputs": [
                {"outpoint": "txid_4200:0", "amount_sats": 4200},
                {"outpoint": "txid_391:0", "amount_sats": 391},
            ],
            "outputs": [
                {"address": "tb1qdest", "amount_sats": 3500, "is_wallet_controlled": False},
                {"address": "tb1qchgA", "amount_sats": 891, "is_wallet_controlled": True},
            ],
            "fee_sats": 200,
            "recipient_amount_sats": 3500,
        }

        candidate_b = {
            "candidate_id": "B",
            "inputs": [
                {"outpoint": "txid_142653:0", "amount_sats": 142653},
            ],
            "outputs": [
                {"address": "tb1qdest", "amount_sats": 3500, "is_wallet_controlled": False},
                {"address": "tb1qchgB", "amount_sats": 138953, "is_wallet_controlled": True},
            ],
            "fee_sats": 200,
            "recipient_amount_sats": 3500,
        }

        res_a = analyze_candidate(candidate_a, self.metadata)
        res_b = analyze_candidate(candidate_b, self.metadata)

        comparison = compare_candidates([res_a, res_b])

        self.assertEqual(comparison.candidate_ids, ["A", "B"])
        self.assertEqual(len(comparison.tradeoffs), 2)

        tradeoff_a = next(t for t in comparison.tradeoffs if t.candidate_id == "A")
        tradeoff_b = next(t for t in comparison.tradeoffs if t.candidate_id == "B")

        # Candidate A preserves rare UTXO, but has multiple inputs
        self.assertTrue(any("Preserves tagged rare" in p for p in tradeoff_a.pros))
        self.assertTrue(any("common-input" in c for c in tradeoff_a.cons))

        # Candidate B avoids common-input heuristic, but consumes rare UTXO
        self.assertTrue(any("Single input avoids" in p for p in tradeoff_b.pros))
        self.assertTrue(any("Consumes a tagged rare" in c for c in tradeoff_b.cons))

        # Check JSON serialization of full comparison
        comp_dict = comparison.to_dict()
        self.assertIn("tradeoffs", comp_dict)
        self.assertIn("summary", comp_dict)
        json_output = json.dumps(comp_dict)
        self.assertIn('"candidate_ids": ["A", "B"]', json_output)


if __name__ == "__main__":
    unittest.main()
