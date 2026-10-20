# Gesture Log v1 (Twist)

Log that something happened, and how bad it was, with a wrist gesture. You
don't need to look at the watch or press anything.

## The gesture

1. **Trigger:** twist your wrist twice, rhythmically, in one direction, then
   pause briefly. A short buzz means the watch is counting.
2. **Severity:** twist 1–5 times the *other* way, then hold still.
3. The watch buzzes back the count it logged (3 buzzes = severity 3). A
   single long buzz means nothing was counted and nothing was logged.

Counting stops after 1.5 s without a twist (configurable), or immediately at
5. The pause after the trigger matters: the firmware only hands over a
gesture once the motion stops.

## Detectors

- **TF model** (used when installed): the watch's onboard TensorFlow Lite
  recognises your trigger. It is trained on your own recordings, so it learns
  how *you* twist and what your everyday motion looks like. See
  [tools/gesture-train](../../tools/gesture-train/README.md).
- **Rule** (fallback, works out of the box): a trigger is 2–3 same-direction
  twists of more than 35° with no back-and-forth.

Severity is always counted by the rule-based twist counter. It's deterministic,
so the number you twist is the number you get.

## App

- **Live test** — try gestures without logging them. Shows the counter, the
  last motion (or the TF label and confidence), and a live trace of wrist
  roll with the twist-angle threshold marked.
- **Record samples** — record labelled `trigger` / `noise` reps for
  training. Detection pauses while recording.
- **Events** — newest first. Tap an event to delete a false positive.
- **Settings** — detection on/off, detector (Auto / Rule only), TF confidence,
  twist angle, count timeout, high accuracy, pause during the sleep window.
  Changes apply when the app reloads.

The widget (top right) shows a ring when idle, a blue count while counting,
and a green severity for a minute after an event is logged.

## Battery

Detection runs in the background from boot. The firmware already watches
the accelerometer for motion bursts, so the app only does work when you
move. TF inference adds a few tenths of a second of CPU per burst, and the
accelerometer stream is read only for the few seconds of counting. Expect
well under 1% of battery per day.

**High accuracy** (off by default) disables power-save while you're awake so
the accelerometer stays at 12.5 Hz. Without it, after about a minute of
stillness the first twist can be partly missed while the sensor wakes up. It
costs about +0.15 mA, roughly 15–25% shorter battery life. Training with reps
recorded from stillness usually makes it unnecessary.

## Data

- `gsym1.log.json` — `[{t: unix seconds, s: severity, src: "tf"|"rule"}]`,
  last 500 events.
- `gsym1.samples.csv` — recorded training samples, one row per gesture:
  `label,n,x,y,z,…` (int8, 64 = 1g).
- `gsym1.json` — settings.
