"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const wfetch = require(path.resolve(__dirname, "../../../lib/weather-fetch.js"));

// ---------------------------------------------------------------------------
// buildUrl
// ---------------------------------------------------------------------------

test("buildUrl includes latitude and longitude", function() {
  const url = wfetch.buildUrl(51.5, -0.12);
  assert.ok(url.includes("latitude=51.5"), "lat in url: " + url);
  assert.ok(url.includes("longitude=-0.12"), "lon in url: " + url);
});

test("buildUrl includes required hourly fields", function() {
  const url = wfetch.buildUrl(0, 0);
  assert.ok(url.includes("temperature_2m"), "temperature field");
  assert.ok(url.includes("surface_pressure"), "pressure field");
  assert.ok(url.includes("relative_humidity_2m"), "humidity field");
  assert.ok(url.includes("precipitation"), "precipitation field");
});

test("buildUrl targets open-meteo forecast endpoint", function() {
  const url = wfetch.buildUrl(0, 0);
  assert.ok(url.startsWith("https://api.open-meteo.com"), "open-meteo base url");
  assert.ok(url.includes("forecast_days=1"), "one day forecast");
});

test("buildUrl URL-encodes special characters in coordinates", function() {
  // Negative sign and decimal point — should be safe to pass through but
  // encodeURIComponent must not break the numeric value
  const url = wfetch.buildUrl(-33.87, 151.21);
  assert.ok(url.includes("-33.87") || url.includes("%2D33.87"), "negative lat survives");
});

// ---------------------------------------------------------------------------
// sampleAtHour
// ---------------------------------------------------------------------------

function makeForecast(times, values) {
  return {
    hourly: {
      time: times,
      temperature_2m: values.temperature_2m || [],
      surface_pressure: values.surface_pressure || [],
      relative_humidity_2m: values.humidity || [],
      precipitation: values.precipitation || []
    }
  };
}

test("sampleAtHour returns null for null forecast", function() {
  assert.strictEqual(wfetch.sampleAtHour(null, 1000000), null);
});

test("sampleAtHour returns null for empty time array", function() {
  assert.strictEqual(wfetch.sampleAtHour({ hourly: { time: [] } }, 1000000), null);
});

test("sampleAtHour finds exact match", function() {
  const targetMs = Date.UTC(2024, 0, 1, 12, 0, 0);
  const targetMin = Math.floor(targetMs / 60000);
  const fc = makeForecast(
    [new Date(targetMs).toISOString()],
    { humidity: [72], precipitation: [0.5] }
  );
  const s = wfetch.sampleAtHour(fc, targetMin);
  assert.ok(s !== null, "sample found");
  assert.strictEqual(s.humidity, 72);
  assert.ok(Math.abs(s.precip - 0.5) < 0.01);
});

test("sampleAtHour returns null when closest entry is more than 60 min away", function() {
  const baseMs = Date.UTC(2024, 0, 1, 12, 0, 0);
  const fc = makeForecast(
    [new Date(baseMs).toISOString()],
    { humidity: [50], precipitation: [0] }
  );
  const twoHoursLaterMin = Math.floor(baseMs / 60000) + 120;
  assert.strictEqual(wfetch.sampleAtHour(fc, twoHoursLaterMin), null,
    "no result when drift > 60 min");
});

test("sampleAtHour picks closest of two entries", function() {
  const base = Date.UTC(2024, 0, 1, 12, 0, 0);
  const hour1 = new Date(base).toISOString();             // 12:00
  const hour2 = new Date(base + 3600000).toISOString();   // 13:00
  const fc = makeForecast(
    [hour1, hour2],
    { humidity: [40, 80], precipitation: [0, 1] }
  );
  // Target is 12:50 — closer to 13:00
  const targetMin = Math.floor(base / 60000) + 50;
  const s = wfetch.sampleAtHour(fc, targetMin);
  assert.ok(s !== null, "sample found");
  assert.strictEqual(s.humidity, 80, "picked the 13:00 entry (closer)");
});

test("sampleAtHour extracts all four fields", function() {
  const baseMs = Date.UTC(2024, 0, 1, 12, 0, 0);
  const baseMin = Math.floor(baseMs / 60000);
  const fc = {
    hourly: {
      time: [new Date(baseMs).toISOString()],
      temperature_2m: [15.5],
      surface_pressure: [1012.3],
      relative_humidity_2m: [65],
      precipitation: [0.3]
    }
  };
  const s = wfetch.sampleAtHour(fc, baseMin);
  assert.ok(Math.abs(s.temp - 15.5) < 0.01, "temperature");
  assert.ok(Math.abs(s.pressure - 1012.3) < 0.1, "pressure");
  assert.strictEqual(s.humidity, 65, "humidity");
  assert.ok(Math.abs(s.precip - 0.3) < 0.01, "precipitation");
});

// ---------------------------------------------------------------------------
// fetchForecast error paths
// ---------------------------------------------------------------------------

test("fetchForecast calls onError when GB is not defined", function() {
  // In Node.js environment GB is never defined, so fetchForecast should error out
  var errorReceived = null;
  wfetch.fetchForecast(51.5, -0.1, function() {}, function(err) { errorReceived = err; });
  assert.strictEqual(errorReceived, "no-gb", "error when GB unavailable");
});
