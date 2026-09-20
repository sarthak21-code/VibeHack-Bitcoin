"""
Unit tests for change detection and address reuse analysis.
"""

import unittest

from backend.privacy_engine.change import analyze_address_reuse, analyze_change
from backend.privacy_engine.models import CandidateInput, CandidateOutput


class TestChangeAnalysis(unittest.TestCase):
    def test_change_created(self):
        """Test 4: Change created when inputs > payment + fee."""
        inputs = [CandidateInput(outpoint="txid:0", amount_sats=10000)]
        outputs = [
            CandidateOutput(amount_sats=7000, is_wallet_controlled=False),
            CandidateOutput(amount_sats=2500, is_wallet_controlled=True),
        ]
        fee_sats = 500

        tx_analysis, findings = analyze_change(
            inputs=inputs,
            outputs=outputs,
            fee_sats=fee_sats,
            recipient_amount_sats=7000,
        )

        self.assertEqual(tx_analysis.inputs_total_sats, 10000)
        self.assertEqual(tx_analysis.payment_sats, 7000)
        self.assertEqual(tx_analysis.fee_sats, 500)
        self.assertEqual(tx_analysis.change_sats, 2500)
        self.assertTrue(tx_analysis.change_created)

        likely_change = next((f for f in findings if f.type == "likely_change"), None)
        self.assertIsNotNone(likely_change)
        self.assertIn("2,500 sats", likely_change.message)

    def test_no_change(self):
        """Test 5: Exact payment leaves no change."""
        inputs = [CandidateInput(outpoint="txid:0", amount_sats=10000)]
        outputs = [
            CandidateOutput(amount_sats=9500, is_wallet_controlled=False),
        ]
        fee_sats = 500

        tx_analysis, findings = analyze_change(
            inputs=inputs,
            outputs=outputs,
            fee_sats=fee_sats,
            recipient_amount_sats=9500,
        )

        self.assertEqual(tx_analysis.inputs_total_sats, 10000)
        self.assertEqual(tx_analysis.payment_sats, 9500)
        self.assertEqual(tx_analysis.fee_sats, 500)
        self.assertEqual(tx_analysis.change_sats, 0)
        self.assertFalse(tx_analysis.change_created)

        no_change_finding = next((f for f in findings if f.type == "no_change"), None)
        self.assertIsNotNone(no_change_finding)
        self.assertIn("No change output created", no_change_finding.message)

    def test_address_reuse_detected_destination(self):
        """Address reuse detected when destination address matches known history."""
        dest_addr = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
        outputs = [
            CandidateOutput(
                address=dest_addr, amount_sats=3000, is_wallet_controlled=False
            ),
        ]
        known_history = [dest_addr, "tb1qsomeotheraddress"]

        detected, reuse_type, reason, findings = analyze_address_reuse(
            outputs=outputs,
            known_used_addresses=known_history,
        )

        self.assertTrue(detected)
        self.assertEqual(reuse_type, "destination")
        self.assertIsNone(reason)
        self.assertTrue(any(f.type == "address_reuse" and f.severity == "warning" for f in findings))

    def test_address_reuse_detected_change(self):
        """Address reuse detected on change address."""
        change_addr = "tb1qchangeaddressreused"
        outputs = [
            CandidateOutput(
                address="tb1qnewrecipient", amount_sats=3000, is_wallet_controlled=False
            ),
            CandidateOutput(
                address=change_addr, amount_sats=1000, is_wallet_controlled=True
            ),
        ]
        known_history = [change_addr]

        detected, reuse_type, reason, findings = analyze_address_reuse(
            outputs=outputs,
            known_used_addresses=known_history,
        )

        self.assertTrue(detected)
        self.assertEqual(reuse_type, "change")
        self.assertIsNone(reason)

    def test_address_reuse_insufficient_metadata(self):
        """When known history is None, return None and 'insufficient metadata' (never assume false)."""
        outputs = [
            CandidateOutput(
                address="tb1qdestination", amount_sats=5000, is_wallet_controlled=False
            )
        ]

        detected, reuse_type, reason, findings = analyze_address_reuse(
            outputs=outputs,
            known_used_addresses=None,
        )

        self.assertIsNone(detected)
        self.assertIsNone(reuse_type)
        self.assertEqual(reason, "insufficient metadata")
        self.assertTrue(any(f.type == "address_reuse" and "insufficient" in f.message for f in findings))

    def test_no_address_reuse_with_clean_history(self):
        """When history is provided and no addresses match, return False."""
        outputs = [
            CandidateOutput(
                address="tb1qfreshaddress", amount_sats=5000, is_wallet_controlled=False
            )
        ]
        known_history = ["tb1qoldaddress1", "tb1qoldaddress2"]

        detected, reuse_type, reason, findings = analyze_address_reuse(
            outputs=outputs,
            known_used_addresses=known_history,
        )

        self.assertFalse(detected)
        self.assertIsNone(reuse_type)
        self.assertIsNone(reason)


if __name__ == "__main__":
    unittest.main()
