# banglin

Personal smart watch apps for [Bangle.js](https://banglejs.com/).

## Apps

- **[stormy](apps/stormy/README.md)** — informational alerts for weather shifts
  (pressure, temperature; optional humidity/precipitation via phone forecast)
  that may provoke arthritis flares.
- **[gesture_symptoms](apps/gesture_symptoms/README.md)** (Gesture Log) — log
  that something happened, with a severity of 1–5, by twisting your wrist.
  Uses the onboard TensorFlow when a trained model is installed
  ([training tool](tools/gesture-train/README.md)).

Regenerate the app-loader screenshots (rendered in the real emulator
firmware) with `npm run screenshots`.

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
