alter table releases
  drop constraint if exists releases_status_check;

alter table releases
  add constraint releases_status_check
  check (status in ('draft', 'pending', 'published', 'rejected'));

create index if not exists idx_releases_pending_created_at
  on releases (created_at desc)
  where status = 'pending';
