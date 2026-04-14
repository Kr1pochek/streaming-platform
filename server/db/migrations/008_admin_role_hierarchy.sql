-- Admin roles hierarchy: user / moderator / super_admin

begin;

alter table users
  add column if not exists admin_role text;

update users
set admin_role = case
  when coalesce(is_admin, false) = true then 'super_admin'
  else 'user'
end
where admin_role is null
   or admin_role not in ('user', 'moderator', 'super_admin');

alter table users
  alter column admin_role set default 'user';

update users
set admin_role = 'user'
where admin_role is null;

alter table users
  alter column admin_role set not null;

alter table users
  drop constraint if exists users_admin_role_check;

alter table users
  add constraint users_admin_role_check
  check (admin_role in ('user', 'moderator', 'super_admin'));

update users
set is_admin = (admin_role in ('moderator', 'super_admin'));

create index if not exists idx_users_admin_role on users(admin_role);

commit;
