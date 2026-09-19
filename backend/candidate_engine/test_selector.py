import unittest

from candidate_engine.selector import (
    largest_first,
    smallest_single,
    two_utxo_pair,
)


class TestSelector(unittest.TestCase):

    def setUp(self):
        self.utxos = [
            {
                "outpoint": "txid-A:0",
                "amount_sats": 1_000_000,
            },
            {
                "outpoint": "txid-B:0",
                "amount_sats": 1_500_000,
            },
            {
                "outpoint": "txid-C:0",
                "amount_sats": 3_000_000,
            },
        ]

        self.target = 2_000_000

    def test_largest_first(self):
        selected = largest_first(
            self.utxos,
            self.target,
        )

        self.assertEqual(
            len(selected),
            1,
        )

        self.assertEqual(
            selected[0]["outpoint"],
            "txid-C:0",
        )

        self.assertGreaterEqual(
            sum(u["amount_sats"] for u in selected),
            self.target,
        )

    def test_smallest_single(self):
        selected = smallest_single(
            self.utxos,
            self.target,
        )

        self.assertEqual(
            len(selected),
            1,
        )

        self.assertEqual(
            selected[0]["outpoint"],
            "txid-C:0",
        )

    def test_two_utxo_pair(self):
        selected = two_utxo_pair(
            self.utxos,
            self.target,
        )

        self.assertEqual(
            len(selected),
            2,
        )

        selected_ids = {
            u["outpoint"]
            for u in selected
        }

        self.assertEqual(
            selected_ids,
            {"txid-A:0", "txid-B:0"},
        )

        self.assertGreaterEqual(
            sum(u["amount_sats"] for u in selected),
            self.target + 500,
        )

    def test_largest_first_insufficient_funds(self):
        with self.assertRaises(ValueError):
            largest_first(
                self.utxos,
                10_000_000,
            )

    def test_smallest_single_no_match(self):
        with self.assertRaises(ValueError):
            smallest_single(
                self.utxos,
                10_000_000,
            )

    def test_two_utxo_pair_no_match(self):
        with self.assertRaises(ValueError):
            two_utxo_pair(
                self.utxos,
                10_000_000,
            )


if __name__ == "__main__":
    unittest.main()
