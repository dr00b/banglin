# banglin

Personal smart watch apps for [Bangle.js](https://banglejs.com/).

## Apps

- **[stormy](apps/stormy/README.md)** — informational alerts for weather shifts
  (pressure, temperature; optional humidity/precipitation via phone forecast)
  that may provoke arthritis flares.
- **[gesture_symptoms_v1](apps/gesture_symptoms_v1/README.md)** (Twist Log) —
  log that something happened, with a severity of 1–5, by twisting your wrist.
  Uses the onboard TensorFlow when a trained model is installed
  ([training tool](tools/gesture-train/README.md)).
- **[gesture_symptoms_v2](apps/gesture_symptoms_v2/README.md)** (Tap Log) — the
  same log, tapped instead of twisted: two quick taps and a spaced third arm
  it, then one tap per severity point. Detection happens inside the
  accelerometer's own tap engine, so it costs almost no battery.

Regenerate the app-loader screenshots (rendered in the real emulator
firmware) with `npm run screenshots`.

## Prototyping on the watch

```bash
npm install
npx espruino --list                                    # find your watch
npm run dev -- gesture_symptoms_v2 --port "Bangle.js 1a2b"
```

Installs the app over Bluetooth, restarts into it, streams the watch's
console, and re-uploads changed files on every save. Add `--ram` to iterate
on `app.js` without flash writes. See [CLAUDE.md](CLAUDE.md#prototyping-on-the-watch).

## Tests

```bash
npm test              # unit tests across apps/**/tests/*.test.js
npm run test:emulator # Playwright emulator/visual tests
npm run test:all      # both
```

On first run the visual baselines are empty — generate them (and refresh
after intentional UI changes) with:

```bash
npx playwright test --update-snapshots
```

See [CLAUDE.md](CLAUDE.md) for project conventions and the Bangle.js /
Espruino patterns used here.
