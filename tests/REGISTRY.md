# Test registry

Every test in the repo, grouped by file, with what it's for. Stormy (`apps/stormy`) is unfinished and left out until it's done. When you add, rename or remove a test, update this file in the same change. `tests/registry.test.js` fails `npm test` if a test is missing here, if this file lists a test that no longer exists, or if an entry has no purpose.

Each `### path` heading is a test file. The rows under it are its tests, named exactly as in the code. A name with `${...}` comes from a loop and covers every case the loop makes; the tables under the `####` headings say what those cases are.

## Running

| Command | Runs |
|---|---|
| `npm test` | Every `*.test.js` (unit, engine, simulation, recordings, tools). Takes a few seconds. |
| `SIM_SEEDS=20 npm test` | The same, but each simulated scenario runs 20 random variations instead of 3. Use it as a long soak before changing detection rules. |
| `npm run test:emulator` | The Playwright specs (`*.spec.js`) against the Bangle.js 2 web emulator. |
| `npm run test:all` | Both. |

## Shared infrastructure (not tests)

| File | What it does |
|---|---|
| `tests/helpers/bangle-mock.js` | Stubs the `Bangle`, `E`, `g` and `WIDGETS` globals, and `require("Storage")` (including StorageFiles), for running watch code in node. |
| `tests/helpers/emulator.js` | Boots the web emulator in Playwright, sends it code, and screenshots the display. |
| `tests/helpers/accel-sim.js` | Synthetic accelerometer. It builds 400 Hz acceleration (gravity through the wrist's pose, arm movement, impacts, tremor, noise) and turns it into what the firmware reports: `tap` events from a model of the KX022 tap engine, and the 12.5 Hz `accel` stream with the firmware's `diff`/`mag`. |
| `tests/helpers/power-model.js` | Estimates the extra current from a session's counts (taps handled, accel samples, timer callbacks, redraws, time at 12.5 Hz), using the CLAUDE.md power table. |
| `apps/mr-morse/tests/harness.js` | Runs the real `boot.js` in node with a fake clock and timers. Feeds it a simulated or recorded timeline, models the buzz motor's own taps, and reports what it decided and what that cost. |
| `apps/mr-morse/tests/scenarios.js` | Everyday life, synthesised: the scenarios listed below. |
| `apps/mr-morse/tests/recording.js` | Parses a field recording, replays it through the harness, and compares the watch's decisions with the replay's. |

## mr-morse

How to record real sessions on the watch and turn them into tests: [apps/mr-morse/tests/FIELD-TESTS.md](../apps/mr-morse/tests/FIELD-TESTS.md).

#### Simulated scenarios

The `simulation.test.js` loops run over these. Each runs for `SIM_SEEDS` seeds under three models of how the chip reports taps:

- **single:** every tap reported on its own.
- **double:** the chip fuses taps 300–400 ms apart into one "double".
- **every-impact:** stress test; every knock over 0.3 g counts as a tap, however soft or blunt.

| Scenario | Kind | What it simulates |
|---|---|---|
| `burp-pat` | everyday | Burping a baby: bursts of pats on the back with the watch hand, sometimes rubbing instead |
| `burp-hold` | scattered | The watch arm holds the baby while the other hand pats, so weak jolts reach a still wrist; a third are too soft to register, so the rhythm reaches the engine with random gaps |
| `bouncing` | everyday | Rhythmic bouncing on the arm, with the odd bump from the baby's head or feet |
| `swing-knock` | everyday | Walking with the arm swinging and knocking the watch on door frames, tables and bags, with rebounds and fumbles |
| `door-knock` | everyday | Knocking on doors with the watch hand, including the password's own knock-knock … knock rhythm |
| `clapping` | everyday | Applause, and clap-along rhythms like clap-clap … clap |
| `walking` | everyday | Brisk walking: arm swing and heel strikes |
| `running` | everyday | Running: hard, regular footfalls and a big arm swing |
| `sleep` | everyday | Asleep: still, rolling over, a hand hitting the headboard |
| `typing` | scattered | Typing with the wrist on the desk: keystrokes, hard keys, mouse, setting the wrist down |
| `drumming` | scattered | Drumming fingers on the desk beside the watch wrist |
| `driving` | scattered | Hands on the wheel: road buzz, potholes hit by the front and then the rear wheels |
| `chores` | scattered | Washing up and cooking: clinks from every direction, chopping |
| `day-mix` | scattered | A bit of everything back to back, with quiet gaps between |
| `password-seated` | intent | Password then severity, wrist resting on a table or thigh |
| `password-held` | intent | Password with the watch arm held up unsupported |
| `password-in-bed` | intent | Password at 3am on a pillow, taps softened. A soft one may not register: 90% floor, and up to 1% of counts one short |
| `password-after-typing` | intent | Typing, a pause of a couple of seconds, then the password |
| `password-walking` | limit | Password while walking: refused, the wrist is moving |
| `password-too-soon` | limit | Password within a second of a knock: refused, not from quiet |

What each kind must do:

- **everyday:** never arm (no echo buzz), log nothing, write nothing to flash.
- **scattered:** knocks land at random on a still or slowly moving wrist, so three can occasionally line up like the password. Default settings are capped at 1.5 false logs per simulated hour (realistic models) and 6 (stress); with Tap direction set, 0.25. A 30-seed soak measured at most 0.6, 3.7 and 0.
- **intent:** log what was tapped, at least 95% of the time (90% in bed). Each log is matched to the attempt whose taps armed it. It must never be more than was tapped. It may be fewer only when a tap was too soft for the chip to register, which the engine can't see: at most 1% of attempts in bed, never elsewhere. A log armed between attempts (by scattered knocks, e.g. typing) is a false log and counts against the stress cap.
- **limit:** mostly refused, for the stated reason.

Battery budget for every everyday and scattered scenario, per chip model: the accel stream may be on at most 2.5% of the time (10% in stress), and what the engine adds beyond handling each tap must stay under 5% of the watch's idle draw (20% in stress).

### `apps/mr-morse/tests/tapseq.test.js`

The pure tap protocol (`lib/morse-protocol.js`), driven by hand-written tap timings.

| Test | Purpose |
|---|---|
| `the measured rhythm arms, as two singles or one fused double` | The user's own rhythm (230 ms pair, 700 ms pause) arms after the silence that follows, whichever way the chip reports the pair. |
| `a lone tap goes nowhere` | A single knock times out back to idle with nothing to show. |
| `burping: steady pats at any pace never arm` | Even trains of taps from 250 ms to 1 s apart never produce an echo. |
| `three even taps are not dot-dot-pause-dot` | The original bug: three evenly spaced taps no longer pass for the password. |
| `the pause has to be clearly longer than the pair` | A pause of 2× the pair (a beat missing from a steady pat) is refused; 2.3× is accepted. |
| `...but not hugely longer: the rhythm has a shape both ways` | A pause over 5× the pair is refused too, so the rhythm is specific. |
| `a steady pat with a beat missing never arms` | Steady pats with every third one too soft to register never arm. |
| `a password has to start out of silence` | A perfect password begun under a second after another tap is refused as busy. |
| `a run of taps with gaps in it is still a run` | Three taps in four seconds block a password even when each gap is over a second; it works once things die down. |
| `taps the caller sat out still count as noise` | Taps the engine ignored (e.g. during cooldown) still count towards the quiet a password needs. |
| `a tap straight after the password cancels it` | Knocking that carries on after the third tap cancels the attempt and no echo follows. |
| `a drum roll is too quick to be the pair` | Taps 60–150 ms apart (finger rolls, rebounds) can't make the pair. |
| `with a tap direction set, only taps from there count` | The optional direction lock refuses a tap from any other direction and accepts a password from the set one. |
| `a fused double in the middle of a sequence is noise` | A chip "double" after the sequence has started is refused instead of restarting it. |
| `two taps too far apart are not a pair` | A second tap after the pair window ends the attempt. |
| `the caller can veto an attempt` | The engine's own veto (wrist moving) drops the attempt and records why. |
| `a bounce off the first tap is ignored, the real pair still lands` | A rebound within 60 ms is ignored, not treated as the second tap. |
| `the wait expires silently` | If no third tap comes within 5× the pair gap, the attempt ends with no buzz. |
| `severity counts singles as one and fused pairs as two` | While counting, a chip "double" counts as two taps. |
| `more than five taps is patting, not a count: cancelled at once` | A sixth counting tap cancels instead of logging a 5. |
| `each tap restarts the four second clock` | Counting ends 4 s after the last tap, not 4 s after arming. |
| `arming and tapping nothing cancels` | Armed with no taps counted gives a cancel. |
| `a very long count is cut off at the hard cap` | Counting stops at 20 s regardless. |
| `taps during the echo are ignored` | Nothing counts while the watch buzzes the password back. |

### `apps/mr-morse/tests/boot.test.js`

The background engine (`boot.js`) under a fake clock: muting, locking, logging, the stillness check and power state.

| Test | Purpose |
|---|---|
| `does nothing when detection is disabled` | With detection off, no engine and no tap listener. |
| `the measured rhythm arms, counts three taps and logs severity 3` | End to end: password, echo (buzz-buzz, pause, buzz), three taps, logged as 3. |
| `a chip-fused double arms it too, and counts as two` | The fused-double spelling of the pair works, and a fused pair counts as two. |
| `the echo's own buzz is not counted` | The motor shaking the accelerometer during the echo isn't counted. |
| `a lone tap leads nowhere and starts no event` | A single knock goes back to idle with no buzz. |
| `taps on the glass are left to the UI` | A tap right after a screen touch is ignored; one after the 250 ms veto isn't. |
| `taps are ignored while the screen is unlocked` | With "Only if locked", an unlocked screen means taps belong to the UI. |
| `counting locks the screen and restores it afterwards` | The screen is locked while counting, then put back as it was. |
| `arming and then tapping nothing logs nothing` | A cancel logs nothing and gives the long buzz. |
| `more than five taps cancels instead of logging a five` | Overcounting cancels with the long buzz and nothing is logged. |
| `burping: a minute of steady pats logs nothing` | Steady pats at four paces, some fused, never even echo. |
| `a lone tap doesn't wake the accelerometer stream` | The accel stream and fast polling stay off until a pair is in (battery). |
| `a moving wrist is not tapping: dropped as soon as it's plain` | Half a second of a moving wrist after the pair drops the attempt early, then the stream stops and power-save comes back. |
| `a still wrist with a few tap spikes arms` | The taps' own spikes in the stream don't make a still wrist count as moving. |
| `patting that stops: moving while the taps go in, still after, is dropped` | Movement during the password is judged on its own, so a still arm afterwards can't outvote it. |
| `the stillness check can be switched off` | Still wrist set to off: no accel stream, password still works. |
| `taps right after an event are ignored (cooldown)` | Taps during the 3 s cooldown after an event are ignored. |
| `dry run (Live test) reports but does not log` | The Live test reports the result without writing the log. |
| `the sleep window is off by default, so 3am still logs` | Out of the box, logging at night works. |
| `the sleep window pauses detection when switched on` | With "Pause in sleep" on, taps in the window are ignored. |
| `the accelerometer's tap threshold is only written when configured` | Chip registers are left alone unless Tap sens. is set, and then written in the right order. |
| `no timer runs while nothing is happening` | The 250 ms tick only runs mid-sequence (battery). |
| `every tap is kept for the Live test, accepted or not` | Every tap is recorded for the Live test's timeline, capped at 16. |
| `the Live test works on an unlocked screen, but still ignores glass pokes` | The diagnostic screen can arm the engine without locking itself, but touches are still vetoed. |
| `protocol constants can be tuned from morse.json` | Any protocol constant set in `morse.json` overrides the default. |
| `the widget is only redrawn when what it shows changes` | 60 pats cause a handful of widget redraws, not 60 (battery). |
| `a field-test recording in progress keeps counts out of the event log` | While recording, counts are made but not written to the event log. |

### `apps/mr-morse/tests/simulation.test.js`

Simulated everyday life through the real engine: the proof that it doesn't arm, log or waste battery when nobody is signalling, and that the password still works. The loops run over the scenario table above.

| Test | Purpose |
|---|---|
| `everyday: ${s.name} never arms` | For every everyday scenario, seed and chip model: no echo, nothing logged, no buzz, no flash write, and the engine back at rest at the end. |
| `battery: ${s.name} stays within budget` | For every everyday and scattered scenario, per chip model: accel-stream time and the engine's extra current stay within the battery budget above. |
| `scattered: ${s.name} rarely logs, rarer still with Tap direction set` | For every scattered scenario: false logs per simulated hour stay under the caps, with and without the direction lock; only counted events are written. |
| `intent: ${s.name} logs what was tapped, never a wrong number` | For every intent scenario: every log armed by an attempt has that attempt's severity, never more, and fewer only within the soft-tap allowance. Misses are allowed but must stay rare. False logs between attempts stay under the stress cap. |
| `intent: ${s.name} still mostly works with Tap direction set` | The direction lock's cost: at least 85% of passwords still log, even though the chip model sometimes misreads a tap's direction. |
| `limit: ${s.name}` | For every limit scenario: refused for the stated reason, almost always. |

### `apps/mr-morse/tests/recordings.test.js`

Field recordings from the watch (`recorder.js`), replayed through the same engine. The loop runs over every `.csv` in `apps/mr-morse/tests/recordings/`.

| Test | Purpose |
|---|---|
| `recorder round trip: what the watch decided, the replay decides too` | A simulated session recorded by the real recorder on the mocked watch, including an app load, parses cleanly, holds every decision, and replays to the same decisions. |
| `recorder: counts are traced but not logged, and it stops itself` | Recording doesn't fill the event log, removes its marker when time is up, and leaves the watch at rest. |
| `recorder: writes to flash every couple of seconds, not per reading` | The recorder buffers: about one flash write every 2 s, not one per 12.5 Hz reading. |
| `recording summary describes the session at the sensor` | The summary used to compare a real session with its simulated scenario: duration, tap directions, what was logged, the password rhythm, whether taps arrive on the accelerometer poll, and accel-stream time. |
| `recording parser flags lines it can't read` | Garbled or truncated lines are reported, not silently dropped. |
| `field recordings: none yet` | Placeholder, skipped while there are no field recordings. |
| `field recording ${f}: the replay decides what the watch decided` | For each real recording: every line parses, and the node replay makes the same decisions as the watch did, within 300 ms. |
| `field recording ${f}: meets its expectation` | For each real recording: everyday sessions never armed; password sessions logged only the intended severity, for at least 80% of attempts. |

### `apps/mr-morse/tests/app.test.js`

The app UI (`app.js`), settings page (`settings.js`) and widget (`widget.js`).

| Test | Purpose |
|---|---|
| `main menu shows the event count and whether detection is on` | Main menu title, event count and detection state. |
| `detection shows 'off' when the engine isn't running` | Without the engine, the menu says off. |
| `live test runs the engine in dry-run mode and restores it on back` | The Live test sets dry run and its hook, and undoes both on back. |
| `live test draws every protocol state without blowing up` | Every state, the rejection reason and the wrist-movement figure render. |
| `live test says why a tap was ignored` | Ignored taps show their reason, and direction rejections show as such. |
| `field test: starting a session writes its header and marker and starts recording` | Start writes the recording header (session, expectation, severity, attempts) and the marker, and the recorder hooks in. |
| `field test: an everyday session expects silence; stop ends it` | Everyday sessions are labelled silent, show time left, and Stop now removes the marker and writes the stop line. |
| `field test: the Live test is refused while recording` | The Live test (which changes engine behaviour) can't spoil a recording. |
| `field test: recordings are listed by session and can be deleted` | Recordings are listed by their header's session name and deleted on confirm. |
| `event log lists newest first and deletes on confirm` | Event list order and deleting a false positive. |
| `settings defaults: locked-only on, sleep pause off, 4s count timeout` | Settings page defaults. |
| `tap direction defaults to any and saves the one chosen` | Tap direction starts at any, Still wrist at 0.10 g, and a chosen direction is saved. |
| `settings persist changes` | Settings changes are written to `morse.json` in the right units. |
| `widget is hidden without the engine and shows the count while counting` | Widget width with no engine, and the live count while counting. |

## Tools and infrastructure

### `scripts/dev.test.js`

The `npm run dev` upload builder (`scripts/dev.js`), run against a fake watch.

| Test | Purpose |
|---|---|
| `install writes every storage entry and loads the app` | An install writes every file intact (including `../../lib` ones), rebuilds boot code and loads the app. |
| `large files are split into chunked writes that reassemble exactly` | Big files go up in chunks and come out identical. |
| `evaluate entries store the expression's value, not its source` | Icons are stored as their value, as the app loader does. |
| `only changed files: no boot rebuild unless a boot file is included` | Re-uploading app code alone skips the boot rebuild. |
| `RAM mode runs the installed boot file, then the app source` | `--ram` runs boot code first and writes nothing to flash. |
| `quote escapes high bytes and rejects wide characters` | Source is quoted safely for Espruino's 8-bit strings. |
| `port argument picks address vs device-name connection` | `--port` accepts addresses, serial ports and device names. |
| `argument parsing` | Command-line options. |

### `scripts/pull.test.js`

The `npm run pull` recording fetcher (`scripts/pull.js`), run against a fake watch.

| Test | Purpose |
|---|---|
| `the app's StorageFile data is what gets pulled` | Which files are pulled comes from `metadata.json`, and only recordings match. |
| `dump and parse: every file comes back whole, with its line count checked` | The code sent to the watch prints every recording, and the parser gets it back byte for byte. |
| `a line lost on the way is caught` | A short file is flagged, not saved as if complete. |
| `erase deletes exactly the files that were pulled` | `--erase` deletes only what arrived intact. |
| `pull arguments` | Command-line options. |
| `wildcards match like the app loader's` | `data` wildcards become the right patterns. |

### `tests/accel-sim.test.js`

The synthetic accelerometer and the power model behave like the real thing before anything is tested against them.

| Test | Purpose |
|---|---|
| `the same seed builds the same session` | Scenarios are reproducible from their seed. |
| `a still watch reads 1 g at 12.5 Hz with almost no change between readings` | Gravity, the stream rate and the firmware's `diff` are right for a still watch. |
| `a firm finger tap registers once; a push and a swing don't` | The tap-engine model passes sharp knocks and rejects slow pushes and arm swings; a face tap reads "back". |
| `a light touch doesn't register` | Below threshold is no tap. |
| `with double-tap detection on, only taps 300-400 ms apart fuse, and reports wait for the window` | The chip's double-tap timing as modelled, and that unfused gaps are kept. |
| `every-impact mode reports every knock, whatever the chip model would make of it` | The stress mode reports every impact, with its direction. |
| `a tap barely shows in the 12.5 Hz stream; a moving arm does` | What the stillness check relies on: taps hardly move the median, an arm swing clearly does. |
| `timeline merges taps and readings in time order` | The harness gets events in order. |
| `power model: nothing done costs nothing; a second of full-rate accel costs what CLAUDE.md says` | The power model matches the CLAUDE.md table. |

### `tests/registry.test.js`

This file stays in step with the code.

| Test | Purpose |
|---|---|
| `every test is in the registry` | Every test in the repo appears here. |
| `the registry lists no test that no longer exists` | Nothing here is stale. |
| `every registry entry says what its test is for` | No entry without a purpose. |

## Emulator (Playwright)

Run with `npm run test:emulator`. They need Chromium and network access to espruino.com.

### `tests/emulator/smoke.spec.js`

| Test | Purpose |
|---|---|
| `emulator loads and renders watch display` | The emulator boots and draws, compared against a snapshot. |
| `can execute JavaScript on emulator` | Code sent to the emulator runs and draws, compared against a snapshot. |

### `apps/mr-morse/tests/emulator.spec.js`

| Test | Purpose |
|---|---|
| `a field test records on the real firmware, and the pull code reads it back` | Runs `recorder.js` and the engine on the real Espruino firmware: the engine loads the recorder at boot, taps and readings are appended to a StorageFile, stopping removes the marker, and the code `npm run pull` sends lists and prints the file intact. |
