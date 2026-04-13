alter table playlists
  add column if not exists is_public boolean not null default false;

alter table user_states
  add column if not exists saved_playlist_ids text[] not null default array[]::text[];

create index if not exists idx_playlists_is_public
  on playlists (is_public);
