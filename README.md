# KakiCare

KakiCare is an internal coordination platform for an elderly **befriending programme** in
Singapore, built for ICT2216 Secure Software Development (Team 18). Vetted community
**volunteers** are matched with **seniors** to visit or call them, while **staff** manage
volunteer applications, senior records, matches, and an audit log. Seniors are records
managed by staff and never log in.

This repository is a monorepo with two sibling apps:

- `frontend/` — React 18 + TypeScript + Vite single-page app.
- `backend/` — Django + Django REST Framework + PostgreSQL.

The frontend talks to the backend over a typed API layer.

## What the platform does

KakiCare digitises the coordination of a community **befriending programme**, in which volunteers
give regular companionship to isolated or vulnerable seniors through home visits and phone calls.
It replaces ad-hoc spreadsheets and chat groups with a single system that vets volunteers, stores
seniors' details safely, proposes and tracks matches, schedules and verifies each visit, and keeps
a tamper-evident audit trail — all while protecting the seniors' personal data.

### Who uses it

- **Volunteers** — members of the public who apply, are vetted, and are matched to a senior.
- **Staff** — programme coordinators who review applications, manage senior records, propose
  matches, and oversee sessions and welfare.
- **Admins** — operators (Django superusers) who work behind an MFA-gated admin portal and are the
  only accounts that can create staff (via emailed single-use invite).
- **Seniors** — the people being befriended. They are **records managed by staff, not users**: they
  never log in, and their contact details are protected.

### What you can do

**As a volunteer:** register and verify your email, complete a vetting profile (languages,
availability, and uploaded identity/declaration documents), optionally enable two-factor
authentication, view the matches staff propose, accept or decline them, book visit or call sessions
within programme hours, check in and out of a session with a one-time code, review your session
history, and request account deactivation.

**As a staff member:** review and approve/reject volunteer applications, create and maintain senior
records (including consent status), propose volunteer–senior matches, confirm booked sessions (which
issues a single-use check-in code), monitor upcoming and missed sessions and record welfare
follow-ups, handle welfare concerns raised about a senior, process MFA-reset and account-deactivation
requests, and inspect the audit log.

### How a match works

Staff propose a match between an approved volunteer and a consenting senior. Once it is active, the
volunteer books sessions; a senior's **full contact details are disclosed only just-in-time** — in a
short window around each scheduled session — and are otherwise limited to first name, language, and
general locality. At the visit, staff relay a one-time code to the senior, who passes it to the
volunteer, giving a proof-of-presence check-in. A missed session raises a welfare follow-up so no
vulnerable senior is quietly left unvisited.

### Security at a glance

As an ICT2216 Secure Software Development project, KakiCare is built defence-in-depth: in-house
authentication with Argon2id password hashing and mandatory staff MFA, strict server-side access
control, just-in-time disclosure of senior contact details, magic-byte-validated document uploads
stored outside the web root, field-level encryption of senior PII at rest, an append-only audit log
enforced at the database level, and HTTPS with a hardened TLS configuration in production. The full
security-implementation write-up is in the D2 report under `docs/`.

## Repository layout

```
.
├── frontend/          React SPA (Vite, Tailwind, React Router)
├── backend/           Django + DRF API + Postgres migrations
├── private_media/     Uploaded volunteer documents (Django MEDIA_ROOT, outside web root)
├── docker-compose.yml Local Postgres container
└── README.md
```

## Tech stack

- **React 18** + **TypeScript**
- **Vite** (build tool / dev server)
- **Tailwind CSS** (styling)
- **React Router** (routing)

Dependencies are kept intentionally minimal — no UI component library, state-management
library, or form library — so the team can understand and defend its own code. Auth is
implemented in-house (no OAuth / third-party auth library).

## Team onboarding (start here)

New to the repo? You need **no production secrets** to develop locally — not the
EC2 key, not the prod `.env`, not the SMTP or deploy credentials. You create one
local secrets file (`backend/.env`) and run two processes.

1. **Install** Node 18+ (20 recommended), Python 3.11+ (3.13 to match prod),
   Docker Desktop (for the local Postgres container), and git.
2. **Create `backend/.env`** (gitignored) from the template and set two values:
   ```bash
   cd backend && cp .env.example .env      # PowerShell: Copy-Item .env.example .env
   ```
   - `SECRET_KEY=` → generate: `python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"`
   - `POSTGRES_PASSWORD=` → any local password.

   Everything else is dev-ready as shipped (`DEBUG=True`, `POSTGRES_HOST=localhost`,
   and the console email backend — verification/reset emails print to the terminal,
   no SMTP needed). `frontend/.env` is optional (defaults to `http://localhost:8000`).
3. **Run it** (detailed steps in [Backend](#backend--running-locally) and
   [Frontend](#frontend--running-locally) below): `docker compose up -d` for Postgres,
   then Django (`migrate` + `runserver`) and the Vite dev server (`npm run dev`).

**Before your first PR:** branch off `develop` (not `main`), commit under your own
GitHub identity, and open the PR into `develop`. See
[Branching & contribution workflow](#branching--contribution-workflow).

Gitignored / never committed: `backend/.env`, `frontend/.env`, `node_modules/`,
`dist/`, `private_media/` (uploaded PII), `.venv/`.

## Prerequisites

- **Node.js 18+** (developed on Node 20+) and npm.

## Frontend — running locally

```bash
git clone https://github.com/Brxndxnnnn/ICT2216-TEAM-18-SSD.git
cd ICT2216-TEAM-18-SSD/frontend
npm install
npm run dev
```

The dev server prints a local URL (default <http://localhost:5173>).

### Other scripts (all from `frontend/`)

- `npm run build` — type-check and produce a production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — type-check only (`tsc --noEmit`).

## Configuration

The backend base URL is controlled by the `VITE_API_BASE_URL` environment variable. It
defaults to `http://localhost:8000` if unset. To override it, copy `frontend/.env.example`
to `frontend/.env` and adjust:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

## Backend — running locally

The backend (`backend/`) is **Django + Django REST Framework** on **PostgreSQL**. For local
development we run Postgres in a single Docker container and Django natively on the host.

**Prerequisites:** Python 3.11+, and Docker Desktop (or Docker Engine + Compose v2).

**1. Create your backend `.env`** (it is gitignored — never commit it):

```bash
cd backend
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
```

Then edit `backend/.env` and set at least:

```env
SECRET_KEY=<paste a generated key>   # see command below
POSTGRES_PASSWORD=<choose any local password>
```

Generate a `SECRET_KEY` with:

```bash
python -c "from django.core.management.utils import get_random_secret_key as g; print(g())"
```

The other values (`POSTGRES_DB=kakicare`, `POSTGRES_USER=kakicare`, `POSTGRES_HOST=localhost`,
`POSTGRES_PORT=5432`, `DEBUG=True`, `ALLOWED_HOSTS=localhost,127.0.0.1`) can stay as shipped.
Postgres reads `POSTGRES_*` from this same file via `docker-compose.yml`.

**2. Start PostgreSQL** (run from the repository root, where `docker-compose.yml` is):

```bash
docker compose up -d
```

Postgres listens on `127.0.0.1:5432` only, and its data persists in the named volume
`kakicare_pgdata` across restarts.

**3. Set up Python and run Django** (from `backend/`):

```bash
cd backend
python -m venv .venv

# Activate the virtualenv:
#   PowerShell:        .venv\Scripts\Activate.ps1
#   Windows cmd:       .venv\Scripts\activate.bat
#   macOS / Linux:     source .venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser   # use an email + full name (no username)
python manage.py runserver
```

Django serves at <http://127.0.0.1:8000>. Log in to the admin at
<http://127.0.0.1:8000/admin/> with the superuser you created to browse the data models.

**Stop / reset:**

```bash
docker compose down            # stop the container (data is kept)
docker compose down -v         # stop AND delete the database volume (full reset)
```

## Deployment (EC2)

Production runs as a self-contained Docker Compose stack on the school-provided
EC2 instance. Five containers — `nginx` (ports 80 and 443; TLS termination +
reverse proxy), `web` (gunicorn + Django, internal), `db` (Postgres, internal),
`certbot` (auto-renews the TLS certificate), and `scheduler` (runs the
missed-session sweep). Only `nginx` publishes host ports (80 and 443); everything
else is reachable only on the internal Docker network.

### Test the production stack locally first

Before pushing to the EC2, run the production stack on your machine to confirm
it builds and starts cleanly. Copy `backend/.env.prod.example` to `backend/.env`
(or use a different file via `--env-file`) and set a `SECRET_KEY` and
`POSTGRES_PASSWORD`. Then:

```bash
docker compose -f docker-compose.prod.yml up --build
```

Visit <http://localhost> — you should see the React SPA, with the API reachable
at `/api/...` on the same origin. Bring it down with `Ctrl-C` then
`docker compose -f docker-compose.prod.yml down`.

### First-time EC2 setup

SSH into the EC2 using the key you were given:

```bash
ssh -i path/to/ICT2216-AY2526-T3-student18.pem student18@18.221.83.106
```

On the EC2 host, install Docker (Ubuntu — adjust if the image is different):

```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-plugin git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER           # then log out + back in for group to apply
```

Configure the host firewall — **always allow 22 before enabling**:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Clone the repo and prepare the production env file:

```bash
git clone https://github.com/Brxndxnnnn/ICT2216-TEAM-18-SSD.git kakicare
cd kakicare
cp backend/.env.prod.example backend/.env
# Edit backend/.env: set SECRET_KEY and POSTGRES_PASSWORD to real, secret values.
nano backend/.env
```

Bring the stack up:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f      # watch startup
```

Migrations run automatically on container start. Create the first staff user:

```bash
docker compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

Verify in a browser: <http://18.221.83.106/>.

### Enable HTTPS (first-time cert issuance)

HTTPS uses DuckDNS (`kakicare.duckdns.org` → 18.221.83.106) + Let's Encrypt + nginx TLS termination.

**One-time steps on the EC2** (after the stack is cloned):

```bash
# 1. Bring up nginx + certbot so port 80 is available for the ACME challenge:
docker compose -f docker-compose.prod.yml up -d nginx certbot

# 2. Issue the cert (replace the email address):
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d kakicare.duckdns.org \
  --email your@email.com --agree-tos --no-eff-email

# 3. Bring the full stack up:
docker compose -f docker-compose.prod.yml up -d --build
```

**Before step 3**, update `backend/.env` on the EC2 from the template:

```bash
nano backend/.env
```

Change / add these values (see `backend/.env.prod.example` for context):

```env
SESSION_COOKIE_SECURE=True
CSRF_COOKIE_SECURE=True
SECURE_HSTS_SECONDS=31536000
ALLOWED_HOSTS=kakicare.duckdns.org,18.221.83.106
FRONTEND_BASE_URL=https://kakicare.duckdns.org
CORS_ALLOWED_ORIGINS=https://kakicare.duckdns.org
CSRF_TRUSTED_ORIGINS=https://kakicare.duckdns.org
```

Then restart the web container to pick up the new env vars:

```bash
docker compose -f docker-compose.prod.yml restart web
```

Cert renewal is automatic — the `certbot` service checks every 12 hours.
After a renewal, reload nginx:

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

### Set up automated deploys (GitHub Actions)

CI (`.github/workflows/ci.yml`) runs on every push and PR; the deploy job in that
same workflow runs after CI passes on a push to `main`. Configure these repository
secrets at **Settings → Secrets and variables → Actions**:

| Secret name        | Value                                                       |
| ------------------ | ----------------------------------------------------------- |
| `EC2_HOST`         | `18.221.83.106`                                             |
| `EC2_USER`         | `student18`                                                 |
| `EC2_SSH_KEY`      | The **full contents** of the `.pem` file (including the `BEGIN`/`END` lines) |
| `EC2_DEPLOY_DIR`   | `/home/student18/kakicare`                                  |

Then merge a change into `main` — CI runs, deploy follows, smoke test confirms
nginx is responding. Subsequent deploys take ~30 seconds.

### Day-to-day

```bash
# Tail logs
docker compose -f docker-compose.prod.yml logs -f web nginx

# Restart after editing backend/.env
docker compose -f docker-compose.prod.yml restart web

# Roll back to a previous commit
git checkout <commit-sha>
docker compose -f docker-compose.prod.yml up -d --build
```

## Branching & contribution workflow

We use a two-tier model: a long-lived integration branch (`develop`) and a
production release branch (`main`).

```
feature/*  ──PR──▶  develop      CI runs · NO deploy   ← all day-to-day work lands here
develop    ──PR──▶  main          CI runs on the PR
merge to main (push)             ──▶  auto-deploy to EC2   ← the ONLY thing that touches prod
```

- **`main`** — always reflects exactly what is live on the EC2. A merge here
  triggers the deploy job. Protected; never push directly.
- **`develop`** — integration branch and repo default. All completed features
  merge here first. Tested by CI but never deployed.
- **`feature/*`** (also `fix/*`, `chore/*`) — short-lived branches off `develop`.

Only a push (merge) to `main` deploys — the deploy job in
`.github/workflows/ci.yml` is gated on
`github.ref == 'refs/heads/main' && github.event_name == 'push'`. Everything
else runs the test jobs only.

### Day-to-day

```bash
git checkout develop && git pull
git checkout -b feature/my-thing
# ...work, commit...
git push -u origin feature/my-thing
# Open PR  feature/my-thing → develop, get it green + reviewed, merge.
```

To ship, open a release PR `develop → main`; merging it deploys to the EC2.

> ⚠️ **New environment variables do not deploy automatically.** `backend/.env`
> lives only on the EC2 and is never overwritten by a deploy. If your change
> reads a new env var, someone with EC2 access must add it there *before* the
> deploy, or the `web` container will crash on boot. Coordinate in the release PR.

### Branch protection

`main` and `develop` are protected by GitHub Rulesets (Settings → Rules →
Rulesets): a PR is required, the `Frontend lint + build` and
`Backend check + tests` checks must pass, and force-pushes / deletions are
blocked. `main` additionally requires one approving review.

## Possible future improvements

- **Registry-based deploys.** Today the EC2 builds Docker images during deploy
  (`up -d --build`). Building images in CI and pushing SHA-tagged images to a
  registry (e.g. GHCR) would stop building on the production host and give a
  fast, reliable rollback (redeploy a previous tag instead of rebuilding).
- **Staging environment** to validate a deploy before it reaches users.
- **DB backup before auto-migrations**, so a failed migration during a deploy can
  be rolled back cleanly.


