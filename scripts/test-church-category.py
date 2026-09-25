import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from wien_deals.church_scraper import Source, build_deal


class ChurchCategoryTests(unittest.TestCase):
    def test_service_category_merges_without_changing_identity_or_content(self):
        for kind, expected in [("gottesdienste", "kirche"), ("kirche", "kirche"), ("events", "events")]:
            with self.subTest(kind=kind):
                deal = build_deal(
                    source=Source(slug="icf", name="ICF Wien", homepage="https://www.icf-wien.at"),
                    kind=kind, title="Test title", description="Test description", url="https://www.icf-wien.at",
                    expires="Dauerhaft", priority=3,
                )
                self.assertEqual(deal["category"], expected)
                self.assertTrue(deal["id"].startswith(f"icf-{kind}-"))
                self.assertEqual(deal["title"], "Test title")
                self.assertEqual(deal["description"], "Test description")


if __name__ == "__main__":
    unittest.main()
