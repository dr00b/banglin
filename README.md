# banglin

Personal smart watch apps for [Bangle.js](https://banglejs.com/).

## Apps

- **[stormy](apps/stormy/README.md)** — informational alerts for weather shifts
  (pressure, temperature; optional humidity/precipitation via phone forecast)
  that may provoke arthritis flares.
- **[mr-morse](apps/mr-morse/README.md)** — a fork of Tap Log with its own
  protocol library, log and settings, for growing a richer tap language.

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
