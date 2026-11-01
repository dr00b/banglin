#!/data/data/com.termux/files/usr/bin/sh
# For later, if banglin-sync moves to the phone: copy to ~/.termux/boot/ (needs
# the Termux:Boot app). Termux can't use Bluetooth itself, so this runs the
# http transport (watch pushes via Gadgetbridge), which isn't built yet.
# Secrets go in ~/.banglin-sync.env (chmod 600). No termux-wake-lock: it
# would keep the CPU awake all the time.
mkdir -p "$HOME/.local/state/banglin-sync"
set -a; . "$HOME/.banglin-sync.env"; set +a
exec node "$HOME/banglin-sync/bin/banglin-sync" run --transport http >> "$HOME/.local/state/banglin-sync/log" 2>&1
