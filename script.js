const video = document.getElementById('webcam');
const overlay = document.getElementById('overlay');
const overlayCtx = overlay.getContext('2d');

let sampleCanvas;
let sampleCtx;

const VIDEO_CONSTRAINTS = {
  video: {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
  audio: false,
};

// Approximate size of a QR code in the captured frame, in pixels.
const QR_SIZE = 150;
// jsQR only ever returns one decoded symbol per call, so to find multiple
// codes in a frame we scan overlapping crop windows across the image and
// decode each one separately. The window is bigger than a code (with room
// for its quiet zone) and the step is small enough that the overlap between
// adjacent windows is at least one code-width, so no code can fall entirely
// across a window boundary and get missed.
const TILE_SIZE = QR_SIZE * 2;
const TILE_STEP = QR_SIZE;

// QR codes used as game controls, matched against their decoded text.
const QR_START_SPAWNER = 'phone';
const QR_HARD_SPAWNER = 'object-a';
const QR_PADDLE_A = 'bottle';
const QR_PADDLE_B = 'object-b';
const QR_RESET_SCORE = 'object-c';
const QR_PAUSE_RESTART = 'notebook';

const BALL_RADIUS = 24;
const PADDLE_THICKNESS = 10;
const BOUNCE_VY = -14;
const BOUNCE_COOLDOWN_MS = 400;
const NOTEBOOK_DEBOUNCE_MS = 150;
const NOTEBOOK_HOLD_MS = 2000;

const BALL_KINDS = {
  normal: { color: '#00ff00', points: 1, gravity: 0.35 },
  hard: { color: '#ff3b3b', points: 2, gravity: 0.55 },
};

const balls = [];
let score = 0;
let paused = false;
let gameStarted = false;

let phoneWasVisible = false;
let hardSpawnerWasVisible = false;
let objectCWasVisible = false;

// Debounced notebook state: a raw detection only counts once it has held
// steady for NOTEBOOK_DEBOUNCE_MS, so a single misread frame can't
// accidentally pause or restart the game.
let notebookPresentSince = null;
let notebookAbsentSince = null;
let notebookConfirmed = false;
let notebookHoldStart = null;
let notebookRestartTriggered = false;

navigator.mediaDevices.getUserMedia(VIDEO_CONSTRAINTS)
  .then((stream) => {
    video.srcObject = stream;
  })
  .catch((error) => {
    console.error('Unable to access webcam:', error);
  });

video.addEventListener('loadedmetadata', () => {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = video.videoWidth;
  sampleCanvas.height = video.videoHeight;
  sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  requestAnimationFrame(tick);
});

function tick() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);

    const qrCodes = scanForQRCodes();
    const qrByData = new Map(qrCodes.map((qrCode) => [qrCode.data, qrCode]));
    const now = performance.now();

    handlePauseAndRestart(qrByData, now);
    handleScoreReset(qrByData);
    handleSpawning(qrByData);

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);

    const paddle = getPaddle(qrByData);
    if (paddle) {
      drawPaddle(paddle);
    }

    if (!paused) {
      stepBalls(paddle, now);
    }

    for (const ball of balls) {
      drawBall(ball);
    }

    drawHud();
  }

  requestAnimationFrame(tick);
}

// Debounces the "notebook" code: a steady appearance shorter than
// NOTEBOOK_HOLD_MS toggles pause; holding it that long resets the game.
function handlePauseAndRestart(qrByData, now) {
  const rawVisible = qrByData.has(QR_PAUSE_RESTART);

  if (rawVisible) {
    notebookAbsentSince = null;
    if (notebookPresentSince === null) {
      notebookPresentSince = now;
    }
    if (!notebookConfirmed && now - notebookPresentSince >= NOTEBOOK_DEBOUNCE_MS) {
      notebookConfirmed = true;
      notebookHoldStart = now;
      notebookRestartTriggered = false;
    }
  } else {
    notebookPresentSince = null;
    if (notebookConfirmed) {
      if (notebookAbsentSince === null) {
        notebookAbsentSince = now;
      }
      if (now - notebookAbsentSince >= NOTEBOOK_DEBOUNCE_MS) {
        if (!notebookRestartTriggered) {
          paused = !paused;
        }
        notebookConfirmed = false;
        notebookAbsentSince = null;
      }
    }
  }

  if (notebookConfirmed && !notebookRestartTriggered && now - notebookHoldStart >= NOTEBOOK_HOLD_MS) {
    balls.length = 0;
    score = 0;
    paused = false;
    gameStarted = false;
    notebookRestartTriggered = true;
  }
}

// Appearing resets the score to zero without touching balls in flight.
function handleScoreReset(qrByData) {
  const visible = qrByData.has(QR_RESET_SCORE);
  if (visible && !objectCWasVisible) {
    score = 0;
  }
  objectCWasVisible = visible;
}

// "phone" both starts the game (on its first appearance) and drops a
// normal ball every time it appears. "object-a" drops a faster, higher-
// value ball once the game has started.
function handleSpawning(qrByData) {
  const startSpawner = qrByData.get(QR_START_SPAWNER);
  const phoneVisible = Boolean(startSpawner);

  if (phoneVisible && !phoneWasVisible && !paused) {
    gameStarted = true;
    const { x, y } = centerOf(startSpawner.location);
    spawnBall(x, y, BALL_KINDS.normal);
  }
  phoneWasVisible = phoneVisible;

  const hardSpawner = qrByData.get(QR_HARD_SPAWNER);
  const hardVisible = Boolean(hardSpawner);

  if (gameStarted && hardVisible && !hardSpawnerWasVisible && !paused) {
    const { x, y } = centerOf(hardSpawner.location);
    spawnBall(x, y, BALL_KINDS.hard);
  }
  hardSpawnerWasVisible = hardVisible;
}

function spawnBall(x, y, kind) {
  balls.push({
    x,
    y,
    vx: 0,
    vy: 0,
    kind,
    lastBounceTime: 0,
  });
}

function getPaddle(qrByData) {
  const a = qrByData.get(QR_PADDLE_A);
  const b = qrByData.get(QR_PADDLE_B);
  if (!a || !b) {
    return null;
  }
  return { a: centerOf(a.location), b: centerOf(b.location) };
}

function stepBalls(paddle, now) {
  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i];

    ball.vy += ball.kind.gravity;
    ball.x += ball.vx;
    ball.y += ball.vy;

    if (ball.x - BALL_RADIUS < 0) {
      ball.x = BALL_RADIUS;
      ball.vx = Math.abs(ball.vx);
    } else if (ball.x + BALL_RADIUS > overlay.width) {
      ball.x = overlay.width - BALL_RADIUS;
      ball.vx = -Math.abs(ball.vx);
    }

    if (ball.y - BALL_RADIUS < 0) {
      ball.y = BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
    }

    if (
      paddle &&
      ball.vy > 0 &&
      now - ball.lastBounceTime > BOUNCE_COOLDOWN_MS &&
      distanceToSegment(ball.x, ball.y, paddle.a.x, paddle.a.y, paddle.b.x, paddle.b.y) <
        BALL_RADIUS + PADDLE_THICKNESS
    ) {
      ball.vy = BOUNCE_VY;
      ball.lastBounceTime = now;
      score += ball.kind.points;
    }

    if (ball.y - BALL_RADIUS > overlay.height) {
      balls.splice(i, 1);
    }
  }
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}

function drawBall(ball) {
  overlayCtx.fillStyle = ball.kind.color;
  overlayCtx.beginPath();
  overlayCtx.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2);
  overlayCtx.fill();
}

function drawPaddle(paddle) {
  overlayCtx.strokeStyle = '#00ff00';
  overlayCtx.lineWidth = PADDLE_THICKNESS;
  overlayCtx.lineCap = 'round';
  overlayCtx.beginPath();
  overlayCtx.moveTo(paddle.a.x, paddle.a.y);
  overlayCtx.lineTo(paddle.b.x, paddle.b.y);
  overlayCtx.stroke();
}

function drawHud() {
  const fontSize = Math.max(20, overlay.width * 0.025);
  overlayCtx.font = `${fontSize}px monospace`;
  overlayCtx.textBaseline = 'top';
  overlayCtx.fillStyle = '#00ff00';
  overlayCtx.fillText(`Score: ${score}`, fontSize * 0.5, fontSize * 0.5);

  overlayCtx.textAlign = 'center';
  if (!gameStarted) {
    overlayCtx.fillText('Show "phone" to start', overlay.width / 2, fontSize * 0.5);
  } else if (paused) {
    overlayCtx.fillText('PAUSED', overlay.width / 2, fontSize * 0.5);
  }
  overlayCtx.textAlign = 'left';
}

function scanForQRCodes() {
  const xs = getTilePositions(sampleCanvas.width);
  const ys = getTilePositions(sampleCanvas.height);
  const detections = [];

  for (const y of ys) {
    for (const x of xs) {
      const tile = sampleCtx.getImageData(x, y, TILE_SIZE, TILE_SIZE);
      const qrCode = jsQR(tile.data, TILE_SIZE, TILE_SIZE);
      if (qrCode) {
        detections.push(offsetQRCode(qrCode, x, y));
      }
    }
  }

  return dedupeDetections(detections);
}

// Start offsets for tiles of TILE_SIZE covering `dimension`, stepping by
// TILE_STEP and with a final tile flush against the far edge so the whole
// frame is covered even when it doesn't divide evenly by the step.
function getTilePositions(dimension) {
  if (dimension <= TILE_SIZE) {
    return [0];
  }

  const positions = [];
  for (let pos = 0; pos + TILE_SIZE <= dimension; pos += TILE_STEP) {
    positions.push(pos);
  }

  const lastPosition = dimension - TILE_SIZE;
  if (positions[positions.length - 1] !== lastPosition) {
    positions.push(lastPosition);
  }

  return positions;
}

function offsetQRCode(qrCode, offsetX, offsetY) {
  const shift = (point) => ({ x: point.x + offsetX, y: point.y + offsetY });
  const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = qrCode.location;

  return {
    data: qrCode.data,
    location: {
      topLeftCorner: shift(topLeftCorner),
      topRightCorner: shift(topRightCorner),
      bottomRightCorner: shift(bottomRightCorner),
      bottomLeftCorner: shift(bottomLeftCorner),
    },
  };
}

// The same QR code is often found in more than one overlapping tile, so
// collapse detections whose bounding boxes are centered near each other.
function dedupeDetections(detections) {
  const unique = [];

  for (const detection of detections) {
    const center = centerOf(detection.location);
    const isDuplicate = unique.some((existing) => {
      const existingCenter = centerOf(existing.location);
      const dx = center.x - existingCenter.x;
      const dy = center.y - existingCenter.y;
      return Math.sqrt(dx * dx + dy * dy) < QR_SIZE;
    });

    if (!isDuplicate) {
      unique.push(detection);
    }
  }

  return unique;
}

function centerOf(location) {
  const { topLeftCorner, bottomRightCorner } = location;
  return {
    x: (topLeftCorner.x + bottomRightCorner.x) / 2,
    y: (topLeftCorner.y + bottomRightCorner.y) / 2,
  };
}
