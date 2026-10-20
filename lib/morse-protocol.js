// Tap-sequence protocol for mr-morse. Pure functions so it runs the
// same on the watch (loaded via Storage + eval) and under node --test.
//
// The password is a pair of taps followed by one spaced tap. After the watch
// echoes it back, the taps that follow are the severity. The KX022's own tap
// engine may report a quick pair either as one "double" event or as two
// separate taps, depending on timing registers we don't control, so both
// spellings of the pair are accepted.
//
// States: "idle" -> "half" (one tap, might be the first of a pair)
//         -> "waiting" (pair heard, wants the confirming tap)
//         -> "echo" (caller is buzzing it back; deaf)
//         -> "counting" -> "idle"
(function(root) {
  var DEFAULTS = {
    pairMinMs: 100,     // taps closer than this are one knock bouncing, not a pair
    pairMaxMs: 450,     // ...and further apart than this is no longer a pair
    waitMinMs: 300,     // a tap this soon after the pair still belongs to it
    waitMaxMs: 1500,    // the confirming tap has to land by here
    quietMs: 4000,      // counting ends this long after the last tap
    maxCountMs: 20000,  // ...or here regardless
    maxSeverity: 5
  };

  function opts(o) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (o) for (k in o) if (o[k] !== undefined) out[k] = o[k];
    return out;
  }

  // tap() and tick() return an action for the caller to act on, or null:
  //   {type:"echo"}                 buzz the password back, then call armed()
  //   {type:"done", severity:1..5}  log it and buzz the number back
  //   {type:"cancel"}              armed but nothing counted
  function createSequencer(o) {
    o = opts(o);
    var state = "idle", t0 = 0, count = 0, start = 0, last = 0;

    function finish() {
      var n = count;
      state = "idle";
      count = 0;
      return n > 0 ? { type: "done", severity: n } : { type: "cancel" };
    }

    return {
      tap: function(isDouble, nowMs) {
        var gap = nowMs - t0;
        if (state === "counting") {
          count += isDouble ? 2 : 1;
          if (count > o.maxSeverity) count = o.maxSeverity;
          last = nowMs;
          return null;
        }
        if (state === "echo") return null; // the buzz is playing; ignore everything
        if (isDouble) {
          // The chip fused the pair for us, wherever we were.
          state = "waiting";
          t0 = nowMs;
          return null;
        }
        if (state === "half") {
          if (gap < o.pairMinMs) return null;            // bounce off the first tap
          if (gap <= o.pairMaxMs) { state = "waiting"; t0 = nowMs; return null; }
          t0 = nowMs;                                    // too late: a new first tap
          return null;
        }
        if (state === "waiting") {
          if (gap < o.waitMinMs) return null;            // still part of the pair
          if (gap > o.waitMaxMs) { state = "half"; t0 = nowMs; return null; }
          state = "echo";
          t0 = nowMs;
          return { type: "echo" };
        }
        state = "half";                                  // idle
        t0 = nowMs;
        return null;
      },

      // Called once the echo has finished buzzing: counting starts here.
      armed: function(nowMs) {
        state = "counting";
        count = 0;
        start = last = nowMs;
      },

      tick: function(nowMs) {
        if (state === "half" && nowMs - t0 > o.pairMaxMs) state = "idle";
        else if (state === "waiting" && nowMs - t0 > o.waitMaxMs) state = "idle";
        else if (state === "counting" &&
                 (nowMs - last >= o.quietMs || nowMs - start >= o.maxCountMs)) return finish();
        return null;
      },

      state: function() { return state; },
      count: function() { return count; }
    };
  }

  var api = {
    DEFAULTS: DEFAULTS,
    createSequencer: createSequencer
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.morseTap = api;
})(typeof global !== "undefined" ? global : this);
