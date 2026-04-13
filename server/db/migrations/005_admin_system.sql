-- Admin system: Add admin roles and content moderation

begin;

-- Add admin and ban flags to users table
alter table users
  add column if not exists is_admin boolean default false,
  add column if not exists is_banned boolean default false,
  add column if not exists ban_reason text;

-- Add moderation columns to tracks table
alter table tracks
  add column if not exists is_hidden boolean default false,
  add column if not exists hidden_reason text,
  add column if not exists hidden_by text references users(id),
  add column if not exists hidden_at bigint;

-- Create indexes for efficient filtering
create index if not exists idx_users_is_admin on users(is_admin);
create index if not exists idx_users_is_banned on users(is_banned);
create index if not exists idx_tracks_is_hidden on tracks(is_hidden);

commit;
