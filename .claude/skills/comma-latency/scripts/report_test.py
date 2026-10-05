#!/usr/bin/env python3
import unittest
import sys
sys.dont_write_bytecode = True
from report import correlation, reduce_run, stats


class ReportTests(unittest.TestCase):
    def test_percentiles_keep_tail_and_missing_values(self):
        self.assertIsNone(stats([]))
        self.assertEqual(stats([1, 2, 3, 4, 100])["median"], 3)
        self.assertEqual(stats([1, 2, 3, 4, 100])["p90"], 100)
        self.assertIsNone(correlation([(1, 2), (2, 3)]))
        self.assertAlmostEqual(correlation([(1, 3), (2, 2), (3, 1)]), -1)

    def test_failures_do_not_become_fast_samples(self):
        run = {"trials": [
            {"interaction": "search", "repetition": 1, "status": "measured", "firstMs": 20, "settledMs": 80, "confirmedMs": 380},
            {"interaction": "search", "repetition": 2, "status": "no-response"},
        ]}
        result = reduce_run(run)["search"]
        self.assertEqual(result["attempted"], 2)
        self.assertEqual(result["successful"], 1)
        self.assertEqual(result["first"]["median"], 20)


if __name__ == "__main__":
    unittest.main()
