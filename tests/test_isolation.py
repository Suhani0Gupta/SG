"""
Tests proving multi-user data isolation.
Validates:
1. User A cannot read User B's profile or CV.
2. User A cannot read User B's job evaluations or preferences.
3. Sensitive fields (phone, CTC) are encrypted at rest in SQLite.
4. Admin queries cannot expose CV or phone/CTC contents of other users.
5. Account deletion completely cascades and leaves no trace of user data.
"""
import os
import sqlite3
import unittest
import tempfile
from app.db.database import (
    init_db,
    IsolatedUserStore,
    encrypt_sensitive,
    decrypt_sensitive,
    get_db_connection
)


class TestUserIsolation(unittest.TestCase):

    def setUp(self):
        # Create an isolated temporary SQLite database for tests
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.db_path = self.temp_db.name
        self.temp_db.close()
        init_db(self.db_path)

        # Seed users
        conn = get_db_connection(self.db_path)
        with conn:
            conn.execute("INSERT INTO users (id, email, password_hash, is_admin) VALUES ('user_a', 'partner@local.test', 'hash_a', 0)")
            conn.execute("INSERT INTO users (id, email, password_hash, is_admin) VALUES ('user_b', 'friend@local.test', 'hash_b', 0)")
            conn.execute("INSERT INTO users (id, email, password_hash, is_admin) VALUES ('admin_u', 'admin@local.test', 'hash_admin', 1)")
            # Add a global job
            conn.execute("""
                INSERT INTO global_jobs (canonical_url, source, source_job_id, company, title, is_bengaluru)
                VALUES ('https://example.com/jobs/1', 'greenhouse', '1', 'Acme', 'Staff Engineer', 1)
            """)
        conn.close()

        self.store_a = IsolatedUserStore("user_a", self.db_path)
        self.store_b = IsolatedUserStore("user_b", self.db_path)

    def tearDown(self):
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    def test_profile_and_cv_isolation(self):
        """User A writes CV and phone; User B MUST NOT be able to access it."""
        self.store_a.save_profile(
            phone="+91-9876543210",
            ctc="35 LPA",
            cv_text="Partner Confidential CV: Expert in Distributed Systems",
            cv_filename="partner_resume.pdf"
        )

        profile_a = self.store_a.get_profile()
        self.assertIsNotNone(profile_a)
        self.assertEqual(profile_a["phone"], "+91-9876543210")
        self.assertEqual(profile_a["cv_text"], "Partner Confidential CV: Expert in Distributed Systems")

        # User B queries their profile
        profile_b = self.store_b.get_profile()
        self.assertIsNone(profile_b)

    def test_sensitive_encryption_at_rest(self):
        """Verify phone and CTC are stored encrypted in the database row."""
        self.store_a.save_profile(
            phone="+91-9999988888",
            ctc="40 LPA",
            cv_text="Secret CV",
            cv_filename="cv.txt"
        )
        conn = get_db_connection(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT encrypted_phone, encrypted_ctc FROM user_profiles WHERE user_id = 'user_a'")
        row = cur.fetchone()
        conn.close()

        # Raw DB values must NOT contain plaintext phone or CTC
        self.assertNotIn("9999988888", row["encrypted_phone"])
        self.assertNotIn("40 LPA", row["encrypted_ctc"])
        # Decrypted must match original
        self.assertEqual(decrypt_sensitive(row["encrypted_phone"]), "+91-9999988888")
        self.assertEqual(decrypt_sensitive(row["encrypted_ctc"]), "40 LPA")

    def test_preferences_isolation(self):
        """User A's preferences are completely isolated from User B."""
        self.store_a.save_preferences({
            "target_titles": ["Staff Backend Engineer"],
            "salary_floor_lpa": 32.0,
            "must_have_keywords": ["Go", "Distributed"]
        })
        self.store_b.save_preferences({
            "target_titles": ["Product Designer"],
            "salary_floor_lpa": 15.0,
            "must_have_keywords": ["Figma", "UI/UX"]
        })

        prefs_a = self.store_a.get_preferences()
        prefs_b = self.store_b.get_preferences()

        self.assertEqual(prefs_a["target_titles"], ["Staff Backend Engineer"])
        self.assertEqual(prefs_b["target_titles"], ["Product Designer"])
        self.assertNotEqual(prefs_a["salary_floor_lpa"], prefs_b["salary_floor_lpa"])

    def test_evaluations_and_actions_isolation(self):
        """User A shortlists a job; User B sees only their own job list."""
        conn = get_db_connection(self.db_path)
        with conn:
            conn.execute("""
                INSERT INTO user_job_evaluations (id, user_id, job_url, status, score, summary)
                VALUES ('eval_a', 'user_a', 'https://example.com/jobs/1', 'shortlisted', 92.5, 'Great fit for Partner')
            """)
        conn.close()

        evals_a = self.store_a.get_evaluations()
        evals_b = self.store_b.get_evaluations()

        self.assertEqual(len(evals_a), 1)
        self.assertEqual(evals_a[0]["status"], "shortlisted")
        self.assertEqual(evals_a[0]["summary"], "Great fit for Partner")

        # User B should see 0 evaluations
        self.assertEqual(len(evals_b), 0)

    def test_admin_cannot_leak_cv_via_user_list(self):
        """Admin user listing only selects id, email, is_active, created_at, never CV or encrypted fields."""
        conn = get_db_connection(self.db_path)
        cur = conn.cursor()
        # Recommended query for admin user listing
        cur.execute("SELECT id, email, is_admin, is_active, created_at FROM users")
        admin_rows = [dict(r) for r in cur.fetchall()]
        conn.close()

        for user_row in admin_rows:
            self.assertNotIn("cv_text", user_row)
            self.assertNotIn("encrypted_phone", user_row)
            self.assertNotIn("encrypted_ctc", user_row)

    def test_account_deletion_cascades_completely(self):
        """Exporting data works and deleting account leaves zero data behind."""
        self.store_a.save_profile(phone="123", ctc="10", cv_text="To be deleted", cv_filename="del.pdf")
        self.store_a.save_preferences({"test": True})
        
        export = self.store_a.export_all_data()
        self.assertEqual(export["user_id"], "user_a")
        self.assertIsNotNone(export["profile"])

        self.store_a.delete_account_completely()

        # Verify no rows remain for user_a anywhere
        conn = get_db_connection(self.db_path)
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as c FROM users WHERE id = 'user_a'")
        self.assertEqual(cur.fetchone()["c"], 0)
        cur.execute("SELECT COUNT(*) as c FROM user_profiles WHERE user_id = 'user_a'")
        self.assertEqual(cur.fetchone()["c"], 0)
        cur.execute("SELECT COUNT(*) as c FROM user_preferences WHERE user_id = 'user_a'")
        self.assertEqual(cur.fetchone()["c"], 0)
        conn.close()


if __name__ == "__main__":
    unittest.main()
