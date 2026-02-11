# Music App (React + PostgreSQL API)

## Stack
- Frontend: `Vite + React`
- Backend: `Express + pg`
- Database: `PostgreSQL`

## 1. Install

```bash
npm install
```

## 2. Environment

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
# PLAYBACK_SIGNING_SECRET=change_me
# PLAYBACK_REQUIRE_SIGNED=false
# PLAYBACK_EMBED_SIGNED_URL=true
# PLAYBACK_URL_TTL_MS=900000
# PLAYBACK_EMBED_URL_TTL_MS=21600000
# TRACK_UPLOAD_MAX_BYTES=83886080
# TRACK_UPLOAD_TEMP_DIR=tmp/uploads
# GENERATE_HLS_ON_UPLOAD=true
# FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
# FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
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
```

## 3. Migrations and seed

```bash
npm run db:migrate
npm run db:seed
```

Or:

```bash
npm run db:setup
```

## 4. Run backend

```bash
npm run server
```

Backend listens on `http://127.0.0.1:4000` by default.

## 5. Run frontend

In a separate terminal:

```bash
npm run dev
```

Vite proxies `/api/*` to `http://127.0.0.1:4000`.

## 6. Tests, lint, build

```bash
npm run test
npm run lint
npm run build
```

If `dist/index.html` exists, backend can serve the built frontend.

## 7. Streaming setup (optional)

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
npm run stream:hls -- --track city-rain
npm run stream:hls -- --dry-run
```

Generated files are placed in `public/audio/hls/<trackId>/`.

## 8. Track Upload API

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

## 9. S3/MinIO + CDN migration

Set `MEDIA_STORAGE_DRIVER=s3` and S3 vars, then migrate existing local DB audio URLs:

```bash
npm run media:migrate:s3
```

Dry run:

```bash
npm run media:migrate:s3 -- --dry-run
```

## 10. Optional seed user

`npm run db:seed` creates a user only when both variables are set:

```env
SEED_USERNAME=demo_user
SEED_PASSWORD=strong_password_here
SEED_DISPLAY_NAME=Demo User
```

If these vars are not set, seed user creation is skipped.

## 11. Docker (PostgreSQL + API + Frontend)

```bash
docker compose up --build
```

Services:
- `db` (PostgreSQL on `5432`)
- `app` (migrations + seed + API + built frontend on `4000`)

Open: `http://localhost:4000`.

## 12. CI

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
- `npm run db:migrate` - apply SQL migrations
- `npm run db:seed` - seed/sync catalog and optional seed user
- `npm run db:setup` - migrations + seed
- `npm run audio:import` - import audio into `public/audio/tracks`
- `npm run stream:hls` - generate HLS manifests/segments into `public/audio/hls`
- `npm run media:migrate:s3` - upload local audio to S3 and rewrite DB `tracks.audio_url`
- `npm run test` - tests (`node:test`)
- `npm run lint` - eslint
- `npm run build` - frontend production build
- `npm run preview` - preview production build

## Backend structure

- `server/app.js` - Express app setup
- `server/routes/apiRoutes.js` - API routes
- `server/services/catalogService.js` - business logic and DB operations
- `server/services/authService.js` - auth/sessions
- `server/middleware/*` - middleware
- `server/db/migrations/*` - SQL migrations
