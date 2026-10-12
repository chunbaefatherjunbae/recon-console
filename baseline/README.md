# RECON CONSOLE // BASELINE

BASELINE is the active rebuild project for the RECON CONSOLE application.

## Rule

The BASELINE runtime does **not** load V27, V28, V29, ECHOPOINT bridges, legacy field tools, legacy PLAN/NAV/TRACK UI, legacy theme layers, corner ornaments, or legacy service-worker HTML injection.

Neutral dependencies reused:
- Leaflet
- MGRS library

BASELINE has its own isolated service worker at `/baseline/sw.js`. It only owns the `/baseline/` scope, precaches the BASELINE shell, caches viewed online map tiles, and owns the dedicated lightweight terrain cache. It never rewrites HTML.

## Current model

- Map-first NVG-G shell
- Left-top reference HUD + map mode status
- Right-top search / settings / GPS / follow / TEMP controls
- TEMP: short press = set at reticle, long press = move to saved TEMP
- Reference selection:
  1. live GPS fix while GPS is enabled
  2. otherwise newest timestamp between TEMP and LAST FIX
- Registered sites + user sites + discovery
- Unified plan/navigation flow with GRID / MAG / WMM2025
- Drawing + LAP + recoverable navigation sessions
- GPS TRACK v1 stored with navigation records
- Bottom navigation: 거점 / 탐색 / 계획 / 기록

## Map modes

- `AUTO`: online map → already-viewed cached tiles → lightweight map when cached coverage is missing or the online base repeatedly fails
- `ONLINE`: OpenTopoMap + OSM road boost
- `LITE`: DEM terrain shading/elevation bands/index contours + compact OSM roads/rivers/rail/coast/places + coordinate grid

The compact OSM vector bundle is generated from the Geofabrik South Korea extract by `scripts/build-lite-map.py` and `.github/workflows/build-lite-map.yml`. It is generated data, not hand-authored geometry.

Low-resolution nationwide terrain (z5-z7, 21 tiles for the Korea field envelope) is warmed automatically after an online BASELINE boot. Higher-detail nationwide terrain (z8-z9, 218 additional tiles) is opt-in from Settings before field use. LITE rendering falls back through lower cached DEM zooms instead of turning into a blank map when detailed terrain is unavailable.

Later feature work must be added to BASELINE as new modules instead of wrapping legacy globals.

## Optical equipment UI (v17)
- `equipment-ui.css` is the scoped source of truth for the compact PLAN/NAV
  instrument layout, consistent NVG-G control tokens and responsive sizing.
- One editable objective heading and an explicit fit-route map action replace
  duplicated destination headings. Detailed current/start measurements expand
  only on request; bearing calculations remain unchanged.
- App navigation stays reachable while contextual PLAN actions receive priority.
  Registered-site visibility, map/reticle center, GPS, drawing, storage and
  session lifecycle retain their previous rules.
- Do not append further competing PLAN style rules to `styles.css`.

## Field-optic HUD and input lifecycle (v18)
- Remove the map-floating route-fit and opaque detailed-telemetry buttons:
  route-fit is in the PLAN editor and the 44px details disclosure is a naked
  chevron inside the measured HUD footer.
- Default numeric DIST / GRID / MAG use three equal-width columns.
  GPS track visuals are less aggressive; route mathematics and saved data stay
  unchanged. The existing global navigation remains reachable.
- Centralize input focus release before every common sheet replacement/close,
  and before entering drawing or confirming a plan. This borrows the older
  TACTICAL RECON search close lifecycle. It reduces the chance of a lingering
  iOS edit session, but cannot claim to disable OS Shake to Undo from JavaScript.
- Verify real-device iOS shake behavior after typing a plan name, closing search,
  starting and stopping NAV, and using the map for a sustained period.
