#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ================================================================
// KAAPAAN - TRAFFIC SIGNAL UNIT
// Website decides RED/YELLOW/GREEN and this ESP32 displays it.
// ================================================================

const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Same laptop/server as the website.
// Example: http://192.168.1.10:3000/api/signal
const char* SIGNAL_URL = "http://YOUR_LAPTOP_IP:3000/api/signal";

#define RED_LED 32
#define YELLOW_LED 33
#define GREEN_LED 4

LiquidCrystal_I2C lcd(0x27, 20, 4);

String currentState = "RED";
unsigned long lastPoll = 0;
const unsigned long POLL_INTERVAL_MS = 500;

void setup() {
  Serial.begin(115200);

  pinMode(RED_LED, OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(GREEN_LED, OUTPUT);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();

  // Safe/default state.
  showRed();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWi-Fi connected");
  Serial.print("Traffic ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    pollSignal();
  }
}

void pollSignal() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(SIGNAL_URL);

  int code = http.GET();

  if (code == 200) {
    String payload = http.getString();

    String state = jsonValue(payload, "state");
    String message = jsonValue(payload, "message");

    if (state == "RED" || state == "YELLOW" || state == "GREEN") {
      updateSignal(state, message);
    }
  }

  http.end();
}

// Minimal JSON string extraction; no ArduinoJson library required.
String jsonValue(const String& json, const String& key) {
  String search = "\"" + key + "\"";
  int keyPos = json.indexOf(search);
  if (keyPos < 0) return "";

  int colon = json.indexOf(':', keyPos + search.length());
  if (colon < 0) return "";

  int firstQuote = json.indexOf('"', colon + 1);
  if (firstQuote < 0) return "";

  int secondQuote = json.indexOf('"', firstQuote + 1);
  if (secondQuote < 0) return "";

  return json.substring(firstQuote + 1, secondQuote);
}

void updateSignal(String state, String message) {
  if (state == currentState) return;

  currentState = state;

  if (state == "RED") {
    showRed();
  } else if (state == "YELLOW") {
    showYellow();
  } else {
    showGreen();
  }

  Serial.print("Signal: ");
  Serial.print(state);
  Serial.print(" | ");
  Serial.println(message);
}

void showRed() {
  digitalWrite(RED_LED, HIGH);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, LOW);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("TRAFFIC SIGNAL");
  lcd.setCursor(0, 1);
  lcd.print("RED");
  lcd.setCursor(0, 2);
  lcd.print("No ambulance");
  lcd.setCursor(0, 3);
  lcd.print("on the way");
}

void showYellow() {
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, HIGH);
  digitalWrite(GREEN_LED, LOW);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AMBULANCE");
  lcd.setCursor(0, 1);
  lcd.print("APPROACHING");
  lcd.setCursor(0, 2);
  lcd.print("WARNING");
  lcd.setCursor(0, 3);
  lcd.print("750m ALERT");
}

void showGreen() {
  digitalWrite(RED_LED, LOW);
  digitalWrite(YELLOW_LED, LOW);
  digitalWrite(GREEN_LED, HIGH);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("GREEN SIGNAL");
  lcd.setCursor(0, 1);
  lcd.print("TRIGGERED");
  lcd.setCursor(0, 2);
  lcd.print("AMBULANCE");
  lcd.setCursor(0, 3);
  lcd.print("ON THE WAY");
}
