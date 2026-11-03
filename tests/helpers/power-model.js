"use strict";

// Rough battery cost of an app's background work, from counts a test harness
// collects. Currents are from the power table in CLAUDE.md; the per-callback
// CPU times are assumptions (Espruino runs a small handler in about a
// millisecond) and deliberately on the high side.

const MA = {
  idle: 0.15,        // idle, accelerometer polled at 1.25 Hz (power-save)
  accelFast: 0.15,   // extra for polling at 12.5 Hz (0.3 mA vs 0.15 mA)
  cpu: 3             // extra for 100% CPU running JavaScript
};

const CPU_MS = {
  tap: 3,            // a "tap" event through the engine
  accel: 1,          // one 12.5 Hz sample handled
  timer: 1,          // a timer callback
  draw: 10           // a widget redraw
};

// counts: {taps, accel, timers, draws, fastMs}; fastMs is time spent with
// the accelerometer forced to 12.5 Hz. Returns the average extra current
// over durationMs and how that compares with the idle draw.
function estimate(counts, durationMs) {
  const cpuMs = (counts.taps || 0) * CPU_MS.tap + (counts.accel || 0) * CPU_MS.accel +
    (counts.timers || 0) * CPU_MS.timer + (counts.draws || 0) * CPU_MS.draw;
  const mAms = cpuMs * MA.cpu + (counts.fastMs || 0) * MA.accelFast;
  const extraMa = mAms / durationMs;
  return { cpuMs: cpuMs, extraUa: extraMa * 1000, pctOfIdle: 100 * extraMa / MA.idle };
}

// Bangle.js 2's battery, and a typical watch's average draw: the "4 weeks"
// the shop quotes is 200 mAh over 672 h, about 0.3 mA.
const BATTERY_MAH = 200;
const TYPICAL_UA = 300;

// Days a charge lasts at baseUa, and with extraUa on top.
function life(extraUa, baseUa) {
  baseUa = baseUa || TYPICAL_UA;
  const days = (ua) => BATTERY_MAH * 1000 / ua / 24;
  return { days: days(baseUa), withExtra: days(baseUa + extraUa), lostPct: 100 * extraUa / (baseUa + extraUa) };
}

module.exports = { MA, CPU_MS, BATTERY_MAH, TYPICAL_UA, estimate, life };
