create table if not exists users (
  id text primary key,
  username text not null,
  display_name text not null,
  password_hash text not null,
  password_salt text not null,
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create unique index if not exists idx_users_username_lower
  on users (lower(username));

create table if not exists user_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at bigint not null,
  expires_at bigint not null
);

create index if not exists idx_user_sessions_user_id
  on user_sessions (user_id);

create table if not exists user_states (
  user_id text primary key references users(id) on delete cascade,
  liked_track_ids text[] not null default array[]::text[],
  followed_artist_ids text[] not null default array[]::text[],
  history_track_ids text[] not null default array[]::text[],
  updated_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table playlists
  add column if not exists user_id text references users(id) on delete cascade;

create index if not exists idx_playlists_user_id
  on playlists (user_id);
