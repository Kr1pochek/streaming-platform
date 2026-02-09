create table if not exists artists (
  id text primary key,
  name text not null unique,
  followers text
);

create table if not exists tracks (
  id text primary key,
  title text not null,
  duration_sec int not null,
  explicit boolean not null default false,
  cover text not null,
  audio_url text
);

create table if not exists track_artists (
  track_id text not null references tracks(id) on delete cascade,
  artist_id text not null references artists(id) on delete cascade,
  artist_order smallint not null default 1,
  primary key (track_id, artist_id)
);

create table if not exists track_tags (
  track_id text not null references tracks(id) on delete cascade,
  tag text not null,
  primary key (track_id, tag)
);

create table if not exists playlists (
  id text primary key,
  title text not null,
  subtitle text,
  cover text,
  is_custom boolean not null default false,
  created_at bigint
);

create table if not exists playlist_tracks (
  playlist_id text not null references playlists(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  position int not null,
  primary key (playlist_id, position),
  unique (playlist_id, track_id)
);

create table if not exists releases (
  id text primary key,
  artist_id text not null references artists(id) on delete cascade,
  title text not null,
  type text not null check (type in ('album', 'ep', 'single')),
  year int not null,
  cover text not null
);

create table if not exists release_tracks (
  release_id text not null references releases(id) on delete cascade,
  track_id text not null references tracks(id) on delete cascade,
  position int not null,
  primary key (release_id, position),
  unique (release_id, track_id)
);

alter table playlists add column if not exists is_custom boolean not null default false;
alter table playlists add column if not exists created_at bigint;
alter table tracks add column if not exists audio_url text;

create index if not exists idx_playlist_tracks_playlist_id_position
  on playlist_tracks (playlist_id, position);

create index if not exists idx_release_tracks_release_id_position
  on release_tracks (release_id, position);

create index if not exists idx_track_artists_track_id_artist_order
  on track_artists (track_id, artist_order);

create index if not exists idx_track_tags_track_id
  on track_tags (track_id);
