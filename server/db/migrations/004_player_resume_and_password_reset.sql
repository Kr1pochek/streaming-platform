alter table user_states
  add column if not exists queue_track_ids text[] not null default array[]::text[],
  add column if not exists queue_current_index int not null default 0,
  add column if not exists queue_progress_sec double precision not null default 0,
  add column if not exists queue_is_playing boolean not null default false;

create table if not exists password_reset_tokens (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at bigint not null,
  expires_at bigint not null,
  used_at bigint
);

create index if not exists idx_password_reset_tokens_user_id
  on password_reset_tokens (user_id);

create index if not exists idx_password_reset_tokens_expires_at
  on password_reset_tokens (expires_at);
