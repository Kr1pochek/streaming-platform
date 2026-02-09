update playlists
set is_custom = true
where id like 'upl-%'
  and (is_custom is distinct from true);

update playlists
set created_at = (extract(epoch from now()) * 1000)::bigint
where id like 'upl-%'
  and created_at is null;
