import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from publication_gate import check_day, verify_output, REQUIRED


class PublicationGateTest(unittest.TestCase):
    def test_four_market_feeds_all_required(self):
        samples = {kind: {str(i): {"ok": True} for i in range(30)}
                   for kind in REQUIRED}
        r = check_day("2026-10-23", lambda kind, day: samples[kind])
        self.assertTrue(r["ready"])
        self.assertEqual(set(r["counts"]), set(REQUIRED))
        self.assertEqual(r["date"], "2026-10-23")

    def test_late_institution_data_prevents_publishing(self):
        def lookup(kind, date):
            if kind == "otc_inst":
                raise RuntimeError("盤後三大法人尚未公布")
            return {str(i): {} for i in range(30)}
        result = check_day("2026-10-23", lookup)
        self.assertFalse(result["ready"])
        self.assertIn("otc_inst", result["errors"])

    def test_incomplete_price_snapshot_prevents_publishing(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "screener.json"
            date = "2026-10-23"
            coverage = {market: {"newest_price_date": date,
                      "newest_institution_date": date}
                      for market in ("TWSE", "TPEx")}
            file.write_text(json.dumps({"status":"ok", "coverage":coverage}))
            good, _ = verify_output(file, date)
            self.assertTrue(good)
            coverage["TPEx"]["newest_institution_date"] = "2026-10-22"
            file.write_text(json.dumps({"status":"ok", "coverage":coverage}))
            good, reason = verify_output(file, date)
            self.assertFalse(good)
            self.assertIn("TPEx", reason)

    def test_empty_or_partial_responses_must_not_count_as_complete(self):
        r = check_day("2026-10-23", lambda kind, date: {"2330": {}})
        self.assertFalse(r["ready"])


if __name__ == "__main__":
    unittest.main()
