# Warehouse Device Ingestion and Lot Traceability (Phase 3)

Written 2026-11-21. Everything here was exercised on the local Supabase test
stack only. No physical device was available, so every reading so far is
simulated and labelled as such.

## Model

```text
ESP32 + temperature/humidity sensor  ->  one warehouse zone of one station
warehouse zone                       ->  lots stored there, each with a storage interval
lot (coffee_batches.id)              ->  readings captured in its zone during its interval
```

One device per zone, one zone for the demonstration. A zone can hold several
lots. A lot is in at most one zone at a time. Moving a lot closes its storage
interval, so a reading stays attached only to the lots that were in the zone
when it was captured.

The sensor reports warehouse air temperature and relative humidity. That is a
storage condition. It is not bean moisture, and it says nothing about defects,
bean size or ripeness. The lot screen and the API response both say so.

## Ingestion request

Devices use the existing backend's HTTP API. There is no separate service.

```text
POST {SUPABASE_URL}/rest/v1/rpc/bunalens_ingest_device_reading
apikey: <public anon or publishable key>
x-device-token: <device token, shown once when the device is registered>
Content-Type: application/json
```

```json
{
  "p_device_uid": "esp32-sim-zone-a",
  "p_message_id": "sim-zone-a-000001",
  "p_recorded_at": "2026-11-21T11:00:07Z",
  "p_temperature_c": 22.4,
  "p_temperature_unit": "C",
  "p_humidity_pct": 61.5,
  "p_humidity_unit": "%RH",
  "p_source": "simulated"
}
```

| Field | Rule |
|---|---|
| `p_device_uid` | Must be a registered, active device, and the token must be that device's token |
| `p_message_id` | Chosen by the device, 1 to 128 characters. A retry must reuse it |
| `p_recorded_at` | Capture time on the device, ISO 8601. Not more than 5 minutes in the future, not older than 7 days |
| `p_temperature_c`, `p_temperature_unit` | Unit must be exactly `C`. Value from -40 to 85 |
| `p_humidity_pct`, `p_humidity_unit` | Unit must be exactly `%RH`. Value from 0 to 100 |
| `p_source` | Optional, `live` or `simulated`. A device registered as simulated always produces `simulated`, whatever it sends |

The server adds the receive time, the station and the zone from the device
record. The device cannot choose them.

| Response | Meaning |
|---|---|
| `200` `{"status":"stored", "reading_id", "source", "received_at", "applicable_lot_count"}` | Stored |
| `200` `{"status":"duplicate", ...}` with the same `reading_id` | This device already sent this message id. Nothing new was stored |
| `401` | Missing token, wrong token, unknown or inactive device, or a token used with another device's identifier. The message is the same in every case |
| `400` | Wrong unit, value out of range, bad timestamp or bad message id |

`applicable_lot_count` is the number of lots stored in the zone at the capture
time. A reading with no applicable lot is still kept as a zone record, and is
not shown on any lot.

Duplicates are prevented by a unique constraint on device and message id in
`device_readings`, not by application logic.

## Device secrets

- The token is generated in the database and returned once by
  `bunalens_create_zone_device`. Only its SHA-256 hash is stored.
- Clients have no read access to the hash column, and no response of the lot
  functions contains it.
- The demo device token lives in the ignored `.env.backend` file as
  `BUNALENS_DEMO_DEVICE_TOKEN`. The scripts never print it.
- Listings and other public responses do not reference devices at all.

## Server functions

All are in
`supabase/migrations/20261121140000_hackathon_device_ingestion.sql`.

| Function | Caller | What it does |
|---|---|---|
| `bunalens_register_lot` | Station owner | Creates the lot (`coffee_batches`, status `queued`) with farmer name, type, woreda and weight. Retrying with the same key returns the same lot |
| `bunalens_create_zone_device` | Station owner | Creates a zone and its one device, returns the token once |
| `bunalens_assign_lot_zone` | Station owner | Stores a lot in a zone of the same station, closing any previous interval |
| `bunalens_ingest_device_reading` | Device | Validates and stores a reading, as described above |
| `bunalens_lot_environment` | Owner, reviewer, admin | Latest applicable reading for a lot with units, capture time, zone, device, source and state |

`bunalens_lot_environment` returns one of these states:

| State | Meaning | Lot screen |
|---|---|---|
| `no_zone` | The lot is not stored in a monitored zone | "Not in a monitored zone", with zones to store it in |
| `no_reading` | In a zone, but no reading since it was stored | "No reading yet" |
| `fresh` | Latest reading is at most 30 minutes old | "Up to date" |
| `stale` | Latest reading is older than 30 minutes | "Stale reading" with a warning |
| `storage_ended` | The lot has left the zone | Last reading from its storage period |

## Lot screen

`app/batch/[id].tsx` now shows the lot ID and a "Warehouse conditions" card
(`components/LotEnvironmentCard.tsx`, data access in `services/lots.ts`):
temperature in °C, relative humidity in % RH, capture time and age, device
identifier and zone, a "Live sensor" or "Simulated" source, a
"SIMULATED DATA — not from a physical sensor" banner, and the state badge.

The screen also loads a lot from the cloud when it is not in the device's
local history, and marks a lot that has no photo assessment yet so that the
placeholder quality figures are not read as results.

## Demonstration without hardware

Fixture, labelled as simulated:
`supabase/fixtures/device/simulated_reading.json`.

```powershell
# once: creates the demo seller, station, "Zone A", simulated device and demo lot,
# stores the device token in .env.backend, and runs the checks
node scripts/hackathon/verify-device-ingestion.mjs

# replay the fixture through the same HTTP path a device uses
node scripts/hackathon/replay-device-reading.mjs
# run it again: the second run reports "duplicate" with the same reading id
node scripts/hackathon/replay-device-reading.mjs
# send a new message
node scripts/hackathon/replay-device-reading.mjs --message-id sim-zone-a-000002
```

Both scripts read `.env.backend` and refuse any URL that is not a local test
stack. The demo lot ID is stored there as `BUNALENS_DEMO_LOT_ID`; open
`/batch/<that id>` while signed in as `demo-seller@bunalens.test`.

## Checks run

| Check | How | Result |
|---|---|---|
| Migration applies, and applies a second time | `psql` on the local test database | Passed |
| 31 API checks with normal user sessions and device tokens | `node scripts/hackathon/verify-device-ingestion.mjs` | All passed |
| Correct lot and zone association | A reading captured 90 minutes ago applied to the lot stored 3 hours ago and not to the lot stored just now; a current reading applied to both | Passed |
| Duplicate replay | Same message sent twice: second answer `duplicate`, same reading id, one row | Passed, also with the fixture replay command |
| Unauthorized device | No token, wrong token, valid token with another device's identifier | 401 each |
| Unauthorized association | Another seller storing this station's lot; a lot stored in another station's zone | 403 each |
| Bad payload | Fahrenheit unit, humidity 140, temperature 300, future capture time | 400 each |
| Privacy | Another seller reads no readings; anonymous caller refused; token hash unreadable; no token in responses | Passed |
| Simulated labelling | A simulated device sending `live` is stored as `simulated` | Passed |
| Lot screen in a browser | Signed in to the web app on the local stack with a throwaway account and opened three lots | Fresh: "Up to date", simulated banner, 22.4 °C, 61.5 % RH, capture time, device and zone. Stale: "Stale reading" with the 30-minute warning. No zone: "Not in a monitored zone" with zones offered |
| `npm run typecheck` | local | Passed |

The stale cases needed one privileged test step: a storage interval was
backdated by 3 hours with the local service role, because the application has
no way to backdate storage.

## Limitations

- No real device message has been ingested. There are no `live` readings.
- `hardware/esp32_zone_sensor/esp32_zone_sensor.ino` has not been compiled or
  run. It also skips TLS certificate checking, which must be fixed before
  field use.
- The "Store lot in" buttons on the lot screen were rendered but not clicked
  in the browser; the function behind them was checked through the API.
- The "No reading yet" state was checked through the API, not in the browser.
- There is no screen yet for registering a lot or for creating a zone and
  device. Both exist as server functions used by the scripts.
- Lots registered at the station appear at `/batch/<id>` but not in the
  batches list, which still reads local history only.
- New screen text is English only; Afaan Oromo strings were not added.
- The 30-minute stale threshold and the 7-day maximum message age are fixed
  in the database functions.
- There is no rate limiting on the ingestion endpoint and no way to rotate a
  device token other than registering a new device.
- A device clock that is wrong by less than the allowed limits is accepted as
  sent. The receive time is stored next to it for comparison.
