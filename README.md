# banglin

Personal smart watch apps for [Bangle.js](https://banglejs.com/).

## Apps

- **[stormy](apps/stormy/README.md)** — informational alerts for weather shifts
  (pressure, temperature; optional humidity/precipitation via phone forecast)
  that may provoke arthritis flares.

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

Headless browsers in minimal sandboxes sometimes fail to render the
espruino.com emulator canvas; if your captures come out blank, run the
emulator tests on a desktop Chromium / the devcontainer rather than a
fully-headless CI worker.

See [CLAUDE.md](CLAUDE.md) for project conventions and the Bangle.js /
Espruino patterns used here.
