begin;

alter table tracks
  add column if not exists created_at bigint,
  add column if not exists uploaded_by text references users(id);

alter table tracks
  alter column created_at set default ((extract(epoch from now()) * 1000)::bigint);

update tracks
set created_at = (extract(epoch from now()) * 1000)::bigint
where created_at is null;

create index if not exists idx_tracks_created_at on tracks(created_at);
create index if not exists idx_tracks_uploaded_by on tracks(uploaded_by);

commit;
