# tracking

A single-page web app that uses a webcam and [jsQR](https://github.com/cozmo/jsQR) to turn printed QR codes into physical game controllers, built on top of a QR-code detection/overlay base.

**Live demo:** https://qrcode-tracking-svs.netlify.app

## The game: QR Catch

Six printed QR codes double as game pieces. Hold them up to the webcam:

| QR code text | Role |
| --- | --- |
| `phone` | **Start / spawn.** First appearance starts the game. Every appearance after that drops a green ball (worth 1 point) that falls under gravity from wherever `phone` was held. |
| `object-a` | **Hard mode spawn.** Once the game has started, each appearance drops a red ball (worth 2 points) that falls faster than the green one. |
| `bottle` + `object-b` | **Paddle.** Hold both in frame at once and a line is drawn between them. A falling ball that touches the line bounces upward and scores. |
| `object-c` | **Reset score.** Resets the score to 0 without touching any balls in flight. |
| `notebook` | **Pause / restart.** A brief appearance toggles pause. Holding it in frame for 2+ seconds resets the whole game (clears balls and score, and returns to the "show phone to start" state). |

Balls keep bouncing off the paddle for as long as you can keep catching them — juggle for repeated points. A ball that falls past the bottom of the screen without being caught is lost (no penalty).

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
- `script.js` — QR detection (tiled scanning for multiple codes per frame) and all game logic
- `style.css` — minimal layout for the fullscreen video + canvas overlay
