// Wrist-twist detection for gesture_symptoms_v1. Pure functions so it runs the
// same on the watch (loaded via Storage + eval) and under node --test.
//
// Model: the forearm runs along the watch's X axis, so twisting the wrist
// rotates gravity between Y and Z. The roll angle atan2(y, -z) is 0 with the
// face up and swings positive or negative with the direction of the twist.
// A "twist" is an excursion of that angle away from the resting baseline and
// back again; its sign is the direction.
(function(root) {
  var DEFAULTS = {
    enterDeg: 35,      // excursion must exceed this to count
    exitDeg: 15,       // ...and come back within this to complete
    smooth: 0.5,       // EMA factor applied to the raw roll angle
    baseAlpha: 0.05,   // how fast the resting baseline follows slow drift
    triggerMin: 2,     // same-direction twists that make a trigger
    triggerMax: 3,     // 3 tolerates an extra twist when power-save drops none
    maxSeverity: 5,
    quietMs: 1500,     // stop counting this long after the last twist
    firstTwistMs: 3000, // give up if no counting twist starts in time
    maxCountMs: 8000
  };

  function opts(o) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (o) for (k in o) if (o[k] !== undefined) out[k] = o[k];
    return out;
  }

  function roll(x, y, z) {
    return Math.atan2(y, -z) * 180 / Math.PI;
  }

  // Signed difference a-b wrapped into [-180, 180).
  function angleDiff(a, b) {
    var d = a - b;
    while (d >= 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  // Streaming twist detector. push() returns +1/-1 when a twist completes,
  // otherwise 0.
  function createDetector(o) {
    o = opts(o);
    var angle = null, base = null, sign = 0, peak = 0;
    return {
      push: function(x, y, z) {
        var r = roll(x, y, z);
        if (angle === null) { angle = r; base = r; return 0; }
        angle += o.smooth * angleDiff(r, angle);
        var off = angleDiff(angle, base);
        if (!sign) {
          if (Math.abs(off) > o.enterDeg) {
            sign = off > 0 ? 1 : -1;
            peak = Math.abs(off);
          } else {
            base += o.baseAlpha * off;
          }
          return 0;
        }
        if (Math.abs(off) > peak) peak = Math.abs(off);
        if (off * sign < o.exitDeg) {
          var s = sign;
          sign = 0;
          return s;
        }
        return 0;
      },
      offset: function() { return angle === null ? 0 : angleDiff(angle, base); },
      inTwist: function() { return sign; }
    };
  }

  // Run the detector over a firmware gesture buffer: Int8Array XYZXYZ...
  // where 64 = 1g.
  function twistsIn(xyz, o) {
    var d = createDetector(o), out = [];
    for (var i = 0; i + 2 < xyz.length; i += 3) {
      var t = d.push(xyz[i] / 64, xyz[i + 1] / 64, xyz[i + 2] / 64);
      if (t) out.push(t);
    }
    return out;
  }

  // Rule-based trigger check on a gesture buffer. dir is the dominant twist
  // direction even when isTrigger is false, so a TF trigger can borrow it.
  function classifyTrigger(xyz, o) {
    o = opts(o);
    var tw = twistsIn(xyz, o), pos = 0, neg = 0;
    for (var i = 0; i < tw.length; i++) if (tw[i] > 0) pos++; else neg++;
    var dir = pos >= neg ? 1 : -1;
    var main = Math.max(pos, neg), other = Math.min(pos, neg);
    return {
      // A 2-twist trigger must be clean; 3 may carry one return overshoot.
      isTrigger: main >= o.triggerMin && main <= o.triggerMax && other * 3 <= main,
      dir: tw.length ? dir : 0,
      twists: tw
    };
  }

  // After a trigger in direction `dir`, count twists the other way from the
  // live accelerometer stream. Same-direction swings (overshoot on the way
  // back) are ignored.
  function createCounter(dir, startMs, o) {
    o = opts(o);
    var d = createDetector(o), count = 0, lastMs = startMs, done = false;
    function finish() { done = true; return { done: true, severity: count }; }
    // Checks the time limits; also called from a timer in case accel events
    // stop arriving.
    function tick(nowMs) {
      if (done) return { done: true, severity: count };
      var limit = count ? o.quietMs : o.firstTwistMs;
      if (d.inTwist()) limit += o.quietMs;
      if (nowMs - lastMs >= limit || nowMs - startMs >= o.maxCountMs) return finish();
      return { done: false, severity: count };
    }
    return {
      push: function(x, y, z, nowMs) {
        if (done) return { done: true, severity: count };
        var t = d.push(x, y, z);
        if (t && t === -dir) {
          count++;
          lastMs = nowMs;
          if (count >= o.maxSeverity) return finish();
        }
        return tick(nowMs);
      },
      tick: tick,
      count: function() { return count; },
      offset: function() { return d.offset(); }
    };
  }

  // aiGesture weights come back as softmax floats (float model) or raw int8
  // (quantized model). Map either to a 0..1 confidence for the winner.
  function confidence(weights) {
    var max = -Infinity, quant = false;
    for (var i = 0; i < weights.length; i++) {
      if (weights[i] > max) max = weights[i];
      if (weights[i] < 0 || weights[i] > 1.001) quant = true;
    }
    if (!weights.length) return 0;
    return quant ? (max + 128) / 255 : max;
  }

  var api = {
    DEFAULTS: DEFAULTS,
    roll: roll,
    angleDiff: angleDiff,
    createDetector: createDetector,
    twistsIn: twistsIn,
    classifyTrigger: classifyTrigger,
    createCounter: createCounter,
    confidence: confidence
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.gsymCounter = api;
})(typeof global !== "undefined" ? global : this);
