# Gesture Log v2 (Tap)

Log that something happened, and how bad it was, by tapping the watch. You
don't need to look at it, say anything, or press a button — it works with the
screen off, in the dark, under a duvet.

The twist-based version is [v1](../gesture_symptoms_v1/README.md); the two are
separate apps with separate logs, so you can run both and compare.

## The gesture

1. **Password:** tap twice quickly, pause about three quarters of a second,
   then tap once more.
2. The watch **buzzes the pattern back** — buzz-buzz, pause, buzz. That's your
   go-ahead.
3. **Severity:** tap 1–5 times.
4. After 4 s with no tap, the watch buzzes your number back and logs it. A
   single long buzz means nothing was counted and nothing was logged — which is
   also how you cancel: arm it, then do nothing.

Every tap restarts the 4 s clock, so there's no rush. Tapping more than five
times logs a 5.

## Why a password instead of one gesture

Taps happen all day — door handles, keyboards, a wrist against a desk. A pair
of taps followed by a *spaced* single is a shape everyday knocks don't make,
and the watch stays completely deaf to single taps until it sees one.

## How it works

The detection lives in the accelerometer itself (a Kionix KX022), which has a
tap engine running far faster than Espruino polls the sensor. A finger tap is a
10–30 ms impulse — invisible in the 12.5 Hz accelerometer stream v1 reads, but
exactly what the chip's own detector is built for. Espruino surfaces it as
`Bangle.on("tap")`, and because the work happens in hardware the app does
nothing at all until a tap arrives.

Three things the app has to get right:

- **Its own buzzing.** The vibration motor shakes the accelerometer hard enough
  to register as taps, so the engine goes deaf while buzzing and for a moment
  after. If the confirmation buzz ever counts itself, raise `muteMs`.
- **Screen taps belong to the UI.** Poking the glass raises a `touch` *and*
  shakes the watch. Taps are ignored while the screen is unlocked (Only if
  locked) and for 250 ms after any touch. While counting, the screen is locked
  so your taps can't press anything.
- **The chip's idea of a "double".** Two taps ~0.2 s apart may arrive as one
  `double` event or as two singles, depending on the accelerometer's timing
  registers. Both are accepted, so the gesture works either way — and during
  counting a fused pair counts as two.

## App

- **Live test** — try the gesture without logging it. Shows the protocol state,
  the last tap (direction, single/double, and whether it was ignored) and a
  timeline of the last 8 seconds of taps. Doubles are drawn tall, ignored taps
  dotted.
- **Events** — newest first. Tap an event to delete a false positive.
- **Settings** — detection on/off, only-when-locked, lock-while-counting, tap
  sensitivity, count timeout, confirm window, and an optional sleep pause.
  Changes apply when the app reloads.

The widget (top right) shows a ring when idle, a blue dot while the password is
going in, a blue count while counting, and a green severity for a minute after
an event is logged.

## Tap sensitivity

`Tap sens.` writes the accelerometer's tap threshold register directly; `default`
leaves the firmware's own value alone. The stock setting is widely reported to
need a firm tap, so if the watch misses yours, try a few values — and test both
directions, since which way is "more sensitive" isn't documented reliably.
The setting is re-applied every 10 minutes because the firmware rewrites the
same control register whenever power-save changes.

Note that if `wakeOnTouch` is enabled, the firmware eats the first tap while the
watch is locked, using it to wake the screen.

## Battery

Negligible. The tap detector runs inside the accelerometer, which is already
powered, so there is no polling to pay for and no accelerometer stream to read —
v1's "high accuracy" setting has no counterpart here. A 250 ms timer runs only
between the first tap of a password and the end of a count.

## Data

- `gsym2.log.json` — `[{t: unix seconds, s: severity, src: "tap"}]`, last 500
  events.
- `gsym2.json` — settings.
