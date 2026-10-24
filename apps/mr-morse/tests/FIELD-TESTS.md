# Field tests

The simulation (`simulation.test.js`) proves the engine against *modelled* accelerometer signals. Field tests check that model against your real watch and real life. Every session you record becomes a permanent regression test.

## What "the same result" means

Each recorded session is checked at three levels:

| Level | Question | How it's checked |
|---|---|---|
| 1. Engine | Does node decide exactly what the watch decided, given the same taps and readings? | Automatic: `field recording … the replay decides what the watch decided` |
| 2. Outcome | Did the everyday session stay silent? Did the passwords log the right number? | Automatic: `field recording … meets its expectation` |
| 3. Model | Does real life look like the simulated scenario of the same name (tap rate, wrist movement, direction)? | The summary below, compared with the simulation's numbers |

If level 1 holds, the simulation's results apply to the real engine. If level 3 holds too, they apply to your real life.

## The loop

1. **Record.** On the watch: Mr Morse → Field test. Pick a **Session** (and the **Severity** and **Attempts** for password sessions), choose **Minutes**, then **Start**. Lock the watch and do the activity. You can leave the app; recording carries on in the background. It stops by itself with two long buzzes, or use **Stop now**.
2. **Pull** the recordings to your computer:
   ```bash
   npm run pull -- mr-morse --port "Bangle.js 1a2b"           # copies to apps/mr-morse/tests/recordings/
   npm run pull -- mr-morse --port "Bangle.js 1a2b" --erase   # ...and frees the space on the watch
   ```
   Each file's line count is checked on arrival, so a garbled transfer is reported rather than saved. Fallback: in the Espruino Web IDE, open Storage and save the `morse.r….csv` file into that folder.
3. **Test:** `npm test`. Each recording is replayed (levels 1 and 2).
4. **Look:** `node apps/mr-morse/tests/recording.js apps/mr-morse/tests/recordings/<file>.csv` prints the session's summary (level 3).
5. **Commit** the recordings. A 10-minute session is about 200 KB.

While recording, the app doesn't write counted events to your event log, and the Live test is unavailable, because it changes how the engine behaves. Recording keeps the accelerometer at 12.5 Hz and handles every reading, which costs roughly an extra 0.3 mA. That's negligible for a 30-minute session, but it's why sessions have a time limit.

## Sessions

Do them roughly in this order: the false positives you reported first, then the password checks, then everything else. Keep default settings (Tap direction: any) unless a step says otherwise. Leave **Pause in sleep** off: the replay runs on your computer's clock, so a sleep window wouldn't line up.

| Session | What to do | Minutes | Expect |
|---|---|---|---|
| `burp-pat` | Burp your son as usual, patting with the watch hand. | 10 | silent |
| `burp-hold` | Hold him on the watch arm; pat with the other hand. | 10 | silent |
| `swing-knock` | Walk around, arms swinging naturally. Every half minute or so, let the watch brush a door frame, a table edge or a bag (gently). | 10 | silent |
| `password-seated` | Sit, wrist resting. Tap the password and the severity, wait for the buzz-back, and repeat, with at least 15 s between attempts. | 5 | logs |
| `password-after-rest` | Rest the watch arm completely still for 3 minutes, then do the password once. Repeat: 3 minutes still, password. | 15 | logs |
| `typing` | Type normally. | 10 | silent |
| `drumming` | Drum your fingers on the desk now and then, wrist resting. | 10 | silent |
| `door-knock` | Knock on doors, including knock-knock … knock. | 5 | silent |
| `clapping` | Clap along to some music; applaud. | 5 | silent |
| `bouncing` | Bounce your son on the watch arm. | 10 | silent |
| `walking` | Walk briskly. | 10 | silent |
| `running` | Run. | 10 | silent |
| `chores` | Wash up, cook, tidy. | 20 | silent |
| `driving` | Only as a passenger, or wear it while driving and do nothing with it. Never tap it while driving. | 20 | silent |
| `sleep` | Wear it in bed. | 30 | silent |
| `day-mix` | Just live: anything goes. | 30 | silent |
| `password-held` | As password-seated, with the watch arm held up unsupported. | 5 | logs |
| `password-in-bed` | As password-seated, lying down, wrist on the pillow. | 5 | logs |
| `password-after-typing` | Type for half a minute, stop, wait two seconds, then password. Repeat. | 5 | logs |
| `password-walking` | Password while walking. Mostly refused by design. | 5 | logs (no minimum) |

For the password sessions, set **Severity** and **Attempts** before you start, then tap exactly that. The test checks that nothing else was logged, and that at least 80% of attempts were.

## Three open questions the recordings answer

The simulation had to assume these. Check each one against the real watch and act on what you find:

1. **Are taps delivered on the accelerometer poll?** Look at `tapsOnPoll` in any summary. Near 100% means the firmware reads taps when it polls the accelerometer. When power-save has slowed that polling to 1.25 Hz (after a minute or so of stillness), taps would then arrive up to 800 ms late and close pairs would merge. `password-after-rest` shows whether that breaks the password. If it does, the engine needs to force fast polling at the first tap, not after the pair. About 5% means taps arrive independently and the question is closed.
2. **Do your finger taps always report the same direction?** Look at `directions` in the password sessions' summaries. If at least 95% of the taps share one direction, set **Tap direction** to it. In the simulation, that removes almost every remaining false positive from scattered knocks (typing, drumming, chores, driving). Then re-record `password-seated` with the lock on to confirm your hit rate.
3. **What is your real rhythm?** `rhythm` lists each password's pair gap and pause in ms. The engine accepts a pair 150–350 ms apart and a pause 2.3–5× the pair (and 450–1500 ms). If yours sits near an edge, tune it in `morse.json` (e.g. `"rhythmRatio": 2.1`). Check the change against your recordings before putting it on the watch:
   ```bash
   node apps/mr-morse/tests/recording.js apps/mr-morse/tests/recordings/<file>.csv --set rhythmRatio=2.1
   ```

## When a check fails

- **Level 1, the replay differs from the watch.** The node harness misses something the firmware does, such as timer timing or event order. The simulation's results are suspect until that's fixed: fix `harness.js` until the recording replays identically.
- **Level 2, an everyday session armed.** That's a real false positive, and now it's reproducible. Fix the engine until the recording passes and `npm test` (with `SIM_SEEDS=20`) still passes. Then add a scenario to `scenarios.js` that reproduces it, so the simulation covers it from now on.
- **Level 2, password attempts missed.** Use the summary to see why: rhythm, direction, wrist movement (`decisions` lists the reasons). Try a tuning with `--set`, then put it in `morse.json` on the watch.
- **Level 3, real life doesn't look like the scenario.** Compare `tapsPerMin`, `wristMedianG` and `streamOnPct` with the simulation's diagnostics:
  ```bash
  node --test --test-reporter=spec apps/mr-morse/tests/simulation.test.js
  ```
  Then adjust the scenario in `scenarios.js` until it does, so the simulation stays representative.
