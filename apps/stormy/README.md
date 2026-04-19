# Stormy

Informational background app that watches for weather shifts that are commonly
associated with arthritis flares (pressure drops, large temperature swings,
and — optionally — humidity jumps and incoming precipitation).

Stormy is **informational only**. It describes conditions; it does not
recommend or schedule medications, doses, or any other action.

## What it does

- Samples the onboard barometer every ~10 minutes (pressure + temperature).
- Keeps a 24-hour rolling log in `stormy.log.json`.
- Buzzes gently (3 pulses) when a configured threshold is crossed:
  - Pressure drop ≥ 3.0 hPa in 3 h (default)
  - Temperature swing ≥ 6 °C in 6 h (default)
- Shows a widget on the clock face — a subtle cloud outline, filled with a
  bolt when an alert is pending.
- 30 minutes before your configured sleep window it surfaces a pre-sleep
  heads-up if an overnight onset is likely.

## Phone forecast (opt-in)

If you enable **Use phone for weather forecast** in Settings (off by default),
Stormy will additionally:

- Pull an hourly forecast from
  [Open-Meteo](https://open-meteo.com) via Gadgetbridge's HTTP bridge.
- Add two more triggers:
  - Humidity change ≥ 20 %pts in 6 h (default)
  - Precipitation ≥ 1 mm/h within the next 3 h (default)
- Use the forecast for the pre-sleep heads-up instead of just the recent
  onboard trend.

If the phone isn't reachable Stormy silently falls back to onboard-only
behaviour — it never blocks waiting for a response.

## Settings

- Enabled — master on/off
- Pressure drop threshold (hPa / 3 h)
- Temperature swing threshold (°C / 6 h)
- Humidity swing threshold (%pts / 6 h) — forecast-only
- Precipitation threshold (mm/h next 3 h) — forecast-only
- Sleep window start/end
- Use phone for weather forecast — default off
- Location (lat/lon) — only used when the forecast toggle is on
- Alert cooldown (hours)
- Test buzz

## Privacy

Stormy stores its settings and log locally on the watch. When the phone
forecast toggle is on the watch sends your configured lat/lon to Open-Meteo
over your phone's connection. Nothing else leaves the watch.
