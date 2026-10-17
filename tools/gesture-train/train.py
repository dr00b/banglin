#!/usr/bin/env python3
"""Train the gesture_symptoms trigger model for Bangle.js TensorFlow.

Input: one or more gsym.samples.csv files recorded on the watch
(Gesture Log > Record samples). Each row is

    label,n,x0,y0,z0,x1,y1,z1,...

with n accelerometer samples at 12.5 Hz, int8 where 64 = 1g.

Output (in --out):
    gesture.tfmodel   TFLite flatbuffer -> upload as ".tfmodel"
    gesture.tfnames   comma-separated labels -> upload as ".tfnames"
    upload-model.js   writes both to Storage: espruino --port BT upload-model.js

How the firmware runs the model (libs/banglejs/jswrap_bangle.c): after each
gesture it copies the n*3 raw int8 values into the input tensor starting at
index 0, invokes it in a 4000-byte arena, and reports the argmax label via
Bangle.on('aiGesture'). Gestures are under 50 samples, so the input is 150
values and anything past n*3 stays zero. The model buffer is copied onto the
stack, so keep it small (a few KB).
"""

import argparse
import base64
import csv
import os
import sys

import numpy as np

MAX_SAMPLES = 50          # ACCEL_HISTORY_LEN in the firmware
INPUT_LEN = MAX_SAMPLES * 3
SIZE_WARN_BYTES = 6000


def load_csv(paths):
    xs, labels = [], []
    for path in paths:
        with open(path, newline="") as f:
            for row in csv.reader(f):
                if len(row) < 3 or not row[0].strip():
                    continue
                try:
                    n = int(row[1])
                    vals = [int(v) for v in row[2:2 + n * 3]]
                except ValueError:
                    continue
                if n < 1 or len(vals) != n * 3:
                    continue
                xs.append(np.array(vals, dtype=np.float32).reshape(n, 3))
                labels.append(row[0].strip())
    return xs, labels


def pad(seq):
    out = np.zeros(INPUT_LEN, dtype=np.float32)
    flat = seq[:MAX_SAMPLES - 1].reshape(-1)
    out[:len(flat)] = flat
    return out


def augment(seq, rng):
    """One random variant of a recorded gesture.

    The start crop mimics power-save: after a minute of stillness the
    accelerometer runs at 1.25 Hz and the first part of a twist is missed.
    It is applied to every label so length alone doesn't give the class away.
    """
    n = len(seq)
    if n > 12 and rng.random() < 0.5:
        seq = seq[rng.integers(1, max(2, int(n * 0.3))):]
    stretch = rng.uniform(0.85, 1.15)
    m = max(5, min(MAX_SAMPLES - 1, int(round(len(seq) * stretch))))
    src = np.linspace(0, len(seq) - 1, m)
    seq = np.stack([np.interp(src, np.arange(len(seq)), seq[:, k]) for k in range(3)], axis=1)
    seq = seq * rng.uniform(0.9, 1.1) + rng.normal(0, 2.0, seq.shape)
    return np.clip(np.round(seq), -128, 127).astype(np.float32)


def split(labels, val_frac, rng):
    train, val = [], []
    for lab in sorted(set(labels)):
        idx = [i for i, l in enumerate(labels) if l == lab]
        rng.shuffle(idx)
        k = max(1, int(round(len(idx) * val_frac))) if len(idx) >= 5 else 0
        val += idx[:k]
        train += idx[k:]
    return train, val


def build_model(tf, n_classes, hidden):
    return tf.keras.Sequential([
        tf.keras.Input(shape=(INPUT_LEN,)),
        tf.keras.layers.Dense(hidden, activation="relu"),
        tf.keras.layers.Dense(n_classes, activation="softmax"),
    ])


def to_tflite(tf, model, x_rep, int8):
    conv = tf.lite.TFLiteConverter.from_keras_model(model)
    if int8:
        # Full-integer model with int8 input. The anchor row pins the input
        # range to [-128, 127] so input scale = 1 and zero point = 0, which
        # matches the raw values the firmware writes into the tensor.
        anchor = np.zeros((1, INPUT_LEN), dtype=np.float32)
        anchor[0, 0], anchor[0, 1] = -128, 127

        def rep():
            yield [anchor]
            for row in x_rep[:300]:
                yield [row[None, :]]

        conv.optimizations = [tf.lite.Optimize.DEFAULT]
        conv.representative_dataset = rep
        conv.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
        conv.inference_input_type = tf.int8
        conv.inference_output_type = tf.int8
    return conv.convert()


def tflite_predict(tf, model_bytes, x):
    interp = tf.lite.Interpreter(model_content=model_bytes)
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    preds = []
    for row in x:
        v = row[None, :]
        if inp["dtype"] == np.int8:
            v = np.clip(np.round(v), -128, 127).astype(np.int8)
        interp.set_tensor(inp["index"], v)
        interp.invoke()
        preds.append(int(np.argmax(interp.get_tensor(out["index"])[0])))
    return np.array(preds)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv", nargs="+", help="gsym.samples.csv file(s) from the watch")
    ap.add_argument("--out", default="out", help="output directory (default: out)")
    ap.add_argument("--hidden", type=int, default=8, help="hidden units (default: 8; model size grows ~150x this)")
    ap.add_argument("--epochs", type=int, default=150)
    ap.add_argument("--augment", type=int, default=20, help="random variants per training sample")
    ap.add_argument("--float", action="store_true",
                    help="float32 model instead of int8 (~2x larger; fallback if int8 won't load)")
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    seqs, labels = load_csv(args.csv)
    names = sorted(set(labels))
    if "trigger" not in names or len(names) < 2:
        sys.exit("Need samples labelled 'trigger' and at least one other label (e.g. 'noise'). Got: %s" % names)
    counts = {n: labels.count(n) for n in names}
    print("samples:", counts)
    for n, c in counts.items():
        if c < 15:
            print("  warning: only %d '%s' samples; 20+ per label recommended" % (c, n))

    import tensorflow as tf
    tf.random.set_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    y_all = np.array([names.index(l) for l in labels])

    train_idx, val_idx = split(labels, 0.2, rng)
    x_tr, y_tr = [], []
    for i in train_idx:
        x_tr.append(pad(seqs[i]))
        y_tr.append(y_all[i])
        for _ in range(args.augment):
            x_tr.append(pad(augment(seqs[i], rng)))
            y_tr.append(y_all[i])
    x_tr, y_tr = np.array(x_tr), np.array(y_tr)
    # Validate on recordings the model never saw, plus their power-save crops.
    x_val = np.array([pad(seqs[i]) for i in val_idx] + [pad(augment(seqs[i], rng)) for i in val_idx])
    y_val = np.concatenate([y_all[val_idx], y_all[val_idx]]) if val_idx else np.array([])

    # Balance classes so a pile of 'noise' doesn't drown out 'trigger'.
    freq = np.bincount(y_tr, minlength=len(names)).astype(np.float32)
    class_weight = {i: float(len(y_tr) / (len(names) * max(f, 1))) for i, f in enumerate(freq)}

    model = build_model(tf, len(names), args.hidden)
    model.compile(optimizer=tf.keras.optimizers.Adam(0.003),
                  loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    # Train on values in g (64 = 1g), then fold the 1/64 into the first layer
    # so the exported model takes the firmware's raw int8 values directly
    # without an extra scaling op.
    model.fit(x_tr / 64.0, y_tr, epochs=args.epochs, batch_size=64, verbose=0,
              class_weight=class_weight, shuffle=True)
    kernel, bias = model.layers[0].get_weights()
    model.layers[0].set_weights([kernel / 64.0, bias])

    tfl = to_tflite(tf, model, x_tr[rng.permutation(len(x_tr))], not args.float)

    if len(y_val):
        pred = tflite_predict(tf, tfl, x_val)
        acc = float(np.mean(pred == y_val))
        print("validation accuracy (TFLite, %d held-out recordings + crops): %.1f%%" % (len(val_idx), acc * 100))
        print("confusion (rows = true, cols = predicted):", names)
        for i, n in enumerate(names):
            print("  %-10s %s" % (n, [int(np.sum((y_val == i) & (pred == j))) for j in range(len(names))]))
    else:
        print("too few samples for a validation split (need 5+ per label)")

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "gesture.tfmodel"), "wb") as f:
        f.write(tfl)
    tfnames = ",".join(names)
    with open(os.path.join(args.out, "gesture.tfnames"), "w") as f:
        f.write(tfnames)
    with open(os.path.join(args.out, "upload-model.js"), "w") as f:
        f.write('require("Storage").write(".tfmodel",atob("%s"));\n' % base64.b64encode(tfl).decode())
        f.write('require("Storage").write(".tfnames",%s);\n' % repr(tfnames).replace("'", '"'))
        f.write('print("gesture model installed (%d bytes): %s");load();\n' % (len(tfl), tfnames))

    print("model: %d bytes (%s) -> %s" % (len(tfl), "float32" if args.float else "int8", args.out))
    if len(tfl) > SIZE_WARN_BYTES:
        print("  warning: over %d bytes; the firmware copies the model onto the stack. "
              "Try a smaller --hidden." % SIZE_WARN_BYTES)
    print("install: espruino --port BT %s" % os.path.join(args.out, "upload-model.js"))


if __name__ == "__main__":
    main()
