// BunaLens warehouse zone sensor: ESP32 or ESP32-C3 with a DHT22.
//
// STATUS: written during the hackathon sprint. NOT compiled and NOT run on
// hardware. Treat it as a starting point that still needs bench testing.
//
// One device per warehouse zone. It reports air temperature (degrees Celsius)
// and relative humidity (percent) for the zone. It does not measure bean
// moisture.
//
// Libraries: "DHT sensor library" by Adafruit, plus the ESP32 Arduino core.
// Fill in secrets.h (never commit it):
//   #define WIFI_SSID "..."
//   #define WIFI_PASSWORD "..."
//   #define BUNALENS_API_URL "https://<project>.supabase.co/rest/v1/rpc/bunalens_ingest_device_reading"
//   #define BUNALENS_API_KEY "<publishable key>"
//   #define DEVICE_UID "esp32-zone-a"
//   #define DEVICE_TOKEN "<token shown once when the device was registered>"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <DHT.h>
#include <time.h>
#include "secrets.h"

#define DHT_PIN 4
#define REPORT_INTERVAL_MS 300000UL  // 5 minutes; the app marks 30 minutes as stale

DHT dht(DHT_PIN, DHT22);
Preferences prefs;
uint32_t sequence = 0;

void setup() {
  Serial.begin(115200);
  dht.begin();
  prefs.begin("bunalens", false);
  sequence = prefs.getUInt("seq", 0);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  configTime(0, 0, "pool.ntp.org");  // UTC, needed for the capture timestamp
}

// Sends one message. The same message id is reused on every retry, so the
// server stores the reading once even if the response was lost.
bool sendReading(uint32_t seq, const char* recordedAt, float temperatureC, float humidityPct) {
  WiFiClientSecure client;
  client.setInsecure();  // TODO before field use: pin the server root certificate
  HTTPClient http;
  if (!http.begin(client, BUNALENS_API_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", BUNALENS_API_KEY);
  http.addHeader("x-device-token", DEVICE_TOKEN);
  char body[384];
  snprintf(body, sizeof(body),
    "{\"p_device_uid\":\"%s\",\"p_message_id\":\"%s-%lu\",\"p_recorded_at\":\"%s\","
    "\"p_temperature_c\":%.2f,\"p_temperature_unit\":\"C\","
    "\"p_humidity_pct\":%.2f,\"p_humidity_unit\":\"%%RH\",\"p_source\":\"live\"}",
    DEVICE_UID, DEVICE_UID, (unsigned long)seq, recordedAt, temperatureC, humidityPct);
  int status = http.POST(body);
  http.end();
  return status == 200;  // both "stored" and "duplicate" mean the server has it
}

void loop() {
  struct tm now;
  float humidityPct = dht.readHumidity();
  float temperatureC = dht.readTemperature();
  // Skip the cycle rather than send a bad value or a wrong time.
  if (isnan(humidityPct) || isnan(temperatureC) || !getLocalTime(&now) || now.tm_year < 120) {
    delay(10000);
    return;
  }
  char recordedAt[25];
  strftime(recordedAt, sizeof(recordedAt), "%Y-%m-%dT%H:%M:%SZ", &now);
  uint32_t seq = sequence + 1;
  for (int attempt = 0; attempt < 5; attempt++) {
    if (WiFi.status() == WL_CONNECTED && sendReading(seq, recordedAt, temperatureC, humidityPct)) {
      sequence = seq;
      prefs.putUInt("seq", sequence);
      break;
    }
    delay(5000 * (attempt + 1));
  }
  delay(REPORT_INTERVAL_MS);
}
