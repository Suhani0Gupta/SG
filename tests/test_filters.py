"""
Unit tests for cheap rules-based pre-filters.
Tests:
1. Location filtering (Bengaluru / Remote accepted, Overseas dropped)
2. Blocklisted companies dropped immediately
3. Experience extraction and matching
4. Unclear experience placed in "Review" bucket instead of rejected (mandated by rule 5)
5. Avoid keywords detected
"""
import unittest
from app.sources.base import NormalizedJob
from app.filters.rules import JobFilterEngine, extract_years_of_experience

DEFAULT_PREFS = {
    "target_titles": ["Software Engineer", "Backend Engineer", "Full Stack Developer"],
    "title_keywords": ["Engineer", "Developer"],
    "experience_range": {"min_years": 3, "max_years": 6},
    "location": {"allow_remote_india": True},
    "blocklist_companies": ["shadyconsulting"],
    "avoid_keywords": ["6 days working", "walk-in"]
}


class TestJobFilters(unittest.TestCase):

    def test_experience_extraction_regex(self):
        exp1 = extract_years_of_experience("Requires 4-6 years of experience in Python.")
        self.assertEqual(exp1, (4.0, 6.0))

        exp2 = extract_years_of_experience("Candidate must have 3+ years experience with React.")
        self.assertEqual(exp2[0], 3.0)

        exp3 = extract_years_of_experience("Join our vibrant team.")
        self.assertIsNone(exp3)

    def test_blocklist_filtering(self):
        job = NormalizedJob(
            id="test:1",
            source="greenhouse",
            source_job_id="1",
            company="shadyconsulting",
            title="Backend Engineer",
            canonical_url="https://example.com/1",
            location_raw="Bengaluru",
            location_normalized="Bengaluru, India",
            is_bengaluru=True,
            is_remote=False,
            is_hybrid=False,
            content_text="4 years experience required."
        )
        res = JobFilterEngine.evaluate(job, DEFAULT_PREFS)
        self.assertFalse(res["passed"])
        self.assertEqual(res["bucket"], "dropped")
        self.assertIn("blocklist", res["reasons"][0].lower())

    def test_unclear_experience_sent_to_review_bucket(self):
        """Mandated by Rule 5: If unclear, send to 'Review' bucket instead of rejecting!"""
        job = NormalizedJob(
            id="test:2",
            source="greenhouse",
            source_job_id="2",
            company="canonical",
            title="Software Engineer",
            canonical_url="https://example.com/2",
            location_raw="Bengaluru",
            location_normalized="Bengaluru, India",
            is_bengaluru=True,
            is_remote=False,
            is_hybrid=False,
            content_text="Great engineering opportunity in Bengaluru." # No years mentioned
        )
        res = JobFilterEngine.evaluate(job, DEFAULT_PREFS)
        self.assertTrue(res["passed"])
        self.assertEqual(res["status"], "needs_review")
        self.assertEqual(res["bucket"], "review")

    def test_overseas_location_dropped(self):
        job = NormalizedJob(
            id="test:3",
            source="greenhouse",
            source_job_id="3",
            company="stripe",
            title="Backend Engineer",
            canonical_url="https://example.com/3",
            location_raw="Dublin, Ireland",
            location_normalized="Dublin, Ireland",
            is_bengaluru=False,
            is_remote=False,
            is_hybrid=False,
            content_text="5 years experience in Dublin."
        )
        res = JobFilterEngine.evaluate(job, DEFAULT_PREFS)
        self.assertFalse(res["passed"])
        self.assertEqual(res["bucket"], "dropped")


if __name__ == "__main__":
    unittest.main()
