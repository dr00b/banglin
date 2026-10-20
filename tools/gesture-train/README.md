# gesture-train

Trains the TensorFlow model that **gesture_symptoms_v1** uses to recognise its
trigger gesture on the watch.

```
watch: record samples ──► download CSV ──► train.py ──► upload-model.js ──► watch
```

## 1. Record samples on the watch

Gesture Log → **Record samples**:

- **trigger** — do the trigger exactly as you will in real life: twist your
  wrist twice in one direction, then stop. Record 20–40 reps. Rest a few
  seconds between reps so each is captured on its own (each rep buzzes once).
  Include some reps after the watch has been still for over a minute, because
  power-save mode then misses the start of the first twist.
- **noise** — everyday movements that should *not* trigger: a single twist,
  checking the time, reaching, typing, walking, waving. Record at least as many
  as trigger.

## 2. Download the CSV

Open the [Espruino Web IDE](https://www.espruino.com/ide/), connect, click
the Storage icon and save `gsym1.samples.csv`.

## 3. Train

```bash
cd tools/gesture-train
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python train.py ~/Downloads/gsym1.samples.csv
```

The script prints the class balance, the held-out validation accuracy, and a
confusion matrix, all computed with the exported TFLite model. It then writes
`out/gesture.tfmodel`, `out/gesture.tfnames` and `out/upload-model.js`.

To try the pipeline before you've recorded anything:

```bash
node synthetic.js > synthetic.csv && python train.py synthetic.csv --out out-synthetic
```

Don't install a model trained only on synthetic data.

| Option | Default | |
|---|---|---|
| `--hidden N` | 8 | Hidden units. The model is about 150·N bytes. |
| `--float` | off | Export float32 instead of int8. This is twice as large; use it only if the int8 model won't load. |
| `--augment N` | 20 | Random variants per recording: time stretch, gain, noise, and start crops that mimic power-save. |
| `--epochs N` | 150 | |

## 4. Install

```bash
espruino --port BT out/upload-model.js
```

Or paste the file into the Web IDE's left pane. It writes `.tfmodel` and
`.tfnames` and restarts the watch, so the engine picks up the model. Gesture
Log → **Detector** should then read **TF**. In Live test, every motion shows
the model's label and confidence.

To go back to the rule-based detector, set Settings → Detector → Rule only,
or delete `.tfmodel`.

## How the firmware uses the model

From `libs/banglejs/jswrap_bangle.c`:

- After each motion burst (a "gesture" of under 50 samples at 12.5 Hz), the
  firmware copies the raw int8 accelerometer values (64 = 1g, XYZXYZ…) into
  the model's input from index 0. The input is therefore 150 values,
  zero-padded at the end.
- It runs the model in a 4,000-byte arena. The model buffer is copied onto
  the stack, so keep it to a few KB. The script warns above 6,000 bytes.
- It reports the argmax label via `Bangle.on('aiGesture', name, weights)`.
- There is one global `.tfmodel`. Installing this model replaces any other
  gesture model on the watch.

The int8 export pins the input quantization to scale 1 and zero point 0, so it
consumes those raw values exactly. Training normalises to g, then folds
the 1/64 into the first layer, so the model has no extra ops: just
`FULLY_CONNECTED` and `SOFTMAX`.
