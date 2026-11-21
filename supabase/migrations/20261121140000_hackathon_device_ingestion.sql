-- BunaLens hackathon sprint: lot registration, zone storage and device
-- ingestion write paths. Additive only; builds on
-- 20261121134500_hackathon_lot_to_order_foundation.sql.
--
-- A warehouse sensor reports air temperature and relative humidity for a
-- zone. These are storage conditions. They are not bean moisture, and they
-- say nothing about defects, bean size or ripeness.

begin;

-- The station owned by the signed-in user (the app has one per account).
create or replace function public.bunalens_my_station_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.stations s
   where s.owner_id = (select auth.uid())
   order by s.created_at
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Register a lot before any photo exists. Safe to retry with the same key.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_register_lot(
  p_idempotency_key text,
  p_sample_type text,
  p_woreda text,
  p_lot_weight_kg numeric,
  p_farmer_name text,
  p_farmer_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station uuid;
  v_row public.coffee_batches%rowtype;
  v_existing boolean := false;
  v_try integer := 0;
begin
  v_station := public.bunalens_my_station_id();
  if v_station is null then
    raise exception 'A registered station is required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[a-zA-Z0-9_-]{8,128}$' then
    raise exception 'Invalid idempotency key' using errcode = '22023';
  end if;
  if p_sample_type is null or p_sample_type not in ('red_cherry', 'green_bean') then
    raise exception 'Invalid sample type' using errcode = '22023';
  end if;
  if p_lot_weight_kg is null or p_lot_weight_kg <= 0 or p_lot_weight_kg > 100000 then
    raise exception 'Invalid lot weight' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_farmer_name, '')), '') is null then
    raise exception 'Farmer name is required' using errcode = '22023';
  end if;

  select * into v_row from public.coffee_batches
   where station_id = v_station and idempotency_key = p_idempotency_key;
  if found then
    v_existing := true;
  else
    loop
      begin
        insert into public.coffee_batches(
          id, batch_code, station_id, idempotency_key, sample_type, woreda,
          lot_weight_kg, grading_status, farmer_name, farmer_phone
        )
        values (
          'lot_' || replace(gen_random_uuid()::text, '-', ''),
          'BNL-JMA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4)),
          v_station, p_idempotency_key, p_sample_type, p_woreda,
          p_lot_weight_kg, 'queued', btrim(p_farmer_name),
          nullif(btrim(coalesce(p_farmer_phone, '')), '')
        )
        returning * into v_row;
        exit;
      exception when unique_violation then
        -- Batch code collision, or a concurrent retry of the same key.
        select * into v_row from public.coffee_batches
         where station_id = v_station and idempotency_key = p_idempotency_key;
        if found then v_existing := true; exit; end if;
        v_try := v_try + 1;
        if v_try > 5 then raise; end if;
      end;
    end loop;
  end if;

  return jsonb_build_object(
    'already_registered', v_existing,
    'lot', jsonb_build_object(
      'id', v_row.id, 'batch_code', v_row.batch_code, 'station_id', v_row.station_id,
      'sample_type', v_row.sample_type, 'woreda', v_row.woreda,
      'lot_weight_kg', v_row.lot_weight_kg, 'grading_status', v_row.grading_status,
      'eligibility_status', v_row.eligibility_status, 'farmer_name', v_row.farmer_name,
      'verification_id', v_row.verification_id, 'created_at', v_row.created_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Create a warehouse zone with its one device. The device token is returned
-- once and only its SHA-256 hash is stored.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_create_zone_device(
  p_zone_name text,
  p_device_uid text,
  p_label text default null,
  p_is_simulated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_station uuid;
  v_zone uuid;
  v_device uuid;
  v_token text;
begin
  v_station := public.bunalens_my_station_id();
  if v_station is null then
    raise exception 'A registered station is required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_zone_name, '')), '') is null then
    raise exception 'Zone name is required' using errcode = '22023';
  end if;
  if p_device_uid is null or p_device_uid !~ '^[A-Za-z0-9:_-]{4,64}$' then
    raise exception 'Invalid device identifier' using errcode = '22023';
  end if;

  insert into public.warehouse_zones(station_id, name)
  values (v_station, btrim(p_zone_name))
  on conflict (station_id, name) do update set name = excluded.name
  returning id into v_zone;

  if exists (select 1 from public.station_devices where zone_id = v_zone and is_active) then
    raise exception 'This zone already has an active device' using errcode = '23505';
  end if;
  if exists (select 1 from public.station_devices where device_uid = p_device_uid) then
    raise exception 'Device identifier is already registered' using errcode = '23505';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.station_devices(station_id, zone_id, device_uid, token_hash, label, is_simulated)
  values (v_station, v_zone, p_device_uid,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          nullif(btrim(coalesce(p_label, '')), ''), coalesce(p_is_simulated, false))
  returning id into v_device;

  return jsonb_build_object(
    'zone_id', v_zone, 'zone_name', btrim(p_zone_name),
    'device_id', v_device, 'device_uid', p_device_uid,
    'is_simulated', coalesce(p_is_simulated, false),
    'device_token', v_token,
    'token_note', 'Shown once. Store it on the device only.'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Move a lot into a zone (or out of storage with a null zone). The previous
-- storage interval is closed, so readings keep their original lot window.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_assign_lot_zone(p_batch_id text, p_zone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot_station uuid;
  v_zone_station uuid;
  v_open public.lot_zone_assignments%rowtype;
  v_new public.lot_zone_assignments%rowtype;
begin
  select station_id into v_lot_station from public.coffee_batches where id = p_batch_id;
  if not found or not public.bunalens_owns_station(v_lot_station) then
    raise exception 'Lot access denied' using errcode = '42501';
  end if;
  if p_zone_id is not null then
    select station_id into v_zone_station from public.warehouse_zones where id = p_zone_id;
    if not found or v_zone_station <> v_lot_station then
      raise exception 'Zone does not belong to the station that holds this lot' using errcode = '42501';
    end if;
  end if;

  select * into v_open from public.lot_zone_assignments
   where batch_id = p_batch_id and released_at is null
   for update;
  if found and v_open.zone_id = p_zone_id then
    return jsonb_build_object('changed', false, 'assignment_id', v_open.id,
                              'zone_id', v_open.zone_id, 'assigned_at', v_open.assigned_at);
  end if;
  if found then
    update public.lot_zone_assignments set released_at = now() where id = v_open.id;
  end if;
  if p_zone_id is null then
    return jsonb_build_object('changed', v_open.id is not null, 'assignment_id', null, 'zone_id', null);
  end if;

  insert into public.lot_zone_assignments(batch_id, zone_id, station_id, assigned_by)
  values (p_batch_id, p_zone_id, v_lot_station, (select auth.uid()))
  returning * into v_new;
  return jsonb_build_object('changed', true, 'assignment_id', v_new.id,
                            'zone_id', v_new.zone_id, 'assigned_at', v_new.assigned_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Device ingestion. Called over HTTPS as POST /rest/v1/rpc/bunalens_ingest_device_reading
-- with the project's public API key and the device token in the
-- x-device-token header. The device has no user session.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_ingest_device_reading(
  p_device_uid text,
  p_message_id text,
  p_recorded_at timestamptz,
  p_temperature_c numeric,
  p_humidity_pct numeric,
  p_temperature_unit text default null,
  p_humidity_unit text default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers json;
  v_token text;
  v_device public.station_devices%rowtype;
  v_reading uuid;
  v_duplicate boolean := false;
  v_source text;
  v_lot_count integer;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_headers := null;
  end;
  v_token := v_headers ->> 'x-device-token';

  -- One message for every identity failure, so a caller cannot learn which
  -- device identifiers exist.
  if v_token is null or length(v_token) < 32 or p_device_uid is null then
    raise exception 'Device authentication failed' using errcode = '42501';
  end if;
  select * into v_device from public.station_devices where device_uid = p_device_uid;
  if not found
     or not v_device.is_active
     or v_device.token_hash <> encode(sha256(convert_to(v_token, 'UTF8')), 'hex') then
    raise exception 'Device authentication failed' using errcode = '42501';
  end if;

  if p_message_id is null or p_message_id !~ '^[A-Za-z0-9:_.-]{1,128}$' then
    raise exception 'Invalid message_id' using errcode = '22023';
  end if;
  if p_temperature_unit is distinct from 'C' then
    raise exception 'temperature_unit must be "C" (degrees Celsius)' using errcode = '22023';
  end if;
  if p_humidity_unit is distinct from '%RH' then
    raise exception 'humidity_unit must be "%%RH" (relative humidity in percent)' using errcode = '22023';
  end if;
  if p_temperature_c is null or not (p_temperature_c between -40 and 85) then
    raise exception 'temperature_c is outside the plausible sensor range of -40 to 85' using errcode = '22023';
  end if;
  if p_humidity_pct is null or not (p_humidity_pct between 0 and 100) then
    raise exception 'humidity_pct must be between 0 and 100' using errcode = '22023';
  end if;
  if p_recorded_at is null then
    raise exception 'recorded_at is required' using errcode = '22023';
  end if;
  if p_recorded_at > now() + interval '5 minutes' then
    raise exception 'recorded_at is in the future' using errcode = '22023';
  end if;
  if p_recorded_at < now() - interval '7 days' then
    raise exception 'recorded_at is older than 7 days' using errcode = '22023';
  end if;
  if p_source is not null and p_source not in ('live', 'simulated') then
    raise exception 'source must be "live" or "simulated"' using errcode = '22023';
  end if;

  -- A device registered as simulated can never produce a live reading.
  v_source := case when v_device.is_simulated or p_source = 'simulated' then 'simulated' else 'live' end;

  insert into public.device_readings(
    device_id, zone_id, station_id, message_id, recorded_at,
    temperature_c, humidity_pct, source
  )
  values (
    v_device.id, v_device.zone_id, v_device.station_id, p_message_id, p_recorded_at,
    round(p_temperature_c, 2), round(p_humidity_pct, 2), v_source
  )
  on conflict (device_id, message_id) do nothing
  returning id into v_reading;

  if v_reading is null then
    v_duplicate := true;
    select id, source into v_reading, v_source from public.device_readings
     where device_id = v_device.id and message_id = p_message_id;
  else
    update public.station_devices set last_seen_at = now() where id = v_device.id;
  end if;

  select count(*) into v_lot_count from public.lot_zone_assignments a
   where a.zone_id = v_device.zone_id
     and a.assigned_at <= p_recorded_at
     and (a.released_at is null or a.released_at >= p_recorded_at);

  return jsonb_build_object(
    'status', case when v_duplicate then 'duplicate' else 'stored' end,
    'reading_id', v_reading,
    'source', v_source,
    'received_at', now(),
    'applicable_lot_count', v_lot_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Latest applicable reading for a lot, with freshness. Runs with the
-- caller's own access, so RLS decides what it can see.
-- ---------------------------------------------------------------------------
create or replace function public.bunalens_lot_environment(p_batch_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_stale_after constant integer := 30;
  v_a record;
  v_d record;
  v_r record;
  v_count integer;
  v_age numeric;
  v_state text;
  v_note constant text := 'Warehouse air temperature and relative humidity for the storage zone. This is not a bean moisture measurement.';
begin
  select a.id, a.zone_id, a.assigned_at, a.released_at, z.name as zone_name
    into v_a
    from public.lot_zone_assignments a
    join public.warehouse_zones z on z.id = a.zone_id
   where a.batch_id = p_batch_id
   order by a.assigned_at desc
   limit 1;
  if not found then
    return jsonb_build_object('batch_id', p_batch_id, 'state', 'no_zone',
      'stale_after_minutes', v_stale_after, 'reading_count', 0,
      'checked_at', now(), 'note', v_note);
  end if;

  select d.device_uid, d.label, d.is_simulated, d.last_seen_at
    into v_d
    from public.station_devices d
   where d.zone_id = v_a.zone_id and d.is_active
   limit 1;

  -- Only readings captured while the lot was stored in the zone apply.
  select r.id, r.recorded_at, r.received_at, r.temperature_c, r.humidity_pct, r.source
    into v_r
    from public.device_readings r
   where r.zone_id = v_a.zone_id
     and r.recorded_at >= v_a.assigned_at
     and (v_a.released_at is null or r.recorded_at <= v_a.released_at)
   order by r.recorded_at desc
   limit 1;

  select count(*) into v_count
    from public.device_readings r
   where r.zone_id = v_a.zone_id
     and r.recorded_at >= v_a.assigned_at
     and (v_a.released_at is null or r.recorded_at <= v_a.released_at);

  if v_r.id is null then
    v_state := 'no_reading';
  else
    v_age := round((extract(epoch from (now() - v_r.recorded_at)) / 60)::numeric, 1);
    v_state := case
      when v_a.released_at is not null then 'storage_ended'
      when v_age > v_stale_after then 'stale'
      else 'fresh'
    end;
  end if;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'state', v_state,
    'stale_after_minutes', v_stale_after,
    'zone', jsonb_build_object('id', v_a.zone_id, 'name', v_a.zone_name),
    'storage', jsonb_build_object('assigned_at', v_a.assigned_at, 'released_at', v_a.released_at),
    'device', case when v_d.device_uid is null then null else jsonb_build_object(
      'device_uid', v_d.device_uid, 'label', v_d.label,
      'is_simulated', v_d.is_simulated, 'last_seen_at', v_d.last_seen_at) end,
    'reading', case when v_r.id is null then null else jsonb_build_object(
      'recorded_at', v_r.recorded_at, 'received_at', v_r.received_at,
      'temperature_c', v_r.temperature_c, 'temperature_unit', 'C',
      'humidity_pct', v_r.humidity_pct, 'humidity_unit', '%RH',
      'source', v_r.source, 'age_minutes', v_age) end,
    'reading_count', v_count,
    'checked_at', now(),
    'note', v_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.bunalens_my_station_id() from public, anon;
revoke all on function public.bunalens_register_lot(text, text, text, numeric, text, text) from public, anon;
revoke all on function public.bunalens_create_zone_device(text, text, text, boolean) from public, anon;
revoke all on function public.bunalens_assign_lot_zone(text, uuid) from public, anon;
revoke all on function public.bunalens_lot_environment(text) from public, anon;
revoke all on function public.bunalens_ingest_device_reading(text, text, timestamptz, numeric, numeric, text, text, text) from public;

grant execute on function public.bunalens_my_station_id() to authenticated, service_role;
grant execute on function public.bunalens_register_lot(text, text, text, numeric, text, text) to authenticated;
grant execute on function public.bunalens_create_zone_device(text, text, text, boolean) to authenticated;
grant execute on function public.bunalens_assign_lot_zone(text, uuid) to authenticated;
grant execute on function public.bunalens_lot_environment(text) to authenticated, service_role;
-- Devices call with the public API key only, so anon must be able to execute.
grant execute on function public.bunalens_ingest_device_reading(text, text, timestamptz, numeric, numeric, text, text, text) to anon, authenticated, service_role;

commit;
