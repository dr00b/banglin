// TAP-3: log a symptom and its severity with nothing but taps.
//
//   password    symptom      severity
//   • •  •  ->  1-3 taps  ->  1-3 taps
//              (pause >= GROUP_GAP_MS between the two groups)
//
// The password timings mirror lib/morse-protocol.js so the demo trains the
// same rhythm the watch expects. Pure logic, no DOM: feed it tap times and
// clock ticks, read back events.
(function(root) {
  const T = {
    PAIR_MIN_MS: 60,       // the watch uses 100; mice and keys bounce less
    PAIR_MAX_MS: 350,      // first two password taps
    WAIT_MIN_MS: 450,      // pause before the confirming tap...
    WAIT_MAX_MS: 1500,     // ...lands inside this window
    POST_QUIET_MS: 600,    // silence after the password, then it's armed
    ECHO_MS: 1100,         // taps are ignored while the watch buzzes back
    GROUP_GAP_MS: 1000,    // silence that closes the symptom group
    END_QUIET_MS: 2500,    // silence that closes the severity group and logs
    START_TIMEOUT_MS: 4000 // no tap this long after arming / the symptom: cancel
  };

  const SEVERITIES = ["mild", "moderate", "severe"];

  const PRESETS = {
    menstrual: { label: "Menstrual cycle", symptoms: ["Cramps", "Bloating", "Fatigue"] },
    ra: { label: "Rheumatoid arthritis", symptoms: ["Joint pain", "Stiffness", "Fatigue"] },
    lupus: { label: "Lupus", symptoms: ["Joint pain", "Fatigue", "Rash"] }
  };

  // opts: {password: bool, flare: bool}
  function createDecoder(opts) {
    const o = Object.assign({ password: true, flare: false }, opts);
    const maxSymptom = o.flare ? 4 : 3;
    var phase, count, last, symptom, ignoreUntil;

    function reset() {
      phase = "idle";   // idle, p1, p2, p3, armed, symptom, gap, severity
      count = 0;
      last = 0;
      symptom = 0;
      ignoreUntil = 0;
    }
    reset();

    function cancel(reason) {
      const ev = { type: "cancel", reason: reason, phase: phase };
      reset();
      return [ev];
    }

    function arm(now) {
      phase = "armed";
      last = now;
      ignoreUntil = now + T.ECHO_MS;
      return [{ type: "armed" }];
    }

    function tap(now) {
      if (now < ignoreUntil) return [{ type: "ignored" }];
      const gap = now - last;
      if (phase !== "idle" && gap < T.PAIR_MIN_MS) return []; // a bounce
      switch (phase) {
        case "idle":
          if (!o.password) {
            phase = "symptom";
            count = 1;
            last = now;
            return [{ type: "count", slot: "symptom", count: 1 }];
          }
          phase = "p1";
          last = now;
          return [{ type: "password", step: 1 }];
        case "p1":
          last = now;
          if (gap > T.PAIR_MAX_MS) return [{ type: "password", step: 1 }]; // start over from this tap
          phase = "p2";
          return [{ type: "password", step: 2 }];
        case "p2":
          if (gap < T.WAIT_MIN_MS) return cancel("rhythm");
          phase = "p3";
          last = now;
          return [{ type: "password", step: 3 }];
        case "p3":
          return cancel("rhythm");
        case "armed":
        case "symptom":
          if (phase === "armed") count = 0;
          phase = "symptom";
          count++;
          last = now;
          if (count > maxSymptom) return cancel("too many");
          return [{ type: "count", slot: "symptom", count: count }];
        case "gap":
        case "severity":
          if (phase === "gap") count = 0;
          phase = "severity";
          count++;
          last = now;
          if (count > SEVERITIES.length) return cancel("too many");
          return [{ type: "count", slot: "severity", count: count }];
      }
      return [];
    }

    function tick(now) {
      const quiet = now - last;
      switch (phase) {
        case "p1":
          if (quiet > T.PAIR_MAX_MS) { reset(); return [{ type: "password", step: 0 }]; }
          break;
        case "p2":
          if (quiet > T.WAIT_MAX_MS) return cancel("rhythm");
          break;
        case "p3":
          if (quiet >= T.POST_QUIET_MS) return arm(now);
          break;
        case "armed":
          if (now - ignoreUntil >= T.START_TIMEOUT_MS) return cancel("timeout");
          break;
        case "symptom":
          if (quiet >= T.GROUP_GAP_MS) {
            phase = "gap";
            symptom = count;
            return [{ type: "group", slot: "symptom", count: count }];
          }
          break;
        case "gap":
          if (quiet >= T.START_TIMEOUT_MS) return cancel("no severity");
          break;
        case "severity":
          if (quiet >= T.END_QUIET_MS) {
            const ev = { type: "logged", symptom: symptom, severity: count };
            reset();
            ignoreUntil = now + T.ECHO_MS;
            return [ev];
          }
          break;
      }
      return [];
    }

    return {
      tap: tap,
      tick: tick,
      reset: reset,
      phase: function() { return phase; },
      count: function() { return count; },
      symptom: function() { return symptom; }
    };
  }

  // Vibration/sound pattern for the watch's echo: [on, off, on, off, ...] ms.
  function echoPattern(groups) {
    const DOT = 90, IN = 170, BETWEEN = 650;
    const out = [];
    groups.forEach(function(n, gi) {
      for (let i = 0; i < n; i++) {
        out.push(DOT);
        out.push(i < n - 1 ? IN : (gi < groups.length - 1 ? BETWEEN : 0));
      }
    });
    if (out.length) out.pop();
    return out;
  }

  const PASSWORD_GROUPS = [2, 1];

  // ---- Practice: Koch-style unlocking, weakest code first, spaced reviews ----

  const UNLOCK_WINDOW = 10;      // attempts per symptom that count toward unlocking
  const UNLOCK_ACCURACY = 0.9;   // Koch's threshold
  const REVIEW_DAYS = [1, 2, 4, 7, 14];
  const DAY_MS = 86400000;

  function newTrainer(total) {
    return { total: total, unlocked: Math.min(2, total), history: {}, review: 0, nextReview: 0 };
  }

  function recent(tr, s) {
    return (tr.history[s] || []).slice(-UNLOCK_WINDOW);
  }

  function accuracy(tr, s) {
    const r = recent(tr, s);
    if (!r.length) return null;
    return r.reduce(function(a, b) { return a + b; }, 0) / r.length;
  }

  // rand: () => [0, 1)
  function nextPrompt(tr, rand) {
    const weights = [];
    var sum = 0;
    for (let s = 1; s <= tr.unlocked; s++) {
      const r = recent(tr, s);
      const acc = accuracy(tr, s);
      // new and shaky codes come up more often
      const w = 1 + (acc === null ? 2 : 4 * (1 - acc)) + (r.length < 3 ? 1 : 0);
      weights.push(w);
      sum += w;
    }
    var x = rand() * sum, symptom = tr.unlocked;
    for (let i = 0; i < weights.length; i++) {
      if (x < weights[i]) { symptom = i + 1; break; }
      x -= weights[i];
    }
    const severity = 1 + Math.floor(rand() * SEVERITIES.length);
    return { symptom: symptom, severity: severity };
  }

  // Returns {trainer, unlocked: true|false}. Mutates nothing.
  function record(tr, prompt, correct) {
    const next = JSON.parse(JSON.stringify(tr));
    const h = next.history[prompt.symptom] || [];
    h.push(correct ? 1 : 0);
    next.history[prompt.symptom] = h.slice(-50);
    var unlocked = false;
    if (next.unlocked < next.total) {
      var ready = true;
      for (let s = 1; s <= next.unlocked; s++) {
        const r = recent(next, s);
        if (r.length < UNLOCK_WINDOW || accuracy(next, s) < UNLOCK_ACCURACY) ready = false;
      }
      if (ready) { next.unlocked++; unlocked = true; }
    }
    return { trainer: next, unlocked: unlocked };
  }

  // Call when a practice session ends. Passing (>= 90%) stretches the
  // interval to the next review, failing resets it to tomorrow.
  function scheduleReview(tr, sessionAccuracy, now) {
    const next = JSON.parse(JSON.stringify(tr));
    next.review = sessionAccuracy >= UNLOCK_ACCURACY ? Math.min(next.review + 1, REVIEW_DAYS.length - 1) : 0;
    next.nextReview = now + REVIEW_DAYS[next.review] * DAY_MS;
    return next;
  }

  const api = {
    TIMING: T,
    SEVERITIES: SEVERITIES,
    PRESETS: PRESETS,
    PASSWORD_GROUPS: PASSWORD_GROUPS,
    REVIEW_DAYS: REVIEW_DAYS,
    createDecoder: createDecoder,
    echoPattern: echoPattern,
    newTrainer: newTrainer,
    accuracy: accuracy,
    nextPrompt: nextPrompt,
    record: record,
    scheduleReview: scheduleReview
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TapLanguage = api;
})(this);
