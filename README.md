# KakiCare

KakiCare is an internal coordination platform for an elderly **befriending programme** in
Singapore, built for ICT2216 Secure Software Development (Team 18). Vetted community
**volunteers** are matched with **seniors** to visit or call them, while **staff** manage
volunteer applications, senior records, matches, and an audit log. Seniors are records
managed by staff and never log in. This repository currently contains the **frontend**; the
backend is built separately and the frontend talks to it over a typed API layer.

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

## Run locally

```bash
git clone https://github.com/Brxndxnnnn/ICT2216-TEAM-18-SSD.git
cd ICT2216-TEAM-18-SSD
npm install
npm run dev
```

The dev server prints a local URL (default <http://localhost:5173>).

### Other scripts

- `npm run build` — type-check and produce a production build in `dist/`.
- `npm run preview` — serve the production build locally.
- `npm run lint` — type-check only (`tsc --noEmit`).

## Configuration

The backend base URL is controlled by the `VITE_API_BASE_URL` environment variable. It
defaults to `http://localhost:8000` if unset. To override it, copy `.env.example` to `.env`
and adjust:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

> The API layer (`src/lib/api.ts`) currently returns mock data so the frontend runs before
> the backend exists. Each function is marked `// MOCK` with the real call commented above
> it; see the migration plan at the top of that file.
