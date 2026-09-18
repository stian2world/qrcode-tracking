# Weekly submission

## 1. Technical setup

Claude Code is set up and working. The project deploys automatically on every
push to `main`:

- **Netlify (auto-deploy):** https://qrcode-tracking-svs.netlify.app
- **GitHub Pages (auto-deploy):** https://stian2world.github.io/qrcode-tracking/
- **Repo:** https://github.com/stian2world/qrcode-tracking

## 2. The change

Turned the base QR-tracking demo (which just drew a box and printed the
decoded text under each QR code) into a small paddle-catch game, **QR Catch**,
using six QR codes as physical game controllers. Full rules and the QR-code
role table are in [README.md](README.md#the-game-qr-catch).

Quick summary:
- `phone` starts the game and drops a normal ball
- `object-a` drops a faster, higher-value ball once the game has started
- `bottle` + `object-b` held together form a paddle — touching it scores
- `object-c` resets the score
- `notebook` pauses/restarts

## 3. Team

Solo — Shu Yang Tian.

## 4. Setup

Still deciding between the two options in testing:
- **Desktop, top-down camera** — QR codes laid flat on a kitchen counter,
  camera looking straight down
- **Upright, wall-facing camera** — QR codes held up against a wall,
  camera facing forward

Both work with the current code as-is (it doesn't assume any particular
camera orientation), so the choice is about which feels better to play, not
a code change.
