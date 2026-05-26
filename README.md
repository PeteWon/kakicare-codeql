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

