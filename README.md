# Nickotime

Pace your walk or bike ride to catch green lights. Built for Israel, Hebrew and English UI.

**Install (Android):** open the app link in Chrome → menu ⋮ → *Install app* / *Add to Home screen*.
**התקנה (אנדרואיד):** לפתוח את הקישור בכרום ← תפריט ⋮ ← *התקנת אפליקציה*.

## How it works
1. Add the lights you pass and your places (home, work, bus stop) on the map. GPS is optional, since it's often jammed.
2. Stand at a light and tap **Green!** / **Red!** when it changes. About two cycles are enough. The app fits the cycle length (whole seconds) and the green length.
3. Make routes between places. Several routes to the same place get compared.
4. **Go** tab: the arrival time if you leave now, a 10-minute "when to leave" heatmap (colour = time spent waiting at lights), and per-route **Start**.
5. In Go mode the app tells you the slowest pace that still gives the best arrival time. Speed up to catch a green, or ease off instead of waiting. Without GPS it estimates from your pace. **I'm at the light** and **Crossed** keep it in sync, and **Green now** / **Red now** re-sync a light live.

Push-button lights learn the press→green delay. Lights that are also coordinated in a fixed cycle are predicted like timed ones. Across days the app checks whether a light repeats at the same clock time (clock-synced controllers) and shows its confidence.

## Privacy & safety
- No server, no account, no analytics. Data is stored in IndexedDB on the phone.
- The only network requests are map tiles from OpenStreetMap, enforced by the page's Content-Security-Policy.
- Export/Import (JSON, with photos) gives you backups and lets friends share measurements. Import merges and validates every field.
- Predictions can be wrong. Only cross on an actual green.

## Dev
Static files, no build step. `python -m http.server 8765`, then open http://localhost:8765.
Tests: `node test/model.test.mjs`. Icons: `node tools/icons.mjs`.
On release, bump `V` in `sw.js` so installed apps pick up the new files.
