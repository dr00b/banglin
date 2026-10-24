// UI for the TAP-3 demo. Language rules live in tap-language.js.
(function() {
  const TL = window.TapLanguage;
  const $ = id => document.getElementById(id);
  const SEV = TL.SEVERITIES;
  const SESSION_LEN = 10;

  // ---- storage (per browser; may be unavailable) ----
  function load(key, fallback) {
    try {
      const v = localStorage.getItem("tap3." + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem("tap3." + key, JSON.stringify(value)); } catch (e) {}
  }

  var settings = Object.assign({ preset: "menstrual", symptoms: TL.PRESETS.menstrual.symptoms.slice(), flare: false },
    load("settings", {}));
  var log = load("log", null);          // null until the first real entry: show examples
  var trainer = load("trainer", null) || TL.newTrainer(names().length);
  var sound = load("sound", true);
  var hints = load("hints", true);

  function names() {
    return settings.flare ? settings.symptoms.concat(["Flare"]) : settings.symptoms.slice();
  }
  function label(s, v) { return `${names()[s - 1]}, ${SEV[v - 1]}`; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
  }

  // groups: [2, 1] -> "•• •". ghost: number of greyed placeholder dots to add.
  function dots(groups, cls) {
    const parts = groups.map(n => {
      var h = "";
      for (let i = 0; i < n; i++) h += "<span class=\"d\"></span>";
      return h;
    });
    return `<span class="dots ${cls || ""}" aria-label="${groups.join(" then ")} taps">${parts.join("<span class=\"gap\"></span>")}</span>`;
  }

  // ---- buzz: vibration where supported, a beep, and a flash of the pad ----
  var audio = null;
  function beep(atMs, durMs) {
    if (!sound) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime + atMs / 1000;
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.frequency.value = 180;   // low, like a motor
      osc.type = "square";
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      gain.gain.setValueAtTime(0.12, t + durMs / 1000 - 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + durMs / 1000 + 0.02);
    } catch (e) {}
  }
  function buzz(pattern, pad) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
    var t = 0;
    pattern.forEach((ms, i) => {
      if (i % 2 === 0) {
        beep(t, ms);
        if (pad) {
          setTimeout(() => pad.classList.add("buzz"), t);
          setTimeout(() => pad.classList.remove("buzz"), t + ms);
        }
      }
      t += ms;
    });
    return t;
  }
  const LONG_BUZZ = [600];

  function flash(pad, cls) {
    pad.classList.add(cls);
    setTimeout(() => pad.classList.remove(cls), cls === "hit" ? 90 : 900);
  }

  // ---- tabs ----
  const VIEWS = ["log", "practice", "card", "setup"];
  var view = "log";
  function show(v) {
    if (VIEWS.indexOf(v) < 0) v = "log";
    view = v;
    VIEWS.forEach(x => {
      $("view-" + x).hidden = x !== v;
      $("tab-" + x).setAttribute("aria-selected", x === v ? "true" : "false");
    });
    if (v === "card") renderCard();
    if (v === "practice") renderPractice();
  }
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => {
    show(b.dataset.view);
    try { history.replaceState(null, "", "#" + b.dataset.view); } catch (e) {}
  }));

  // ---- code tables (setup, log hints) ----
  function codeTable() {
    const rows = names().map((n, i) => `<tr><td>${esc(n)}</td><td>${dots([i + 1])}</td></tr>`).join("");
    const sev = SEV.map((s, i) => `<tr><td class="muted">then ${s}</td><td>${dots([i + 1], "accent")}</td></tr>`).join("");
    return `<table class="codes"><tr><th>Symptom</th><th>Taps</th></tr>${rows}
      <tr><th>Severity, after a pause</th><th></th></tr>${sev}</table>`;
  }

  // ================= LOG =================
  var logDecoder;
  function newLogDecoder() { logDecoder = TL.createDecoder({ password: true, flare: settings.flare }); }
  newLogDecoder();

  const REASONS = {
    rhythm: "Password rhythm didn't match. Tap-tap quickly, pause, then tap once.",
    timeout: "Nothing tapped after the buzz, so nothing was logged.",
    "too many": "Too many taps, so nothing was logged.",
    "no severity": "No severity after the symptom, so nothing was logged."
  };

  function setLogStatus(text, cls) {
    const el = $("log-status");
    el.textContent = text;
    el.className = "status" + (cls ? " " + cls : "");
  }
  function setPhase(active, done) {
    document.querySelectorAll("#log-phases .phase").forEach(p => {
      p.classList.toggle("active", p.dataset.phase === active);
      p.classList.toggle("done", done.indexOf(p.dataset.phase) >= 0);
    });
  }
  function slot(name, html) { document.querySelector(`#log-phases [data-slot="${name}"]`).outerHTML = html.replace("class=\"dots", `data-slot="${name}" class="dots`); }
  function clearLogUI() {
    ["password", "symptom", "severity"].forEach(s => slot(s, "<span class=\"dots\"></span>"));
    setPhase("", []);
  }

  function onLogEvents(events) {
    const pad = $("log-pad");
    events.forEach(e => {
      if (e.type === "password") {
        if (e.step === 0) { clearLogUI(); setLogStatus("Waiting for the password."); return; }
        slot("password", dots(e.step < 3 ? [e.step] : [2, 1]));
        setPhase("password", []);
        setLogStatus(e.step === 2 ? "Now pause… then tap once." : e.step === 3 ? "Hold still…" : "Tap again, quickly.");
      } else if (e.type === "armed") {
        buzz(TL.echoPattern(TL.PASSWORD_GROUPS), pad);
        setPhase("symptom", ["password"]);
        setLogStatus("Buzz! Go ahead: tap your symptom.");
      } else if (e.type === "count") {
        slot(e.slot, dots([e.count], e.slot === "severity" ? "accent" : ""));
        if (e.slot === "symptom") {
          const n = names()[e.count - 1];
          setLogStatus(hints && n ? `Symptom: ${n}` : `${e.count} tap${e.count > 1 ? "s" : ""}`);
        } else {
          setLogStatus(hints ? `Severity: ${SEV[e.count - 1]}` : `${e.count} tap${e.count > 1 ? "s" : ""}`);
        }
      } else if (e.type === "group") {
        setPhase("severity", ["password", "symptom"]);
        setLogStatus("Now the severity: 1 mild, 2 moderate, 3 severe.");
      } else if (e.type === "logged") {
        buzz(TL.echoPattern([e.symptom, e.severity]), pad);
        setPhase("", ["password", "symptom", "severity"]);
        setLogStatus(`Logged: ${label(e.symptom, e.severity)}. The watch buzzes it back.`, "ok");
        if (!Array.isArray(log)) log = [];
        log.unshift({ t: Date.now(), s: e.symptom, v: e.severity, name: names()[e.symptom - 1] });
        log = log.slice(0, 200);
        save("log", log);
        renderLog();
        setTimeout(clearLogUI, 2500);
      } else if (e.type === "cancel") {
        buzz(LONG_BUZZ, null);
        flash(pad, "bad");
        setLogStatus(REASONS[e.reason] || "Cancelled.", "bad");
        setTimeout(clearLogUI, 1500);
      }
    });
  }

  function exampleLog() {
    const now = Date.now(), h = 3600000;
    return [
      { t: now - 2 * h, s: 1, v: 2, example: true },
      { t: now - 7 * h, s: 3, v: 1, example: true },
      { t: now - 26 * h, s: 1, v: 3, example: true },
      { t: now - 30 * h, s: 2, v: 2, example: true }
    ];
  }
  function fmtTime(t) {
    const d = new Date(t), today = new Date();
    const hm = d.toTimeString().slice(0, 5);
    if (d.toDateString() === today.toDateString()) return "Today " + hm;
    return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + hm;
  }
  function renderLog() {
    const entries = Array.isArray(log) ? log : exampleLog();
    $("log-list").innerHTML = entries.length ? entries.map(x => {
      const n = x.name || names()[x.s - 1] || "Symptom " + x.s;
      return `<li><span class="time">${fmtTime(x.t)}</span><span>${esc(n)}${x.example ? "<span class=\"tag\">Example</span>" : ""}</span><span class="sev s${x.v}">${SEV[x.v - 1]}</span></li>`;
    }).join("") : "<li><span></span><span class=\"muted\">Nothing logged yet.</span><span></span></li>";
  }
  $("log-clear").addEventListener("click", () => { log = []; save("log", log); renderLog(); });
  $("opt-hints").checked = hints;
  $("opt-hints").addEventListener("change", e => {
    hints = e.target.checked;
    save("hints", hints);
    $("log-codes").hidden = !hints;
  });

  // ================= PRACTICE =================
  var mode = "tap", prompt = null, session = [], prDecoder, listenPick = { s: 0, v: 0 }, listenPrompt = null;
  function newPrDecoder() { prDecoder = TL.createDecoder({ password: false, flare: settings.flare }); }
  newPrDecoder();

  function setPrStatus(html, cls) {
    const el = $("pr-status");
    el.innerHTML = html;
    el.className = "status" + (cls ? " " + cls : "");
  }
  function nextTapPrompt() {
    prompt = TL.nextPrompt(trainer, Math.random);
    $("pr-prompt").innerHTML = `${esc(names()[prompt.symptom - 1])}, <span class="sevword">${SEV[prompt.severity - 1]}</span>`;
    $("pr-dots").innerHTML = "";
  }
  function grade(p, correct) {
    const r = TL.record(trainer, p, correct);
    trainer = r.trainer;
    session.push(correct ? 1 : 0);
    var extra = "";
    if (r.unlocked) extra = ` New code unlocked: <b>${esc(names()[trainer.unlocked - 1])}</b> = ${trainer.unlocked} taps.`;
    if (session.length >= SESSION_LEN) {
      const acc = session.reduce((a, b) => a + b, 0) / session.length;
      trainer = TL.scheduleReview(trainer, acc, Date.now());
      extra += ` Session done: ${Math.round(acc * 100)}%. ${acc >= 0.9 ? "Next review pushed back." : "Review again tomorrow."}`;
      session = [];
    }
    save("trainer", trainer);
    renderPractice();
    return extra;
  }
  function onPrEvents(events) {
    const pad = $("pr-pad");
    events.forEach(e => {
      if (e.type === "count") {
        const sym = e.slot === "symptom" ? e.count : prDecoder.symptom();
        $("pr-dots").innerHTML = e.slot === "symptom" ? dots([sym]) : dots([sym]) + "<span class=\"gap\"></span>" + dots([e.count], "accent");
      } else if (e.type === "logged") {
        const ok = e.symptom === prompt.symptom && e.severity === prompt.severity;
        const p = prompt;
        const extra = grade(p, ok);
        if (ok) {
          buzz(TL.echoPattern([e.symptom, e.severity]), null);
          flash(pad, "ok");
          setPrStatus(`Right: ${esc(label(p.symptom, p.severity))}.${extra}`, "ok");
        } else {
          flash(pad, "bad");
          setPrStatus(`You tapped ${dots([e.symptom])}&nbsp;${dots([e.severity], "accent")}, which is ${esc(names()[e.symptom - 1] || "no code")}, ${SEV[e.severity - 1]}. Wanted ${dots([p.symptom])}&nbsp;${dots([p.severity], "accent")}.${extra}`, "bad");
        }
        setTimeout(nextTapPrompt, ok ? 1200 : 2600);
      } else if (e.type === "cancel") {
        flash(pad, "bad");
        if (e.reason === "too many") {
          const extra = grade(prompt, false);
          setPrStatus(`Too many taps. Wanted ${dots([prompt.symptom])}&nbsp;${dots([prompt.severity], "accent")}.${extra}`, "bad");
          setTimeout(nextTapPrompt, 2600);
        } else {
          setPrStatus("Pause about a second after the symptom, then tap the severity.", "bad");
          $("pr-dots").innerHTML = "";
        }
      }
    });
  }

  function setMode(m) {
    mode = m;
    $("mode-tap").setAttribute("aria-pressed", m === "tap" ? "true" : "false");
    $("mode-listen").setAttribute("aria-pressed", m === "listen" ? "true" : "false");
    $("drill-tap").hidden = m !== "tap";
    $("drill-listen").hidden = m !== "listen";
    setPrStatus("");
    newPrDecoder();
    if (m === "tap") nextTapPrompt();
    else newListen();
  }
  $("mode-tap").addEventListener("click", () => setMode("tap"));
  $("mode-listen").addEventListener("click", () => setMode("listen"));

  function renderAnswers() {
    $("ls-symptoms").innerHTML = names().slice(0, trainer.unlocked).map((n, i) =>
      `<button class="btn" type="button" data-s="${i + 1}" aria-pressed="${listenPick.s === i + 1}">${esc(n)}</button>`).join("");
    $("ls-severities").innerHTML = SEV.map((n, i) =>
      `<button class="btn" type="button" data-v="${i + 1}" aria-pressed="${listenPick.v === i + 1}">${n}</button>`).join("");
    $("ls-check").disabled = !(listenPick.s && listenPick.v && listenPrompt);
  }
  function newListen() {
    listenPrompt = TL.nextPrompt(trainer, Math.random);
    listenPick = { s: 0, v: 0 };
    $("ls-pad").innerHTML = "<span>Press Play, then feel or listen</span>";
    renderAnswers();
  }
  $("ls-symptoms").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    listenPick.s = +b.dataset.s; renderAnswers();
  });
  $("ls-severities").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    listenPick.v = +b.dataset.v; renderAnswers();
  });
  $("ls-play").addEventListener("click", () => {
    $("ls-pad").innerHTML = "<span></span>";
    buzz(TL.echoPattern([listenPrompt.symptom, listenPrompt.severity]), $("ls-pad"));
  });
  $("ls-check").addEventListener("click", () => {
    const p = listenPrompt;
    const ok = listenPick.s === p.symptom && listenPick.v === p.severity;
    const extra = grade(p, ok);
    $("ls-pad").innerHTML = dots([p.symptom], "lg") + "<span class=\"gap\" style=\"width:24px\"></span>" + dots([p.severity], "lg accent");
    setPrStatus(ok ? `Right: ${esc(label(p.symptom, p.severity))}.${extra}` : `That was ${esc(label(p.symptom, p.severity))}.${extra}`, ok ? "ok" : "bad");
    listenPrompt = null;
    renderAnswers();
    setTimeout(() => { if (mode === "listen") newListen(); }, ok ? 1400 : 2600);
  });

  function renderPractice() {
    $("pr-session").textContent = `Session: ${session.length} of ${SESSION_LEN}`;
    $("pr-unlocks").innerHTML = names().map((n, i) => {
      const s = i + 1, locked = s > trainer.unlocked;
      const acc = TL.accuracy(trainer, s);
      const tries = (trainer.history[s] || []).length;
      const pct = acc === null ? 0 : Math.round(acc * 100);
      return `<div class="unlock${locked ? " locked" : ""}">
        <span>${dots([s])} &nbsp;${esc(n)}</span>
        <span class="meter" title="${pct}% over the last 10"><span style="width:${locked ? 0 : pct}%"></span></span>
        <span class="small">${locked ? "locked" : tries ? pct + "%" : "new"}</span></div>`;
    }).join("");
    const r = $("pr-review");
    if (!trainer.nextReview) r.textContent = `No session finished yet. Do ${SESSION_LEN} prompts to schedule your first review.`;
    else {
      const days = Math.ceil((trainer.nextReview - Date.now()) / 86400000);
      const when = new Date(trainer.nextReview).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      r.innerHTML = days <= 0 ? "<b>Due now.</b> Do a quick session of 10." : `<b>${when}</b> (in ${days} day${days > 1 ? "s" : ""}, interval ${TL.REVIEW_DAYS[trainer.review]} days)`;
    }
  }

  // ================= CARD =================
  function renderCard() {
    const rows = names().map((n, i) => `<tr><td>${esc(n)}</td><td>${dots([i + 1])}</td></tr>`).join("");
    $("card-out").innerHTML = `
      <div class="wallet">
        <div class="head"><b>My tap codes</b><span>start ${dots(TL.PASSWORD_GROUPS)}</span></div>
        <table>${rows}</table>
        <div>pause, then severity:&nbsp; ${dots([1])} mild &nbsp; ${dots([2])} moderate &nbsp; ${dots([3])} severe</div>
      </div>
      <div class="wallet">
        <div class="head"><b>How to log</b><span>TAP-3</span></div>
        <ol>
          <li>Tap-tap, pause, tap. Stop and wait for the buzz.</li>
          <li>Tap the symptom (1–${names().length}).</li>
          <li>Pause one second. Tap the severity (1–3).</li>
          <li>Wait. The watch buzzes your code back.</li>
        </ol>
        <div>Long buzz = nothing logged. Wrong echo? Delete it in the app.</div>
      </div>`;
  }

  // ================= SETUP =================
  function renderSetup() {
    $("preset").innerHTML = Object.keys(TL.PRESETS).map(k =>
      `<option value="${k}"${settings.preset === k ? " selected" : ""}>${TL.PRESETS[k].label}</option>`).join("") +
      `<option value="custom"${settings.preset === "custom" ? " selected" : ""}>My own</option>`;
    $("symptom-fields").innerHTML = settings.symptoms.map((n, i) => `
      <div class="field">
        ${dots([i + 1])}
        <input type="text" id="sym-${i}" value="${esc(n)}" maxlength="18" aria-label="Symptom for ${i + 1} tap${i ? "s" : ""}">
        <span class="row">
          <button class="btn" type="button" data-move="${i}" data-dir="-1" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="btn" type="button" data-move="${i}" data-dir="1" ${i === settings.symptoms.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
        </span>
      </div>`).join("");
    $("opt-flare").checked = settings.flare;
    renderCodes();
  }
  function renderCodes() {
    $("setup-codes").innerHTML = codeTable();
    $("log-codes").innerHTML = codeTable();
    $("log-codes").hidden = !hints;
  }
  function settingsChanged() {
    save("settings", settings);
    trainer.total = names().length;
    trainer.unlocked = Math.min(trainer.unlocked, trainer.total);
    save("trainer", trainer);
    newLogDecoder();
    newPrDecoder();
    renderCodes();
    renderLog();
  }
  $("preset").addEventListener("change", e => {
    settings.preset = e.target.value;
    if (TL.PRESETS[settings.preset]) settings.symptoms = TL.PRESETS[settings.preset].symptoms.slice();
    renderSetup();
    settingsChanged();
  });
  $("symptom-fields").addEventListener("input", e => {
    const i = +e.target.id.replace("sym-", "");
    settings.symptoms[i] = e.target.value.trim() || `Symptom ${i + 1}`;
    settings.preset = "custom";
    $("preset").value = "custom";
    settingsChanged();
  });
  $("symptom-fields").addEventListener("click", e => {
    const b = e.target.closest("button[data-move]"); if (!b) return;
    const i = +b.dataset.move, j = i + +b.dataset.dir;
    const s = settings.symptoms;
    [s[i], s[j]] = [s[j], s[i]];
    settings.preset = "custom";
    renderSetup();
    settingsChanged();
  });
  $("opt-flare").addEventListener("change", e => {
    settings.flare = e.target.checked;
    settingsChanged();
  });
  $("reset-progress").addEventListener("click", () => { $("reset-confirm").hidden = false; });
  $("reset-confirm").addEventListener("click", () => {
    trainer = TL.newTrainer(names().length);
    session = [];
    save("trainer", trainer);
    $("reset-confirm").hidden = true;
    renderPractice();
  });
  $("opt-sound").checked = sound;
  $("opt-sound").addEventListener("change", e => { sound = e.target.checked; save("sound", sound); });

  // ================= input =================
  function tapNow() {
    const now = performance.now();
    if (view === "log") {
      flash($("log-pad"), "hit");
      onLogEvents(logDecoder.tap(now));
    } else if (view === "practice" && mode === "tap") {
      flash($("pr-pad"), "hit");
      onPrEvents(prDecoder.tap(now));
    }
  }
  $("log-pad").addEventListener("pointerdown", e => { e.preventDefault(); tapNow(); });
  $("pr-pad").addEventListener("pointerdown", e => { e.preventDefault(); tapNow(); });
  document.addEventListener("keydown", e => {
    if (e.code !== "Space" || e.repeat) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") return;
    e.preventDefault();
    tapNow();
  });
  setInterval(() => {
    const now = performance.now();
    onLogEvents(logDecoder.tick(now));
    onPrEvents(prDecoder.tick(now));
  }, 50);

  // ---- boot ----
  renderSetup();
  renderLog();
  nextTapPrompt();
  newListen();
  renderPractice();
  show((location.hash || "").replace("#", "") || "log");
})();
