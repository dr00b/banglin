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
   tap once more — dot-dot … dot — and **stop**. Right after a burst of
   knocks (three or more in four seconds), wait a few seconds first.
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
| Silence before the first tap | 1 s, and < 3 taps in the last 4 s | joining a train part-way, or in a gap |
| Pair gap | 150–350 ms | finger rolls and rebounds (quicker), slow taps |
| Pause before the last tap | 2.3–5× the pair gap, 450–1500 ms | three even taps, a steady pat with a beat missing |
| Silence after the last tap | 0.6 s | a train that carries on |
| Wrist still (`Still wrist`) | median < 0.1 g, during *and* after | patting with the watch hand, knocks mid-swing, the last pats before you stop |
| Tap direction (`Tap direction`) | any (off) | knocks from the side, jolts through a desk |
| Counting taps | ≤ 5 | patting that continues after a false arm |

A tap that breaks the rhythm doesn't just fail — it counts as noise, so a
steady pat keeps the gate shut until it stops for a second. Taps the engine
ignores for other reasons (cooldown, screen in use) count as noise too.

A real "hold" (dot-dot-dash) isn't possible: the accelerometer's tap detector
only reports impacts, not pressure. The long pause plus the silence after it
plays the same role.

Every constant here can be overridden in `morse.json` (e.g. `"rhythmRatio": 2.1`)
to fit your own rhythm. See [tests/FIELD-TESTS.md](tests/FIELD-TESTS.md) for how to
measure it.

### How well it works

`tests/simulation.test.js` runs the real engine against simulated everyday life
(burping, bouncing, knocks while walking, door knocks, clapping, walking,
running, sleep, typing, drumming, driving, chores), under three models of the
chip's tap reporting including a worst case where every knock registers.

- **Rhythmic or moving activities** (burping by patting with the watch
  hand, bouncing, knocks while swinging, door knocks, clapping, walking,
  running, sleep): never armed.
- **Knocks scattered at random onto a still wrist** (typing hard, drumming,
  potholes, clinks while washing up, and pats reaching the arm that holds
  the baby while the other hand burps him): no rhythm and no movement give
  these away, so now and then three line up like the password. That's under 0.6
  false logs per hour of the activity in the realistic models, and up to ~4
  in the worst case. Setting **Tap direction** removes almost all of them,
  but only do it once you've checked your own taps always report the same
  direction (FIELD-TESTS.md).
- **Real passwords:** 98–100% logged (90%+ with soft taps on a pillow). A miss
  is a refusal, and a count is never more than you tapped. It can be one short
  if a tap was too soft for the accelerometer to notice at all (0.25% of soft
  attempts in bed); the buzz-back tells you, and Events lets you delete it.

These come from a model; the field tests check them against your watch.

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
- **The chip's idea of a "double".** A pair may arrive as one `double` event
  or as two singles, depending on the accelerometer's timing registers (by the
  datasheet's defaults, only taps 0.3–0.4 s apart fuse). Both are accepted, so
  the gesture works either way — and during counting a fused pair counts as
  two.

## App

- **Live test** — try the gesture without logging it. Shows the protocol state,
  why the last attempt was thrown away (*Not from quiet*, *Wrong rhythm*, *Tap
  after end*, *Wrist moving*, *Wrong direction*), the last tap (direction,
  single/double, why it was ignored if it was, and how much the wrist moved)
  and a timeline of the last 8 seconds of taps. Doubles are drawn tall, ignored taps dotted. Use the `move`
  number to tune `Still wrist`: tap normally and note it, then pat something
  with the watch hand and note that; set the threshold between the two.
- **Field test** — record a real session (burping, typing, a few passwords…)
  so it can be replayed through the same engine on a computer and kept as a
  test. Pick the session, its length and, for password sessions, the severity
  and number of attempts, then Start and lock the watch. It stops by itself
  (two long buzzes). Counts aren't logged while recording. See
  [tests/FIELD-TESTS.md](tests/FIELD-TESTS.md).
- **Events** — newest first. Tap an event to delete a false positive.
- **Settings** — detection on/off, only-when-locked, lock-while-counting, tap
  sensitivity, count timeout, confirm window, still wrist, tap direction, and
  an optional sleep pause. Any protocol constant can be set in `morse.json`.
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
powered, so there is nothing to pay for while idle. Only once a pair of taps
has come out of silence does the engine read the accelerometer stream (at
12.5 Hz, lifting power-save), and only until it has judged the password —
about 1.5 s, or half a second if the wrist is plainly moving. A 250 ms timer
runs only between the first tap of a password and the end of a count, and the
widget is only redrawn when what it shows changes.

In the simulation, the engine's own extras (stream, timers, redraws) stay
under 3.5% of the watch's idle draw for every everyday activity in the
realistic tap models; the worst case is ~11% (driving on a bumpy road with
every pothole registering as a tap). Handling the
taps themselves, which any tap-driven app pays for, adds up to ~15 µA while
running (100 taps a minute).

## Data

- `morse.log.json` — `[{t: unix seconds, s: severity, src: "tap"}]`, last 500
  events.
- `morse.json` — settings.
- `morse.r*.csv` — field-test recordings (StorageFiles), and `morse.rec.json`
  while one is running.
