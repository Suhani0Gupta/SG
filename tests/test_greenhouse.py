"""
Unit tests for Greenhouse source scraper using saved fixture.
Runs completely offline without external network or dependencies.
"""
import json
import os
import unittest
from app.sources.greenhouse import GreenhouseSource
from app.sources.base import normalize_location, clean_html_text

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixtures", "greenhouse_response.json")


class TestGreenhouseSource(unittest.TestCase):

    def setUp(self):
        self.scraper = GreenhouseSource()
        with open(FIXTURE_PATH, "r", encoding="utf-8") as f:
            self.fixture_payload = json.load(f)

    def test_fixture_parsing(self):
        """Test parsing all jobs from saved fixture."""
        jobs = self.scraper.normalize_payload(self.fixture_payload, "canonical")
        self.assertEqual(len(jobs), 5)

        # Check job 1: Senior Backend Engineer
        job1 = jobs[0]
        self.assertEqual(job1.id, "greenhouse:canonical:4120934")
        self.assertEqual(job1.title, "Senior Backend Engineer - Core Platform")
        self.assertEqual(job1.company, "canonical")
        self.assertTrue(job1.is_bengaluru)
        self.assertEqual(job1.departments, ["Engineering"])
        self.assertIn("Python and PostgreSQL", job1.content_text)
        self.assertNotIn("<h3>", job1.content_text) # HTML stripped
        self.assertEqual(job1.salary_raw, "30 - 45 LPA")

    def test_remote_india_normalization(self):
        """Test job with Remote India location."""
        jobs = self.scraper.normalize_payload(self.fixture_payload, "canonical")
        job2 = jobs[1]
        self.assertEqual(job2.title, "Full Stack Developer (React / Python)")
        self.assertTrue(job2.is_remote)
        self.assertIn("Remote", job2.location_normalized)

    def test_bengaluru_alias_matching(self):
        """Test Bangalore alias matches Bengaluru."""
        jobs = self.scraper.normalize_payload(self.fixture_payload, "canonical")
        job3 = jobs[2]
        self.assertEqual(job3.location_raw, "Bangalore, India")
        self.assertTrue(job3.is_bengaluru)

    def test_overseas_detection(self):
        """Test London job is NOT flagged as Bengaluru or Remote India."""
        jobs = self.scraper.normalize_payload(self.fixture_payload, "canonical")
        job4 = jobs[3]
        self.assertFalse(job4.is_bengaluru)
        self.assertFalse(job4.is_remote)
        self.assertEqual(job4.location_raw, "London, United Kingdom")

    def test_html_cleaner(self):
        """Test HTML tags, entities, and line breaks are sanitized."""
        raw_html = "&lt;h1&gt;Job Title&lt;/h1&gt;&lt;p&gt;First line&lt;br/&gt;Second line&lt;/p&gt;"
        cleaned = clean_html_text(raw_html)
        self.assertIn("Job Title", cleaned)
        self.assertIn("First line", cleaned)
        self.assertIn("Second line", cleaned)
        self.assertNotIn("&lt;", cleaned)
        self.assertNotIn("<h1", cleaned)


if __name__ == "__main__":
    unittest.main()
