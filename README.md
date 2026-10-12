# tracking

A single-page web app that uses a webcam and [jsQR](https://github.com/cozmo/jsQR) to turn printed QR codes into a physical map of places — connect two of them and it recommends how to travel between them.

**Live demo:** https://qrcode-tracking-svs.netlify.app

## QR Routes

Printed QR codes stand for places in my life. Hold the **transport** code between two place codes and the app draws an arrow between them, asks Google Maps how to get there, and highlights the recommended way to travel.

| QR code text | Means |
| --- | --- |
| `phone` | 🏠 **Home** — Jersey City, NJ |
| `notebook` | 🎨 **SVA** — 136 W 21st St, New York |
| `bottle` | 🛒 **ShopRite** — Luis Marin Blvd & 6th St, Jersey City |
| `object-b` | 💪 **GNC** — Newport Centre, Jersey City |
| `object-a` | 🧭 **Transport** — connects the two place codes closest to it. The one further **left** on screen is the start. |
| `object-c` | **Preference** — each appearance cycles ⚡ Fastest → 💵 Cheapest → 🌱 Greenest, and the recommendation updates. |

For every connected pair the card lists transit 🚇, drive 🚗, bike 🚲 and walk 🚶 with time, rough cost and CO₂. Walks over 45 min and bike rides over 60 min are shown greyed out and never recommended.

Click **Start camera & voice** first — browsers only allow a page to speak after a click. The webcam is shown like a mirror, so your left is the screen's left. If the browser picked the wrong camera (e.g. an iPhone via Continuity Camera), switch it in the menu at the bottom-right; the choice is remembered.

Once transport connects two places and the routes are in, a pop-up appears and the recommendation is **read out loud** (Web Speech API). It's read once per connection, and again when the preference code changes the pick. ▶︎ replays it, 🔊 mutes. The pop-up closes about a second after the codes are taken away.

Places, QR mapping, mirroring, voice and the cost/CO₂ numbers are all in `config.js`.

### Where the times come from

No API key needed. `PRESET_ROUTES` in `config.js` holds door-to-door times looked up in Google Maps and the PATH app. For Home → SVA the app also checks the PATH timetable (`TIMETABLES`) and adds the wait for the next train from Grove St, e.g. *"The next train leaves at 9:16 PM."* Pairs or modes that aren't filled in are rough guesses from distance and are marked *est.*

### Google Maps API key (optional)

With a key, live routes from the [Google Routes API](https://developers.google.com/maps/documentation/routes/overview) replace the preset times.

1. In Google Cloud Console, create a key and enable **Routes API**.
2. Restrict the key to your site URLs (HTTP referrers) — it's visible in the browser.
3. Open the app once as `https://…/?key=YOUR_KEY`. The key is remembered in that browser and removed from the address bar, so it never needs to be committed.

## Running locally

```bash
npx serve .
```

Then open the printed URL and grant camera access. No build step — it's vanilla JS/HTML/CSS.

## Deploying

```bash
npx netlify-cli deploy --prod --dir=.
```

## Files

- `index.html` — page shell, loads the webcam video element and jsQR from a CDN
- `config.js` — QR → place mapping, addresses, API key, cost/CO₂ estimates
- `script.js` — QR detection (tiled scanning for multiple codes per frame), routing and drawing
- `style.css` — minimal layout for the fullscreen video + canvas overlay
