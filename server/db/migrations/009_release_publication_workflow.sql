alter table releases
  add column if not exists description text;

alter table releases
  add column if not exists status text;

update releases
set status = 'published'
where coalesce(status, '') = '';

alter table releases
  alter column status set default 'published';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'releases_status_check'
  ) then
    alter table releases
      add constraint releases_status_check
      check (status in ('draft', 'published'));
  end if;
end $$;

alter table releases
  alter column status set not null;

alter table releases
  add column if not exists created_at bigint;

update releases
set created_at = (extract(epoch from now()) * 1000)::bigint
where created_at is null;

alter table releases
  alter column created_at set default (extract(epoch from now()) * 1000)::bigint;

alter table releases
  alter column created_at set not null;

alter table releases
  add column if not exists published_at bigint;

update releases
set published_at = coalesce(published_at, created_at)
where status = 'published';

alter table releases
  add column if not exists created_by text references users(id) on delete set null;

create index if not exists idx_releases_status
  on releases (status);

create index if not exists idx_releases_artist_status
  on releases (artist_id, status);
