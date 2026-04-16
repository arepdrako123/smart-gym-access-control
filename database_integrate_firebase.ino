#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFi.h>
#include <time.h>

// ===== BLYNK =====
#define BLYNK_TEMPLATE_ID "TMPL6azlkjA8A"
#define BLYNK_TEMPLATE_NAME "smart gym access"
#define BLYNK_AUTH_TOKEN "6h7pnXgCSqZrYQFOCvY4xw_OIxM0NEYe"
#include <BlynkSimpleEsp32.h>

// ===== Firebase (Mobizt) =====
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ====================== WIFI ======================
const char* WIFI_SSID = "iPhone";
const char* WIFI_PASS = "Rahmah44";

// ====================== FIREBASE ======================
#define API_KEY "AIzaSyBEj1XfkbI6yj6g2zvnqE5YUXWCSlwGIoI"
#define DATABASE_URL "https://smart-gym-access-control-default-rtdb.asia-southeast1.firebasedatabase.app/"
#define USER_EMAIL "ismailariff24@gmail.com"
#define USER_PASSWORD "12345678"

// ====================== RFID + HARDWARE ======================
#define SS_PIN     5
#define RST_PIN    4

#define RELAY_PIN  32
#define LED_GREEN  25
#define LED_RED    26
#define BUZZER_PIN 27

#define EXIT_BTN_PIN 13

LiquidCrystal_I2C lcd(0x27, 16, 2);
MFRC522 rfid(SS_PIN, RST_PIN);

#define RELAY_ON   HIGH
#define RELAY_OFF  LOW

const unsigned long OPEN_MS            = 1500;
const unsigned long EXIT_OPEN_MS       = 5000;
const unsigned long DEBOUNCE_MS        = 40;
const unsigned long REMOVE_TIMEOUT_MS  = 1200;
const unsigned long LCD_MSG_MS         = 1200;

const char* allowedUIDs[] = {
  "F9 48 7E 11",
  "E9 3F 98 11",
  "89 8F 89 11",
  "B9 D7 50 12",
  "59 E2 A9 11",
  "29 13 7F 11"
};
const int allowedCount = sizeof(allowedUIDs) / sizeof(allowedUIDs[0]);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long lastBlynkAlert = 0;

// ====================== HELPERS ======================
String uidToString(const MFRC522::Uid &uid) {
  String s;
  for (byte i = 0; i < uid.size; i++) {
    if (uid.uidByte[i] < 0x10) s += "0";
    s += String(uid.uidByte[i], HEX);
    if (i < uid.size - 1) s += " ";
  }
  s.toUpperCase();
  return s;
}

bool isAllowed(const String &uid) {
  if (allowedCount <= 0) return true;
  for (int i = 0; i < allowedCount; i++) {
    if (uid == String(allowedUIDs[i])) return true;
  }
  return false;
}

void buzzerBeep(unsigned long onMs, unsigned long offMs = 0, int times = 1) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(onMs);
    digitalWrite(BUZZER_PIN, LOW);
    delay(offMs);
  }
}

void openDoorMs(unsigned long ms) {
  digitalWrite(RELAY_PIN, RELAY_ON);
  delay(ms);
  digitalWrite(RELAY_PIN, RELAY_OFF);
}

void showWelcomeDoorOpen() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("WELCOME");
  lcd.setCursor(0, 1);
  lcd.print("DOOR OPEN");
}

void showAccessDenied() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("ACCESS DENIED");
  lcd.setCursor(0, 1);
  lcd.print("TRY AGAIN");
}

void showThankYouExit() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("THANK YOU");
  lcd.setCursor(0, 1);
  lcd.print("SEE YOU");
}

long getTimestamp() {
  return (long)time(nullptr);
}

bool pushTapLog(const String &uid, const String &status) {
  FirebaseJson json;
  json.set("time", getTimestamp());
  json.set("uid", uid);
  json.set("status", status);

  return Firebase.RTDB.pushJSON(&fbdo, "/tap_logs", &json);
}

// ====================== SETUP ======================
void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);
  pinMode(LED_RED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(EXIT_BTN_PIN, INPUT_PULLUP);

  digitalWrite(RELAY_PIN, RELAY_OFF);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();

  SPI.begin();
  rfid.PCD_Init();

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  // BLYNK CONNECT
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);

  Blynk.config(BLYNK_AUTH_TOKEN);
  Blynk.connect(1000); // max 1s je

  configTime(28800, 0, "pool.ntp.org");

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("READY 🔥");
}

// ====================== LOOP ======================
bool lastBtn = HIGH;
unsigned long lastBtnChange = 0;

void loop() {
  Blynk.run();

  // ===== EXIT BUTTON =====
  if (digitalRead(EXIT_BTN_PIN) == LOW) {

    digitalWrite(LED_GREEN, HIGH);
    buzzerBeep(100);

    showThankYouExit();
    digitalWrite(RELAY_PIN, RELAY_ON);

    unsigned long t = millis();
    while (millis() - t < EXIT_OPEN_MS) {
      Blynk.run();
    }

    digitalWrite(RELAY_PIN, RELAY_OFF);
    digitalWrite(LED_GREEN, LOW);

    lcd.clear();

    pushTapLog("NONE", "EXIT");

    delay(200); // debounce
  }

  // ===== RFID =====
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  String uid = uidToString(rfid.uid);
  Serial.println(uid);

  bool ok = isAllowed(uid);

  if (ok) {
    showWelcomeDoorOpen();

    digitalWrite(LED_GREEN, HIGH);
    buzzerBeep(100);

    digitalWrite(RELAY_PIN, RELAY_ON);

    unsigned long t = millis();
    while (millis() - t < OPEN_MS) {
      Blynk.run();
    }

    digitalWrite(RELAY_PIN, RELAY_OFF);
    digitalWrite(LED_GREEN, LOW);

    pushTapLog(uid, "GRANTED");

  } else {
    showAccessDenied();

    digitalWrite(LED_RED, HIGH);
    buzzerBeep(100);

    delay(500);

    digitalWrite(LED_RED, LOW);

    pushTapLog(uid, "DENIED");
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}