# Music App (React + PostgreSQL API)

## Stack
- Frontend: `Vite + React`
- Backend: `Express + pg`
- Database: `PostgreSQL`

## 1. Install

```bash
npm install
```

## 2. Fast demo run

Fastest path for local defense demo:

```bash
cp .env.demo .env
npm install
npm run start:app
```

PowerShell:

```powershell
Copy-Item .env.demo .env
npm install
npm run start:app
```

In a second terminal:

```bash
npm run dev
```

Checks:

```bash
npm run smoke -- --client
```

`npm run start:app` waits for PostgreSQL, applies migrations, restores a committed portable snapshot when available, and starts the API.
If some old local audio files are missing, the app still starts and hides unavailable local tracks from the user catalog. Set `STRICT_AUDIO_VALIDATION=true` if you want startup to fail on missing media.

Demo account from `.env.demo`:
- username: `demo_user`
- password: `demo_password_123`

Demo checklist:
- `/` shows the playable home feed, wave button, and new releases entry point.
- `/releases` opens the full new releases grid.
- `/search` handles typo genre queries and still shows contextual tracks while searching.
- `/profile` covers login, uploads, likes, history, and account settings.
- `/admin` shows catalog health, validation queue, releases, tracks, and users for an admin account.

## 3. Portable clone with current data

If you want another device to get the same accounts, uploaded tracks, playlists, likes, and local media after just:

```bash
git clone ...
docker compose up --build
```

prepare a portable snapshot on the source machine first:

```bash
npm run snapshot:export
git add portable-snapshot
git commit -m "chore: refresh portable snapshot"
git push
```

What the snapshot contains:
- PostgreSQL application data exported from the current database
- local media copied from `public/audio`

What happens on the target machine:
- `docker compose up --build` starts PostgreSQL + app
- migrations run first
- if the database is still empty and `portable-snapshot/database.json` exists, the app restores snapshot data automatically
- local media from `portable-snapshot/media` is copied into the Docker `media_data` volume

Important:
- snapshot files can be large because audio/HLS files are copied into the repo
- snapshot may include real user accounts and password hashes, so do not publish such a repo publicly unless that is intentional
- if the Docker volume/database already contains data, automatic snapshot restore is skipped to avoid overwriting existing state
- set `PORTABLE_SNAPSHOT_FORCE_RESTORE=true` if you intentionally want to overwrite an existing Docker database with the committed snapshot

## 4. Environment

Copy `.env.example` to `.env` and set values:

```env
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=music_app
PGUSER=postgres
PGPASSWORD=your_password_here

API_HOST=127.0.0.1
API_PORT=4000
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
# TRUST_PROXY=false
# PASSWORD_RESET_RETURN_TOKEN=false
# PLAYBACK_SIGNING_SECRET=change_me
# PLAYBACK_REQUIRE_SIGNED=false
# PLAYBACK_EMBED_SIGNED_URL=true
# PLAYBACK_URL_TTL_MS=900000
# PLAYBACK_EMBED_URL_TTL_MS=21600000
# TRACK_UPLOAD_MAX_BYTES=125829120
# TRACK_UPLOAD_TEMP_DIR=tmp/uploads
# GENERATE_HLS_ON_UPLOAD=true
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
# FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
# DB_WAIT_RETRIES=30
# DB_WAIT_INTERVAL_MS=2000
# STRICT_AUDIO_VALIDATION=false
# NODE_ENV=production
# MEDIA_STORAGE_DRIVER=local
# MEDIA_CDN_BASE_URL=https://cdn.example.com/audio
# MEDIA_S3_ENDPOINT=http://127.0.0.1:9000
# MEDIA_S3_REGION=us-east-1
# MEDIA_S3_BUCKET=music-audio
# MEDIA_S3_ACCESS_KEY_ID=minioadmin
# MEDIA_S3_SECRET_ACCESS_KEY=minioadmin
# MEDIA_S3_FORCE_PATH_STYLE=true
# MEDIA_S3_PREFIX=audio
# MEDIA_S3_PUBLIC_BASE_URL=
# MEDIA_S3_ACL=
# SMOKE_BASE_URL=http://127.0.0.1:4000
```

For a quick local demo config, use tracked `.env.demo`.

## 5. Migrations and seed

```bash
npm run db:migrate
npm run db:seed
```

If you still have an older local database with the removed legacy demo catalog, run:

```bash
npm run db:cleanup-default-seed
```

Or:

```bash
npm run db:setup
```

Or use the one-command startup flow:

```bash
npm run start:app
```

## 6. Run backend

```bash
npm run server
```

Backend listens on `http://127.0.0.1:4000` by default.

Liveness: `GET /api/health`

Readiness: `GET /api/ready`

## 7. Run frontend

In a separate terminal:

```bash
npm run dev
```

Vite proxies `/api/*` to `http://127.0.0.1:4000`.

## 8. Tests, lint, build

```bash
npm run test
npm run lint
npm run build
npm run smoke
```

If `dist/index.html` exists, backend can serve the built frontend.

To verify built frontend too:

```bash
npm run smoke -- --client
```

## 9. Streaming setup (optional)

By default tracks are streamed with HTTP Range on `GET /api/stream/:trackId`.

If `PLAYBACK_SIGNING_SECRET` is set:
- `GET /api/playback/:trackId` returns signed `streamUrl` with `exp/sig`.
- `PLAYBACK_REQUIRE_SIGNED=true` enforces signed access for `/api/stream/:trackId`.

To generate HLS manifests/segments (requires `ffmpeg`):

```bash
npm run stream:hls
```

If `ffmpeg` is not in system `PATH`, set `FFMPEG_PATH` and `FFPROBE_PATH` in `.env`.

Useful variants:

```bash
npm run stream:hls -- --track your-track-id
npm run stream:hls -- --dry-run
```

Generated files are placed in `public/audio/hls/<trackId>/`.

## 10. Track Upload API

`POST /api/tracks/upload` (requires `Authorization: Bearer <token>`).

`multipart/form-data` fields:
- `audio` (required file)
- `title` (required)
- `artist` (required, comma-separated supported)
- `trackId` (optional)
- `durationSec` (optional)
- `explicit` (optional)
- `cover` (optional)
- `tags` (optional, comma-separated)

Server flow:
- transcodes input to mp3 using `ffmpeg`
- uploads audio to configured storage (`local` or `s3`)
- upserts track + artists + tags in PostgreSQL
- optionally generates local HLS (`GENERATE_HLS_ON_UPLOAD=true`)

## 11. S3/MinIO + CDN migration

Set `MEDIA_STORAGE_DRIVER=s3` and S3 vars, then migrate existing local DB audio URLs:

```bash
npm run media:migrate:s3
```

Dry run:

```bash
npm run media:migrate:s3 -- --dry-run
```

## 12. Optional seed user

`npm run db:seed` creates a user only when both variables are set:

```env
SEED_USERNAME=demo_user
SEED_PASSWORD=strong_password_here
SEED_DISPLAY_NAME=Demo User
# SEED_IS_ADMIN=true
```

If these vars are not set, seed user creation is skipped. Set `SEED_IS_ADMIN=true` when you want the seeded account to become the first admin.

## 13. Docker (PostgreSQL + API + Frontend)

For a quick local Docker run, `.env` is optional now.
If `.env` is missing, Docker falls back to local-safe defaults such as `PGPASSWORD=postgres`.
Create `.env` only when you want to override DB credentials, CORS, storage, or other runtime settings.

```bash
docker compose up --build -d
```

Windows note:
- start Docker Desktop first, otherwise `docker compose` will fail before containers are even created

Or simply use:

```bash
npm run docker:up
```

On Windows this command now tries to launch Docker Desktop automatically, waits for the Docker engine, and then runs `docker compose up --build -d`.

Open: `http://localhost:4000`.

Useful follow-up commands:

```bash
docker compose logs -f app
docker compose down
docker compose down -v
```

Services:
- `db` (internal PostgreSQL service, not published to the host by default)
- `app` (waits for DB, runs migrations, restores portable snapshot when available, otherwise runs database bootstrap, then serves API + built frontend on `4000`)

Notes:
- uploaded/local audio is persisted in the named Docker volume `media_data`
- runtime image includes `ffmpeg`, so upload transcoding and HLS generation can work inside the container
- container always uses bundled Linux `ffmpeg/ffprobe`, so host Windows paths from local `.env` do not break Docker startup
- if you need direct access to PostgreSQL, prefer `docker compose exec db psql ...` instead of opening `5432` publicly
- committed portable snapshots are copied into the runtime image and restored only when the database is empty
- the old in-repo demo catalog has been removed; add content through uploads/admin tools or by committing a fresh portable snapshot

Quick check after container startup:

```bash
npm run smoke -- --client
```

## 14. Railway deployment

This repository includes `railway.json`, so Railway builds the existing Dockerfile, starts
`node scripts/start-app.mjs`, and checks `/api/health` after startup.

Recommended setup:

1. Push this repository to GitHub.
2. In Railway, create a new project from the GitHub repository.
3. Add a PostgreSQL service to the same Railway project.
4. Add a volume to the app service with this mount path:

```text
/app/public/audio
```

The volume keeps uploaded/restored media across redeploys. On the first boot,
`npm run start:app` restores `portable-snapshot/database.json` and copies
`portable-snapshot/media` into `/app/public/audio` when the database is empty.

App service variables:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
SERVE_CLIENT=true
TRUST_PROXY=true
STRICT_AUDIO_VALIDATION=false
PORTABLE_SNAPSHOT_RESTORE_MEDIA=true
PLAYBACK_SIGNING_SECRET=replace_with_a_long_random_secret
```

If your PostgreSQL service is not named `Postgres`, adjust the reference variable namespace.
Railway provides `PORT` automatically; do not hard-code it. The server will listen on
`0.0.0.0:$PORT` on Railway and keeps `127.0.0.1:4000` for local runs.

After the first successful deploy:
- open the app service settings
- go to Networking / Public Networking
- click `Generate Domain`

Railway will give a public HTTPS domain such as `https://your-app.up.railway.app`.
You can add a custom domain in the same section if you want a cleaner defense URL.

Important for this music app:
- the committed media/snapshot is close to 1 GB, so tiny free/trial volumes may be too small
- if the first deploy is slow, keep the healthcheck timeout at 600 seconds
- for a lighter deploy, remove extra tracks locally, run `npm run snapshot:export`, and commit the refreshed snapshot

## 15. CI

Workflow: `.github/workflows/ci.yml`

Runs on `push` and `pull_request`:

```bash
npm ci
npm run lint
npm run test
npm run build
```

## Scripts

- `npm run dev` - frontend dev server
- `npm run dev:client` - frontend dev server
- `npm run dev:server` - backend dev run
- `npm run server` - backend run
- `npm run start:app` - wait for DB, run migrations + database bootstrap, start backend
- `npm run db:migrate` - apply SQL migrations
- `npm run db:seed` - database bootstrap plus optional seed user
- `npm run db:cleanup-default-seed` - remove legacy demo catalog entries from older databases
- `npm run db:setup` - migrations + seed
- `npm run snapshot:export` - export current PostgreSQL data + local media into `portable-snapshot`
- `npm run snapshot:restore` - restore committed portable snapshot into the current database/media directory
- `npm run audio:import` - import audio into `public/audio/tracks`
- `npm run stream:hls` - generate HLS manifests/segments into `public/audio/hls`
- `npm run media:migrate:s3` - upload local audio to S3 and rewrite DB `tracks.audio_url`
- `npm run docker:up` - start Docker Desktop on Windows when needed, then run `docker compose up --build -d`
- `npm run docker:down` - stop Docker services
- `npm run docker:logs` - follow app container logs
- `npm run docker:reset` - stop Docker services and remove named volumes
- `npm run test` - tests (`node:test`)
- `npm run lint` - eslint
- `npm run build` - frontend production build
- `npm run smoke` - smoke check for `/api/health` and `/api/ready`
- `npm run preview` - preview production build

## Backend structure

- `server/app.js` - Express app setup
- `server/routes/apiRoutes.js` - API routes
- `server/services/catalogService.js` - business logic and DB operations
- `server/services/authService.js` - auth/sessions
- `server/middleware/*` - middleware
- `server/db/migrations/*` - SQL migrations
