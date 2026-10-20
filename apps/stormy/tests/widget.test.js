"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const mock = require(path.resolve(__dirname, "../../../tests/helpers/bangle-mock.js"));

function loadWidget(overrides) {
  const src = fs.readFileSync(path.resolve(__dirname, "../widget.js"), "utf8");
  const wrapped = "(function(require, g, WIDGETS) { " + src + " })";
  (0, eval)(wrapped)(global.require, global.g, global.WIDGETS);
}

test("widget registers in WIDGETS with area tl and width 24", function(t) {
  const h = mock.install();
  t.after(function() { h.restore(); });
  loadWidget();
  assert.ok(global.WIDGETS.stormy, "stormy widget registered");
  assert.strictEqual(global.WIDGETS.stormy.area, "tl");
  assert.strictEqual(global.WIDGETS.stormy.width, 24);
  assert.strictEqual(typeof global.WIDGETS.stormy.draw, "function");
});

test("draw calls fillCircle and fillRect for cloud shape", function(t) {
  const h = mock.install();
  t.after(function() { h.restore(); });

  const calls = [];
  global.g.fillCircle = function(x, y, r) { calls.push(["fillCircle", x, y, r]); };
  global.g.fillRect = function(x1, y1, x2, y2) { calls.push(["fillRect", x1, y1, x2, y2]); };
  global.g.fillPoly = function(pts) { calls.push(["fillPoly", pts]); };
  global.g.setColor = function(c) { calls.push(["setColor", c]); };
  global.g.reset = function() { calls.push(["reset"]); };

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 0; w.y = 0;
  w.draw.call(w);

  const circles = calls.filter(function(c) { return c[0] === "fillCircle"; });
  const rects = calls.filter(function(c) { return c[0] === "fillRect"; });
  assert.strictEqual(circles.length, 3, "three circles for cloud bumps");
  assert.strictEqual(rects.length, 1, "one rect for cloud base");
  const polys = calls.filter(function(c) { return c[0] === "fillPoly"; });
  assert.strictEqual(polys.length, 0, "no lightning bolt when no alert");
});

test("draw emits lightning bolt fillPoly when alertPending is true", function(t) {
  const h = mock.install({ files: { "stormy.json": JSON.stringify({ alertPending: true }) } });
  t.after(function() { h.restore(); });

  const calls = [];
  global.g.fillPoly = function(pts) { calls.push(["fillPoly", pts]); };
  global.g.fillCircle = function() {};
  global.g.fillRect = function() {};
  global.g.setColor = function() {};
  global.g.reset = function() {};

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 0; w.y = 0;
  w.draw.call(w);

  const polys = calls.filter(function(c) { return c[0] === "fillPoly"; });
  assert.strictEqual(polys.length, 1, "lightning bolt rendered when alert pending");
});

test("dark theme no-alert uses muted grey colour", function(t) {
  const h = mock.install({ files: { "stormy.json": JSON.stringify({ alertPending: false }) } });
  t.after(function() { h.restore(); });
  global.g.theme = { dark: true };

  const colors = [];
  global.g.setColor = function(c) { colors.push(c); };
  global.g.fillCircle = function() {};
  global.g.fillRect = function() {};
  global.g.fillPoly = function() {};
  global.g.reset = function() {};

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 0; w.y = 0;
  w.draw.call(w);

  assert.strictEqual(colors[0], "#cccccc");
});

test("dark theme alert uses amber colour for cloud", function(t) {
  const h = mock.install({ files: { "stormy.json": JSON.stringify({ alertPending: true }) } });
  t.after(function() { h.restore(); });
  global.g.theme = { dark: true };

  const colors = [];
  global.g.setColor = function(c) { colors.push(c); };
  global.g.fillCircle = function() {};
  global.g.fillRect = function() {};
  global.g.fillPoly = function() {};
  global.g.reset = function() {};

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 0; w.y = 0;
  w.draw.call(w);

  assert.strictEqual(colors[0], "#ffcc33", "cloud is amber in dark mode alert");
  assert.ok(colors.includes("#ffff66"), "bolt is bright yellow in dark mode alert");
});

test("light theme no-alert uses dark grey colour", function(t) {
  const h = mock.install({ files: { "stormy.json": JSON.stringify({ alertPending: false }) } });
  t.after(function() { h.restore(); });
  global.g.theme = { dark: false };

  const colors = [];
  global.g.setColor = function(c) { colors.push(c); };
  global.g.fillCircle = function() {};
  global.g.fillRect = function() {};
  global.g.fillPoly = function() {};
  global.g.reset = function() {};

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 0; w.y = 0;
  w.draw.call(w);

  assert.strictEqual(colors[0], "#666666");
});

test("widget draw is position-aware: offsets coordinates by x/y", function(t) {
  const h = mock.install({ files: { "stormy.json": JSON.stringify({ alertPending: false }) } });
  t.after(function() { h.restore(); });

  const circles = [];
  global.g.fillCircle = function(x, y, r) { circles.push({ x, y, r }); };
  global.g.fillRect = function() {};
  global.g.setColor = function() {};
  global.g.reset = function() {};

  loadWidget();
  const w = global.WIDGETS.stormy;
  w.x = 100; w.y = 50;
  w.draw.call(w);

  assert.ok(circles[0].x >= 100, "x is offset by widget x position");
  assert.ok(circles[0].y >= 50, "y is offset by widget y position");
});
