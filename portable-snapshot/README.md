This directory is used for portable project snapshots.

Files created here by `npm run snapshot:export` can be committed to git so that
`docker compose up --build` on another machine restores:

- PostgreSQL application data from `portable-snapshot/database.json`
- local media from `portable-snapshot/media/`

Automatic restore runs only when the target database is still empty, unless
`PORTABLE_SNAPSHOT_FORCE_RESTORE=true` is set.
