# CLAUDE.md

## Project Overview

**banglin** is a personal smart watch project built on the [Bangle.js](https://banglejs.com/) platform, which runs [Espruino](https://www.espruino.com/) JavaScript on embedded hardware.

- **License:** Apache 2.0
- **Language:** JavaScript (Espruino dialect)
- **Target hardware:** Bangle.js smart watch

## Bangle.js App Structure

A Bangle.js app follows a standard file layout. Use the app ID as a prefix for all on-device file names.

```
apps/<appid>/
├── metadata.json       # App manifest (required)
├── ChangeLog           # Version history (plain text, no extension)
├── README.md           # User-facing documentation
├── app.js              # Main application code  → stored as <appid>.app.js
├── app-icon.js         # Icon (heatshrink-compressed) → stored as <appid>.img
├── app.png             # Source icon image (48x48 recommended)
├── settings.js         # Settings menu (if applicable) → stored as <appid>.settings.js
└── screenshot-*.png    # Screenshots for the app loader
```

### metadata.json

Every app must have a `metadata.json` with at minimum:

```json
{
  "id": "myapp",
  "name": "My App",
  "shortName": "MyApp",
  "version": "0.01",
  "description": "Short description of the app",
  "icon": "app.png",
  "tags": "tool",
  "supports": ["BANGLEJS", "BANGLEJS2"],
  "readme": "README.md",
  "storage": [
    { "name": "myapp.app.js", "url": "app.js" },
    { "name": "myapp.img", "url": "app-icon.js", "evaluate": true },
    { "name": "myapp.settings.js", "url": "settings.js" }
  ],
  "data": [
    { "name": "myapp.settings.json" }
  ]
}
```

Key fields:
- **`storage`**: Maps source files to on-device names. Use `"evaluate": true` for icon files.
- **`data`**: Lists runtime data files the app creates (settings, saved state). These are preserved across app updates.
- **`dependencies`**: Declare library/widget dependencies (e.g. `{"scheduler": "type"}`).
- **`supports`**: Always target both `BANGLEJS` and `BANGLEJS2` unless hardware-specific.

### ChangeLog

Plain text file (no `.md` extension). Format: version number followed by a colon and description.

```
0.01: New App!
0.02: Fix bug with timer scheduling
0.03: Add new feature
```

## Code Style

Follow the [Espruino Code Style Guide](https://www.espruino.com/Code+Style).

### Formatting

- **Indentation:** 2 spaces, no tabs
- **Braces:** Opening brace on the same line as the statement (K&R / 1TBS style)
- **Single-line blocks:** Braces are optional
- **Semicolons:** Always use semicolons to terminate statements
- **String delimiters:** Prefer double quotes for regular strings; use backtick template literals for interpolation

```javascript
if (condition) {
  doSomething();
  doMore();
} else {
  doOther();
}

if (condition) doSomething(); // single-line is fine without braces
```

### Naming

| Kind                  | Convention   | Example           |
|-----------------------|--------------|-------------------|
| Constants             | ALL_CAPS     | `MAX_TIMEOUT`     |
| Variables & functions | camelCase    | `myLongVarName`   |
| Classes & prototypes  | PascalCase   | `MyClass`         |

### Variable Declarations

- Use `const` for values that won't be reassigned.
- Use `var` (not `let`) for mutable variables in app-level scope — Espruino handles `var` more efficiently in some contexts.
- Use `let` inside block-scoped loops or conditionals where needed.

## Espruino & Bangle.js API Patterns

### Requiring Modules

Espruino uses inline `require()` — modules are loaded at the call site, not imported at the top of the file. This is idiomatic and preferred:

```javascript
// Correct — inline require
var alarms = require("sched").getAlarms();
var time = require("time_utils").decodeTime(alarm.t);
var dateStr = require("locale").date(new Date(d), 1);

// Avoid — do NOT hoist to top-of-file imports
```

Common modules:
- `require("Storage")` — persistent flash storage (read/write JSON, files)
- `require("sched")` — alarm/timer scheduler library
- `require("time_utils")` — time encoding/decoding/formatting
- `require("date_utils")` — day-of-week names, month names
- `require("locale")` — locale-aware date/number formatting
- `require("buzz_menu")` — vibration pattern picker for menus

### Settings Pattern

Settings use `Storage.readJSON` with a safe fallback and `Object.assign` for defaults:

```javascript
const settings = Object.assign({
  optionA: true,
  optionB: false
}, require("Storage").readJSON("myapp.json", 1) || {});
```

The second argument `1` to `readJSON` suppresses errors if the file doesn't exist. Always provide sensible defaults via `Object.assign`.

To save settings:

```javascript
require("Storage").write("myapp.json", settings);
```

### Settings Page (settings.js)

Settings files export a single self-invoking function that receives a `back` callback:

```javascript
(function(back) {
  var settings = Object.assign({ /* defaults */ },
    require("Storage").readJSON("myapp.json", 1) || {});
  const save = () => require("Storage").write("myapp.json", settings);

  E.showMenu({
    "": { title: "myapp" },
    "< Back": back,
    "Some Option": {
      value: !!settings.someOption,
      onchange: v => { settings.someOption = v; save(); }
    }
  });
})
```

### Menu System

Bangle.js uses `E.showMenu()` for hierarchical menus. Follow these patterns:

```javascript
const menu = {
  "": { title: "Menu Title" },          // title entry (empty-string key)
  "< Back": () => previousMenu(),       // back always first
  /*LANG*/"Option": { value, onchange } // translatable labels
};
E.showMenu(menu);
```

- Use `/*LANG*/` comments before user-visible strings to mark them for translation.
- Menu items can be simple functions (for actions) or objects with `value`/`onchange`/`format`/`min`/`max`/`wrap` properties.
- Use `E.showPrompt()` for confirmation dialogs.
- Use `E.showAlert()` for informational dialogs.
- Use `setTimeout()` to defer menu transitions (avoids UI glitches): `setTimeout(showNextMenu, 10, arg1, arg2)`.

### Icons

Icons are stored as heatshrink-compressed Base64 strings prefixed with `"\0"`:

```javascript
const icon = "\0" + atob("GBiBAAAAAAA...");
```

For theme-aware icons, branch on `g.theme.dark`:

```javascript
const icon = "\0" + (g.theme.dark
  ? atob("dark-variant-base64...")
  : atob("light-variant-base64..."));
```

### Widget Loading

Apps that show widgets should call both load and draw at startup:

```javascript
Bangle.loadWidgets();
Bangle.drawWidgets();
```

### Time Handling

Times are stored as milliseconds since midnight (0–86400000). Use the `time_utils` module:

```javascript
var encoded = require("time_utils").encodeTime({ h: 8, m: 30, s: 0 });
var decoded = require("time_utils").decodeTime(encoded);
var formatted = require("time_utils").formatTime(encoded);
var now = require("time_utils").getCurrentTimeMillis();
```

### Internationalization

- Wrap all user-visible strings with `/*LANG*/` comments: `/*LANG*/"Delete"`.
- This allows the Bangle.js app loader to extract and replace strings for translation.
- Do NOT use `/*LANG*/` on internal identifiers or non-displayed strings.

## Memory & Performance

- Prefer **Typed Arrays** (`Uint8Array`, `Int16Array`, etc.) over standard arrays when the data range is known — they use far less RAM.
- Store large data blobs as **Base64 strings** using `atob()` or built-in converters.
- Use **objects as function parameters** instead of many positional arguments for readability and lower RAM usage.
- On Espruino v2.21+, pretokenisation means strings reference flash memory directly rather than consuming RAM. On earlier versions, wrap large data definitions inside functions so they load only when called.
- Use `delete menu[key]` to conditionally remove menu items rather than rebuilding the menu object — avoids extra allocations.
- Keep code structured so bracket counting works correctly when pasting into the Espruino IDE.

## Power Consumption
Consider power consumption when using various tools. Turn off when not used.

- Idle, accelerometer on 12.5Hz - 0.3mA
- Idle, accelerometer on 1.25Hz (Bangle.setPollInterval(800)) - 0.15mA (default if not moved for ~120s)
- Idle, clock (s7clk) updating once a second - 0.5mA
- BLE Connected in high bandwidth mode - 0.75mA
- Compass on, 12.5Hz - 1.2mA (+0.6mA)
- Compass on, 1.25Hz (Bangle.setPollInterval(800)) - 1.0mA (+0.2mA)
- Heart rate monitor on - 1.0mA (+0.7mA) (KickStarter version = ~1.5mA)
- 100% CPU usage running JavaScript - 4mA (+3mA)
- GPS on - 26mA (+25mA)
- GPS on (set to GPS only) - 20mA (+19mA)
- LCD touchscreen enabled (unlocked) - 2.8mA (+2.5mA)
- LCD backlight on - 17mA (+16mA)
- Turned off (Bangle.off - no RTC) - 0.02mA
- Turned off (Bangle.softOff) - 0.03mA

## Development Environment

### Devcontainer (Claude Code hosted VMs + VS Code)

The project includes a devcontainer at `.devcontainer/devcontainer.json`. This is used automatically by Claude Code hosted VMs and can be opened locally in VS Code via "Reopen in Container".

The container provides:
- Node.js 20
- Playwright + Chromium (for emulator visual tests)
- npm scripts for testing

On container creation, `npm install` and `npx playwright install chromium --with-deps` run automatically.

### Prerequisites (local host)

- [Espruino Web IDE](https://www.espruino.com/ide/) or [espruino CLI tools](https://www.npmjs.com/package/espruino)
- A Bangle.js device (or the emulator at https://www.espruino.com/ide/emulator.html)

### Deploying to Watch

Deployment to the physical watch runs on the **host machine** (not inside the devcontainer), because Bluetooth LE access is impractical inside a container.

```bash
npm install -g espruino
espruino --port BT apps/myapp/app.js
```

### Reference

- [Bangle.js API Reference](https://banglejs.com/reference)
- [Espruino API Reference](https://www.espruino.com/Reference)
- [BangleApps Repository](https://github.com/espruino/BangleApps) — examples of community apps

## Testing

### Unit Tests

Use Node.js built-in test runner (`node:test`). No external test framework needed.

```bash
npm test
```

Unit tests live in `tests/unit/` and use `node:test` + `node:assert`. When app code exists, add a Bangle.js API mock in `tests/helpers/bangle-mock.js` to stub globals like `Bangle`, `E`, `g`, and `require("Storage")`.

### Visual / Emulator Tests

Playwright drives the Bangle.js web emulator at `espruino.com/ide/emu/emu_banglejs2.html` to visually verify app rendering on the watch display.

```bash
npm run test:emulator
```

Emulator tests live in `tests/emulator/`. They navigate to the emulator page, inject JavaScript via `Module.ccall`, and take screenshots of the `canvas#gfxcanvas` element (240x240 watch display).

To update screenshot baselines after intentional changes:

```bash
npx playwright test --update-snapshots
```

### Run All Tests

```bash
npm run test:all
```

## Git Workflow

- **Default branch:** `main`
- Write clear, descriptive commit messages.
- Keep commits small and focused on a single change.
- Maintain a `ChangeLog` file with version-numbered entries for each release.
