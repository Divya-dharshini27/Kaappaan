/*
  Ambulancy — ESP32 LED Web Server
  ─────────────────────────────────
  GPIO 2  → LED / Red Light (built-in or external)

  The ESP32 hosts a tiny HTTP server.
  Flask calls these endpoints:
    GET  /led/status  → { "status": "on" } or { "status": "off" }
    POST /led/on      → turns LED ON,  returns { "status": "on" }
    POST /led/off     → turns LED OFF, returns { "status": "off" }
*/

#include <WiFi.h>
#include <WebServer.h>
#include <ArduinoJson.h>   // Install via Library Manager: "ArduinoJson" by Benoit Blanchon

// ── WiFi credentials ──────────────────────────────────────────────────────────
const char* WIFI_SSID     = "raaj8989_5GHz";   // <-- change this
const char* WIFI_PASSWORD = "smart@1234";   // <-- change this

// ── Pin config ────────────────────────────────────────────────────────────────
const int LED_PIN = 2;   // GPIO2 = built-in LED on most ESP32 boards
                          // Change to your GPIO pin if using external LED

// ── Web server on port 80 ─────────────────────────────────────────────────────
WebServer server(80);

bool ledState = false;

// ── Helper: send JSON response ────────────────────────────────────────────────
void sendJson(int code, const char* status) {
  StaticJsonDocument<64> doc;
  doc["status"] = status;
  String body;
  serializeJson(doc, body);
  server.sendHeader("Access-Control-Allow-Origin", "*");  // allow Flask to call
  server.send(code, "application/json", body);
}

// ── Route handlers ────────────────────────────────────────────────────────────
void handleLedStatus() {
  sendJson(200, ledState ? "on" : "off");
}

void handleLedOn() {
  ledState = true;
  digitalWrite(LED_PIN, HIGH);
  Serial.println("[LED] Turned ON");
  sendJson(200, "on");
}

void handleLedOff() {
  ledState = false;
  digitalWrite(LED_PIN, LOW);
  Serial.println("[LED] Turned OFF");
  sendJson(200, "off");
}

void handleNotFound() {
  server.send(404, "application/json", "{\"error\":\"not found\"}");
}

// ── Setup ─────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Connect to WiFi
  Serial.printf("\nConnecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n[WiFi] Connected!");
  Serial.print("[WiFi] ESP32 IP Address: ");
  Serial.println(WiFi.localIP());   // <-- COPY THIS IP into your Flask config

  // Register routes
  server.on("/led/status", HTTP_GET,  handleLedStatus);
  server.on("/led/on",     HTTP_POST, handleLedOn);
  server.on("/led/off",    HTTP_POST, handleLedOff);
  server.onNotFound(handleNotFound);

  server.begin();
  Serial.println("[Server] ESP32 HTTP server started on port 80");
}

// ── Loop ──────────────────────────────────────────────────────────────────────
void loop() {
  server.handleClient();
}
