// LEGACY / OPTIONAL HARDWARE MODE
// The current KAAPAAN demo uses the PHONE as the ambulance GPS transmitter.
// This ESP32 + NEO-6M sketch is retained only if you later want a dedicated
// ambulance hardware transmitter. It is NOT required for the phone demo.

#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>

// ================================================================
// KAAPAAN - AMBULANCE GPS UNIT
// NEO-6M -> ESP32 -> Existing Ambulance Tracker Website
// ================================================================

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Use the laptop's LAN IP, NOT localhost.
// Example: http://192.168.1.10:3000/api/gps
const char* SERVER_URL = "http://YOUR_LAPTOP_IP:3000/api/gps";

const char* VEHICLE_ID = "AMB001";

TinyGPSPlus gps;
HardwareSerial GPSserial(2);

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 1000;

void setup() {
  Serial.begin(115200);

  // NEO-6M TX -> ESP32 GPIO16 (RX)
  // NEO-6M RX -> ESP32 GPIO17 (TX)
  GPSserial.begin(9600, SERIAL_8N1, 16, 17);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi connected");
  Serial.print("ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  while (GPSserial.available()) {
    gps.encode(GPSserial.read());
  }

  if (millis() - lastSend < SEND_INTERVAL_MS) return;
  lastSend = millis();

  if (!gps.location.isValid()) {
    Serial.println("Waiting for valid GPS fix...");
    return;
  }

  double latitude = gps.location.lat();
  double longitude = gps.location.lng();
  double speedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0.0;

  sendGPS(latitude, longitude, speedKmh);
}

void sendGPS(double latitude, double longitude, double speedKmh) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  String json = "{";
  json += "\"vehicleId\":\"" + String(VEHICLE_ID) + "\",";
  json += "\"displayName\":\"Kaapaan Ambulance " + String(VEHICLE_ID) + "\",";
  json += "\"deviceName\":\"ESP32 + NEO-6M\",";
  json += "\"latitude\":" + String(latitude, 6) + ",";
  json += "\"longitude\":" + String(longitude, 6) + ",";
  json += "\"speed\":" + String(speedKmh, 2);
  json += "}";

  int code = http.POST(json);

  Serial.print("GPS sent | HTTP ");
  Serial.println(code);

  http.end();
}
