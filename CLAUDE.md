# CLAUDE.md

## Project Overview

**banglin** is a personal smart watch project built on the [Bangle.js](https://banglejs.com/) platform, which runs [Espruino](https://www.espruino.com/) JavaScript on embedded hardware.

- **License:** Apache 2.0
- **Language:** JavaScript (Espruino dialect)
- **Target hardware:** Bangle.js smart watch

## Repository Structure

```
banglin/
├── LICENSE          # Apache 2.0 license
├── README.md        # Project description
└── CLAUDE.md        # This file
```

This is an early-stage project. Source code, build configuration, and tooling have not yet been added.

## Code Style

Follow the [Espruino Code Style Guide](https://www.espruino.com/Code+Style).

### Formatting

- **Indentation:** 2 spaces, no tabs
- **Braces:** Opening brace on the same line as the statement (K&R / 1TBS style)
- **Single-line blocks:** Braces are optional

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

### Memory & Performance (Espruino-specific)

- Prefer **Typed Arrays** (`Uint8Array`, `Int16Array`, etc.) over standard arrays when the data range is known — they use far less RAM.
- Store large data blobs as **Base64 strings** using `atob()` or built-in converters.
- Use **objects as function parameters** instead of many positional arguments for readability and lower RAM usage.
- On Espruino v2.21+, pretokenisation means strings reference flash memory directly rather than consuming RAM. On earlier versions, wrap large data definitions inside functions so they load only when called.

### General Principles

- Keep code structured so bracket counting works correctly when pasting into the Espruino IDE (left-hand panel).
- Avoid unnecessary abstractions — embedded targets have tight resource constraints.
- Prefer simple, flat code over deep nesting.

## Development Environment

### Prerequisites

- [Espruino Web IDE](https://www.espruino.com/ide/) or [espruino CLI tools](https://www.npmjs.com/package/espruino)
- A Bangle.js device (or the emulator at https://www.espruino.com/ide/emulator.html)

### Uploading Code

Use the Espruino Web IDE to connect to the watch via Bluetooth and upload `.js` files, or use the CLI:

```bash
espruino --port <DEVICE> myapp.js
```

## Git Workflow

- **Default branch:** `master`
- Write clear, descriptive commit messages.
- Keep commits small and focused on a single change.
