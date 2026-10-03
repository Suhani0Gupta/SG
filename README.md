# Job Radar 🎯
> Private, self-hosted job radar for a small group of trusted users (family, partner, close friends). Built with Python 3.11, SQLite, modular scrapers, and human-in-the-loop scoring.

---

## 🔒 Transparency & Privacy Notice
> **"Admin-can't-see-your-data is enforced by the app only. Whoever controls the server and encryption key could technically access data."**

Every user has their own isolated profile, CV, and preferences. Sensitive personal fields (phone number, current CTC) are encrypted with AES/Fernet using `ENCRYPTION_KEY` from your environment. The admin UI never renders or queries other users' CVs or profiles. However, as with any self-hosted system, root access to the physical host or database file allows direct examination. Run on a trusted home server, homelab, or private VPS behind Tailscale/WireGuard.

---

## 🏗️ Project Architecture Tree (Phase 1)

```text
├── .env.example                # Sample environment secrets & keys
├── config.yaml                 # Global timeouts, poll interval, scoring weights
├── preferences.yaml            # Default Bengaluru job seeker preferences
├── companies.yaml              # Bengaluru-focused companies (Greenhouse, Lever)
├── mnc_gcc_allowlist.yaml      # 50+ Bengaluru MNCs and GCCs for bonus scoring
├── docker-compose.yml          # Self-hosted container deployment
├── Dockerfile                  # Production container definition
├── requirements.txt            # Python dependencies
├── app/
│   ├── __init__.py
│   ├── sources/
│   │   ├── base.py             # NormalizedJob dataclass & JobSource ABC
│   │   ├── greenhouse.py       # Greenhouse public board API parser
│   │   └── run.py              # Rule 3 CLI runner: test sources independently
│   ├── db/
│   │   ├── database.py         # SQLite schema & IsolatedUserStore
│   │   └── isolation.py        # Encryption and multi-tenant isolation
│   ├── filters/
│   │   └── rules.py            # Rules-based pre-filter & Review bucket logic
│   ├── scoring/
│   │   └── engine.py           # 0-100 soft scoring with allowlist & red flags
│   └── scripts/
│       ├── export_top_jobs.py  # Validation step: export top 20 jobs as table
│       └── tune_weights.py     # Disagreement analyzer for good/bad fit labels
├── tests/
│   ├── fixtures/
│   │   └── greenhouse_response.json  # Real-world fixture for offline testing
│   ├── test_greenhouse.py      # Greenhouse parser unit tests
│   ├── test_isolation.py       # User isolation & encryption unit tests
│   └── test_filters.py         # Rules & Review bucket unit tests
└── src/                        # Interactive React UI & Sourcing Workbench
```

---

## 🚀 Quickstart

### 1. Configure Secrets
```bash
cp .env.example .env
# Generate a Fernet-compatible 32-byte key:
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Update ENCRYPTION_KEY and SECRET_KEY in .env
```

### 2. Run Tests
Every phase must pass its tests:
```bash
python3 -m unittest tests/test_greenhouse.py
python3 -m unittest tests/test_isolation.py
python3 -m unittest tests/test_filters.py
```

### 3. Test Greenhouse Source (Rule 3)
Test the Greenhouse public source independently without touching SQLite:
```bash
# Dry-run on GitLab
python3 -m app.sources.run greenhouse --company gitlab --dry-run --limit 5

# Dry-run filtering only Bengaluru roles
python3 -m app.sources.run greenhouse --company canonical --dry-run --filter-bengaluru

# Output normalized JSON
python3 -m app.sources.run greenhouse --company automattic --dry-run --format json
```

### 4. Run via Docker Compose
```bash
docker compose up -d --build
```
The application will be accessible at `http://localhost:3000`.

---

## 👥 Adding Users & Admin Flow
1. First registered user is automatically designated as **Admin**.
2. Public registration is disabled by default.
3. To invite a partner or friend:
   - Admin generates an invite token in the Admin console.
   - The user opens `/register?invite=<token>` to create their account.
4. Each user configures their own target titles, salary floor, and CV.

---

## 🔌 Adding a New Source (Modular Architecture)
To add a new ATS or API scraper:
1. Create `app/sources/<name>.py` subclassing `JobSource` from `app.sources.base`.
2. Implement `fetch_jobs(company_slug)` returning `List[NormalizedJob]`.
3. Add a saved JSON response in `tests/fixtures/<name>_response.json`.
4. Add a unit test in `tests/test_<name>.py` testing offline parsing and normalization.
5. Register in `app/sources/run.py` so it can be tested standalone via CLI.
6. Verify against live data using the CLI before wiring into any scheduler!

---

## ⚠️ Known Limitations & Honesty Notes
- **ATS API Rate Limits**: Public Greenhouse boards are unauthenticated. We enforce a 2-second polite delay between requests and honor 429 backoff headers.
- **Experience Ambiguity**: Job descriptions frequently lack structured years-of-experience fields. Instead of dropping these jobs, our filter places them into a dedicated **"Needs Review"** bucket so she never misses a high-potential role due to a greedy regex.
- **MNC Classification**: The allowlist covers 50+ known tech MNCs and GCCs in Bengaluru. Unmatched companies require manual verification or LLM classification.
- **Salary Transparency**: Many Indian tech job descriptions do not state salary openly. Missing salary is scored **0 (neutral)** and is NEVER used to reject a job.
