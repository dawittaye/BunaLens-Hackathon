-- BunaLens authentication foundation: owner-scoped station profiles.
-- Limited to the table required by account onboarding; grading and payments
-- remain separate migrations and are not enabled by this file.

create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  station_name text,
  name text,
  owner_name text,
  manager text,
  email text,
  phone text,
  woreda text not null check (woreda in (
    'Gomma', 'Limmu Kossa', 'Mana', 'Seka Chekorsa',
    'Gera', 'Kersa', 'Jimma Town'
  )),
  zone text not null default 'Jimma',
  credits integer not null default 10 check (credits >= 0),
  pro_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stations_name_present check (
    nullif(btrim(coalesce(station_name, name)), '') is not null
  )
);

create or replace function public.bunalens_sync_station_aliases()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name
       and new.station_name is not distinct from old.station_name then
      new.station_name := new.name;
    elsif new.station_name is distinct from old.station_name
       and new.name is not distinct from old.name then
      new.name := new.station_name;
    end if;
    if new.manager is distinct from old.manager
       and new.owner_name is not distinct from old.owner_name then
      new.owner_name := new.manager;
    elsif new.owner_name is distinct from old.owner_name
       and new.manager is not distinct from old.manager then
      new.manager := new.owner_name;
    end if;
  end if;
  new.station_name := coalesce(new.station_name, new.name);
  new.name := coalesce(new.name, new.station_name);
  new.owner_name := coalesce(new.owner_name, new.manager);
  new.manager := coalesce(new.manager, new.owner_name);
  return new;
end;
$$;

create or replace function public.bunalens_set_station_updated_at()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stations_bunalens_sync_aliases on public.stations;
create trigger stations_bunalens_sync_aliases
before insert or update on public.stations
for each row execute function public.bunalens_sync_station_aliases();

drop trigger if exists stations_bunalens_set_updated_at on public.stations;
create trigger stations_bunalens_set_updated_at
before update on public.stations
for each row execute function public.bunalens_set_station_updated_at();

create index if not exists stations_owner_id_idx on public.stations(owner_id);
create index if not exists stations_woreda_idx on public.stations(woreda);

alter table public.stations enable row level security;

drop policy if exists "BunaLens station owners read own station" on public.stations;
create policy "BunaLens station owners read own station"
on public.stations for select to authenticated
using (owner_id = (select auth.uid()));

drop policy if exists "BunaLens station owners create own station" on public.stations;
create policy "BunaLens station owners create own station"
on public.stations for insert to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "BunaLens station owners update own profile" on public.stations;
create policy "BunaLens station owners update own profile"
on public.stations for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

revoke all on public.stations from anon, authenticated;
grant select on public.stations to authenticated;
grant insert (owner_id, station_name, name, owner_name, manager, email, phone, woreda, zone)
  on public.stations to authenticated;
grant update (station_name, name, owner_name, manager, email, phone, woreda, zone)
  on public.stations to authenticated;
