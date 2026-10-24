# Mr Morse

Log that something happened, and how bad it was, by tapping the watch. You
don't need to look at it, say anything, or press a button — it works with the
screen off, in the dark, under a duvet.

Forked from [Gesture Log v2](../gesture_symptoms_v2/README.md) to grow a richer
tap language. It has its own protocol library (`lib/morse-protocol.js`), its own
settings and its own log, so changes here never touch v2 — run both at once if
you want to compare.

## The gesture

1. **Password:** with the watch arm still and no tapping for a second
   beforehand, tap twice quickly, pause about three quarters of a second, then
   tap once more — dot-dot … dot — and **stop**.
2. About half a second later the watch **buzzes the pattern back** —
   buzz-buzz, pause, buzz. That's your go-ahead.
3. **Severity:** tap 1–5 times.
4. After 4 s with no tap, the watch buzzes your number back and logs it. A
   single long buzz means nothing was logged — which is also how you cancel:
   arm it, then do nothing.

Every tap restarts the 4 s clock, so there's no rush. Tapping more than five
times cancels straight away (long buzz) rather than logging a 5: that many taps
is far more likely to be patting than a severity.

## Why a password instead of one gesture

Taps happen all day — door handles, keyboards, a wrist against a desk, patting
a baby's back. Those come in *trains* of fairly even knocks, often with the
watch arm moving. The password is checked against that, all of which has to
hold:

| Check | Default | Rejects |
|-------|---------|---------|
| Silence before the first tap | 1 s | joining a train part-way |
| Pair gap | 100–350 ms | slow or bouncing taps |
| Pause before the last tap | ≥ 2× the pair gap, 450–1500 ms | three even taps |
| Silence after the last tap | 0.6 s | a train that carries on |
| Wrist still (`Still wrist`) | median < 0.1 g | patting with the watch hand, knocks mid-swing |
| Counting taps | ≤ 5 | patting that continues after a false arm |

A tap that breaks the rhythm doesn't just fail — it counts as noise, so a
steady pat keeps the gate shut until it stops for a second. Taps the engine
ignores for other reasons (cooldown, screen in use) count as noise too.

A real "hold" (dot-dot-dash) isn't possible: the accelerometer's tap detector
only reports impacts, not pressure. The long pause plus the silence after it
plays the same role.

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
  why the last attempt was thrown away (*Not from quiet*, *Wrong rhythm*, *Tap
  after end*, *Wrist moving*), the last tap (direction, single/double, whether
  it was ignored, and how much the wrist moved) and a timeline of the last 8
  seconds of taps. Doubles are drawn tall, ignored taps dotted. Use the `move`
  number to tune `Still wrist`: tap normally and note it, then pat something
  with the watch hand and note that; set the threshold between the two.
- **Events** — newest first. Tap an event to delete a false positive.
- **Settings** — detection on/off, only-when-locked, lock-while-counting, tap
  sensitivity, count timeout, confirm window, still wrist, and an optional
  sleep pause. `preQuietMs` / `postQuietMs` can be set in `morse.json`.
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
powered, so there is nothing to pay for while idle. Only after a first tap does
the engine read the accelerometer stream (at 12.5 Hz, lifting power-save) for
the ~1.5 s it takes to judge the password, then hands it back. A 250 ms timer
runs only between the first tap of a password and the end of a count.

## Data

- `morse.log.json` — `[{t: unix seconds, s: severity, src: "tap"}]`, last 500
  events.
- `morse.json` — settings.
