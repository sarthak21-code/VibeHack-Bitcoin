"""
Unit tests for cluster and common-input heuristic analysis.
"""

import unittest

from backend.privacy_engine.cluster import analyze_clusters_and_inputs
from backend.privacy_engine.models import CandidateInput, UTXOMetadata


class TestClusterAnalysis(unittest.TestCase):
    def test_same_cluster_inputs(self):
        """Test 1: Multiple inputs from the same cluster (no merge)."""
        inputs = [
            CandidateInput(outpoint="txidA:0", amount_sats=4200),
            CandidateInput(outpoint="txidB:0", amount_sats=391),
        ]
        metadata = {
            "txidA:0": UTXOMetadata(cluster="Alpha"),
            "txidB:0": UTXOMetadata(cluster="Alpha"),
        }

        clusters_used, count, merged, multiple, findings = analyze_clusters_and_inputs(
            inputs, metadata
        )

        self.assertEqual(clusters_used, ["Alpha"])
        self.assertEqual(count, 1)
        self.assertFalse(merged)
        self.assertTrue(multiple)

        finding_types = [f.type for f in findings]
        self.assertIn("common_input_heuristic", finding_types)
        self.assertIn("cluster_isolated", finding_types)
        self.assertNotIn("cluster_merge", finding_types)

    def test_different_clusters_inputs(self):
        """Test 2: Multiple inputs from different clusters (cluster merge detected)."""
        inputs = [
            CandidateInput(outpoint="txidA:0", amount_sats=4200),
            CandidateInput(outpoint="txidB:0", amount_sats=142653),
        ]
        metadata = {
            "txidA:0": UTXOMetadata(cluster="Alpha"),
            "txidB:0": UTXOMetadata(cluster="Beta"),
        }

        clusters_used, count, merged, multiple, findings = analyze_clusters_and_inputs(
            inputs, metadata
        )

        self.assertEqual(set(clusters_used), {"Alpha", "Beta"})
        self.assertEqual(count, 2)
        self.assertTrue(merged)
        self.assertTrue(multiple)

        merge_finding = next((f for f in findings if f.type == "cluster_merge"), None)
        self.assertIsNotNone(merge_finding)
        self.assertEqual(merge_finding.severity, "warning")
        self.assertIn("distinct wallet-side metadata clusters", merge_finding.message)

    def test_single_input(self):
        """Test 3: Single input transaction avoids common-input heuristic and merge."""
        inputs = [
            CandidateInput(outpoint="txidC:0", amount_sats=142653),
        ]
        metadata = {
            "txidC:0": UTXOMetadata(cluster="Beta"),
        }

        clusters_used, count, merged, multiple, findings = analyze_clusters_and_inputs(
            inputs, metadata
        )

        self.assertEqual(clusters_used, ["Beta"])
        self.assertEqual(count, 1)
        self.assertFalse(merged)
        self.assertFalse(multiple)

        cih_finding = next(
            (f for f in findings if f.type == "common_input_heuristic"), None
        )
        self.assertIsNotNone(cih_finding)
        self.assertIn("Single input transaction avoids", cih_finding.message)

    def test_dict_metadata_compatibility(self):
        """Test that plain dictionary metadata works transparently."""
        inputs = [
            CandidateInput(outpoint="txid1:0", amount_sats=1000),
        ]
        metadata = {
            "txid1:0": {"cluster": "Gamma", "label": "donation"},
        }

        clusters_used, count, merged, multiple, findings = analyze_clusters_and_inputs(
            inputs, metadata
        )
        self.assertEqual(clusters_used, ["Gamma"])
        self.assertEqual(count, 1)
        self.assertFalse(merged)

    def test_missing_cluster_metadata(self):
        """Test behavior when inputs have no cluster metadata."""
        inputs = [
            CandidateInput(outpoint="txid_unknown:0", amount_sats=5000),
        ]
        clusters_used, count, merged, multiple, findings = analyze_clusters_and_inputs(
            inputs, {}
        )
        self.assertEqual(clusters_used, [])
        self.assertEqual(count, 0)
        self.assertFalse(merged)
        self.assertTrue(any(f.type == "cluster_metadata_missing" for f in findings))


if __name__ == "__main__":
    unittest.main()
