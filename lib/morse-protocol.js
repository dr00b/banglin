// Tap-sequence protocol for mr-morse. Pure functions so it runs the
// same on the watch (loaded via Storage + eval) and under node --test.
//
// The password is a pair of taps followed by one spaced tap: dot-dot, pause,
// dot. After the watch echoes it back, the taps that follow are the severity.
// The KX022's own tap engine may report a quick pair either as one "double"
// event or as two separate taps, depending on timing registers we don't
// control, so both spellings of the pair are accepted.
//
// Everyday knocks come in trains: patting a back, a swinging arm hitting
// things. A train of three even taps used to pass for the password, so it now
// has to be a shape a train doesn't make:
//   - it starts out of silence (no tap for preQuietMs before the first, and
//     not three within trainMs: a run of taps with gaps in it is still a run),
//   - the pause is clearly longer than the pair, but not hugely so
//     (rhythmRatio..maxRatio x the pair gap),
//   - silence follows it (no tap for postQuietMs before the echo),
//   - and optionally, every tap comes from one direction (tapDir): a finger on
//     the face, not a knock from the side or a jolt from underneath.
// Any tap that breaks the rhythm drops straight back to idle, and that tap
// counts as noise, so a train keeps the gate shut until it stops.
//
// States: "idle" -> "half" (one tap, might be the first of a pair)
//         -> "waiting" (pair heard, wants the confirming tap)
//         -> "confirm" (confirming tap heard, wants silence after it)
//         -> "echo" (caller is buzzing it back; deaf)
//         -> "counting" -> "idle"
(function(root) {
  var DEFAULTS = {
    preQuietMs: 1000,   // no tap for this long before the first one
    trainMs: 4000,      // ...and fewer than three in this long
    bounceMs: 60,       // a tap this soon after the last is it bouncing: ignored
    pairMinMs: 150,     // closer than this is a drum roll or a rebound, not a pair
    pairMaxMs: 350,     // ...and further apart than this is no longer a pair
    waitMinMs: 450,     // the pause before the confirming tap is at least this
    rhythmRatio: 2.3,   // ...and at least this many times the pair's own gap (a
                        // steady pat with one beat missing makes exactly 2)
    maxRatio: 5,        // ...but no more than this many
    waitMaxMs: 1500,    // the confirming tap has to land by here
    postQuietMs: 600,   // no tap for this long after it, then echo
    tapDir: "",         // if set, every password tap must report this direction
    quietMs: 4000,      // counting ends this long after the last tap
    maxCountMs: 20000,  // ...or here regardless
    maxSeverity: 5      // more taps than this is patting, not a count: cancel
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
  //   {type:"cancel"}               armed but nothing (or too much) counted
  // rejected() says why the last attempt was thrown away, for the Live test.
  function createSequencer(o) {
    o = opts(o);
    var state = "idle", t0 = 0, pairGap = 0, count = 0, start = 0, last = 0;
    var heard = [-Infinity, -Infinity, -Infinity], rejected = null;  // newest first

    function reject(reason, nowMs) {
      state = "idle";
      rejected = { reason: reason, t: nowMs };
      return null;
    }

    function finish(over) {
      var n = count;
      state = "idle";
      count = 0;
      return n > 0 && !over ? { type: "done", severity: n } : { type: "cancel" };
    }

    function hear(nowMs) {
      heard.pop();
      heard.unshift(nowMs);
    }

    // How long after the pair a confirming tap can still be accepted.
    function lastChance() {
      return pairGap ? Math.min(o.waitMaxMs, o.maxRatio * pairGap) : o.waitMaxMs;
    }

    // Was it quiet enough before a tap at nowMs to start a password?
    function quiet(nowMs) {
      return nowMs - heard[0] >= o.preQuietMs && nowMs - heard[2] >= o.trainMs;
    }

    // From idle: only a tap out of silence can start a password.
    function begin(isDouble, nowMs, wasQuiet) {
      if (!wasQuiet) return reject("busy", nowMs);
      state = isDouble ? "waiting" : "half";
      t0 = nowMs;
      pairGap = 0;  // unknown for a fused double: only waitMinMs applies
      return null;
    }

    return {
      tap: function(isDouble, nowMs, dir) {
        var gap = nowMs - t0, wasQuiet = quiet(nowMs);
        hear(nowMs);
        if (state === "counting") {
          count += isDouble ? 2 : 1;
          last = nowMs;
          if (count > o.maxSeverity) return finish(true);
          return null;
        }
        if (state === "echo") return null; // the buzz is playing; ignore everything
        if (state !== "idle" && !isDouble && gap < o.bounceMs) return null;  // bounce
        if (state === "confirm") return reject("after", nowMs);
        if (o.tapDir && dir !== o.tapDir) return reject("direction", nowMs);
        if (state === "idle") return begin(isDouble, nowMs, wasQuiet);
        if (isDouble) return reject("rhythm", nowMs);    // a third and fourth tap
        if (state === "half") {
          if (gap < o.pairMinMs || gap > o.pairMaxMs) return reject("rhythm", nowMs);
          state = "waiting";
          t0 = nowMs;
          pairGap = gap;
          return null;
        }
        // waiting
        if (gap < Math.max(o.waitMinMs, o.rhythmRatio * pairGap)) return reject("rhythm", nowMs);
        if (gap > lastChance()) return reject("rhythm", nowMs);
        state = "confirm";
        t0 = nowMs;
        return null;
      },

      // A tap the caller ignored for its own reasons (cooldown, UI in use)
      // still means the wrist isn't quiet.
      heard: function(nowMs) { hear(nowMs); },

      // The caller's own veto (e.g. the wrist was moving): back to idle.
      reject: function(reason, nowMs) { reject(reason, nowMs); },

      // Called once the echo has finished buzzing: counting starts here.
      armed: function(nowMs) {
        state = "counting";
        count = 0;
        start = last = nowMs;
      },

      tick: function(nowMs) {
        if (state === "half" && nowMs - t0 > o.pairMaxMs) state = "idle";
        else if (state === "waiting" && nowMs - t0 > lastChance()) state = "idle";
        else if (state === "confirm" && nowMs - t0 >= o.postQuietMs) {
          state = "echo";
          return { type: "echo" };
        } else if (state === "counting" &&
                 (nowMs - last >= o.quietMs || nowMs - start >= o.maxCountMs)) return finish(false);
        return null;
      },

      state: function() { return state; },
      count: function() { return count; },
      rejected: function() { return rejected; }
    };
  }

  var api = {
    DEFAULTS: DEFAULTS,
    createSequencer: createSequencer
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.morseTap = api;
})(typeof global !== "undefined" ? global : this);
