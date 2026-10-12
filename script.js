// QR Routes — printed QR codes stand for places. Hold the "transport" code
// between two place codes and the app asks Google Maps how to get from one
// to the other, then recommends a way to travel.
//
// Settings (which QR = which place, addresses, API key) live in config.js.

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
// decode each one separately.
const TILE_SIZE = QR_SIZE * 2;
const TILE_STEP = QR_SIZE;

// A code that drops out for a few frames still counts as visible, so the
// overlay doesn't flicker.
const VISIBLE_GRACE_MS = 400;
// A place pair has to stay connected this long before we ask Google.
const PAIR_SETTLE_MS = 400;

const MODES = ['TRANSIT', 'DRIVE', 'BICYCLE', 'WALK'];
const MODE_INFO = {
  TRANSIT: { icon: '🚇', label: 'Transit' },
  DRIVE: { icon: '🚗', label: 'Drive' },
  BICYCLE: { icon: '🚲', label: 'Bike' },
  WALK: { icon: '🚶', label: 'Walk' },
};

const PREFERENCES = [
  { key: 'fastest', icon: '⚡', label: 'Fastest' },
  { key: 'cheapest', icon: '💵', label: 'Cheapest' },
  { key: 'greenest', icon: '🌱', label: 'Greenest' },
];

const apiKey = loadApiKey();

// data -> { qr, center, lastSeen }
const seen = new Map();
let preferenceIndex = 0;
let preferenceWasVisible = false;

let pendingPair = null; // { key, since }
// "home->sva" -> { status: 'loading' | 'done', source, results: [...] }
const routeCache = new Map();

function loadApiKey() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('key');
  try {
    if (fromUrl) {
      localStorage.setItem('gmapsKey', fromUrl);
      // Drop the key from the address bar so it isn't shared by accident.
      params.delete('key');
      const query = params.toString();
      history.replaceState(null, '', location.pathname + (query ? `?${query}` : ''));
      return fromUrl;
    }
    return localStorage.getItem('gmapsKey') || GOOGLE_MAPS_API_KEY;
  } catch (error) {
    return fromUrl || GOOGLE_MAPS_API_KEY;
  }
}

// ---------------------------------------------------------------------------
// Camera. Browsers only let a page talk out loud after a click, so the app
// waits for the "Start" button before turning on the webcam and voice.

const startScreen = document.getElementById('start');
const cameraSelect = document.getElementById('camera-select');
let ticking = false;
let currentStream = null;

document.getElementById('start-button').addEventListener('click', async () => {
  unlockSpeech();
  startScreen.hidden = true;
  await startCamera(savedCameraId());
  await fillCameraList();
});

cameraSelect.addEventListener('change', () => {
  try {
    localStorage.setItem('cameraId', cameraSelect.value);
  } catch (error) {
    // Not remembered — fine.
  }
  startCamera(cameraSelect.value);
});

function savedCameraId() {
  try {
    return localStorage.getItem('cameraId');
  } catch (error) {
    return null;
  }
}

async function startCamera(deviceId) {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
  }
  const constraints = {
    audio: false,
    video: { ...VIDEO_CONSTRAINTS.video, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  };
  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (error) {
    if (deviceId) {
      // The remembered camera is gone (unplugged etc.) — use the default one.
      return startCamera(null);
    }
    console.error('Unable to access webcam:', error);
    return;
  }
  video.srcObject = currentStream;
}

// Lets you pick the built-in webcam if the browser grabbed another camera
// (e.g. an iPhone via Continuity Camera).
async function fillCameraList() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const activeId = currentStream?.getVideoTracks()[0]?.getSettings().deviceId;
  cameraSelect.innerHTML = '';
  cameras.forEach((camera, i) => {
    const option = document.createElement('option');
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${i + 1}`;
    option.selected = camera.deviceId === activeId;
    cameraSelect.append(option);
  });
  cameraSelect.hidden = cameras.length < 2;
}

video.addEventListener('loadedmetadata', () => {
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = video.videoWidth;
  sampleCanvas.height = video.videoHeight;
  sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });

  if (!ticking) {
    ticking = true;
    requestAnimationFrame(tick);
  }
});

function tick() {
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    sampleCtx.drawImage(video, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const now = performance.now();

    for (const qr of scanForQRCodes()) {
      const center = centerOf(qr.location);
      // The video is shown mirrored (like a mirror), so flip x to match
      // what you see — your left is the screen's left.
      if (MIRROR_VIDEO) {
        center.x = overlay.width - center.x;
      }
      seen.set(qr.data, { qr, center, lastSeen: now });
    }
    const visible = visibleByRole(now);

    handlePreference(visible);
    const connection = findConnection(visible);
    const route = connection ? routeFor(connection, now) : null;
    if (!connection) {
      pendingPair = null;
    }

    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    if (connection) {
      drawConnection(connection);
    }
    drawPlaceTags(visible);
    drawHud(visible, connection, route);
    updatePopup(connection, route, now);
  }

  requestAnimationFrame(tick);
}

// role -> center point, for every mapped code seen recently.
function visibleByRole(now) {
  const visible = new Map();
  for (const [data, entry] of seen) {
    const role = QR_ROLES[data];
    if (role && now - entry.lastSeen < VISIBLE_GRACE_MS) {
      visible.set(role, entry.center);
    }
  }
  return visible;
}

// Each new appearance of the preference code steps to the next preference.
function handlePreference(visible) {
  const isVisible = visible.has('preference');
  if (isVisible && !preferenceWasVisible) {
    preferenceIndex = (preferenceIndex + 1) % PREFERENCES.length;
  }
  preferenceWasVisible = isVisible;
}

// With the transport code in frame, connect the two places nearest to it.
// The one further left on screen is where you start.
function findConnection(visible) {
  const transport = visible.get('transport');
  if (!transport) {
    return null;
  }

  const places = [...visible]
    .filter(([role]) => PLACES[role])
    .map(([role, point]) => ({ role, point, dist: Math.hypot(point.x - transport.x, point.y - transport.y) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 2);

  if (places.length < 2) {
    return null;
  }

  const [from, to] = places.sort((a, b) => a.point.x - b.point.x);
  return { from, to, transport };
}

function routeFor(connection, now) {
  const key = `${connection.from.role}->${connection.to.role}`;
  const cached = routeCache.get(key);
  if (cached) {
    return cached;
  }

  if (!pendingPair || pendingPair.key !== key) {
    pendingPair = { key, since: now };
  } else if (now - pendingPair.since >= PAIR_SETTLE_MS) {
    const entry = { status: 'loading', results: [] };
    routeCache.set(key, entry);
    fetchRoutes(PLACES[connection.from.role], PLACES[connection.to.role]).then(({ source, results }) => {
      entry.status = 'done';
      entry.source = source;
      entry.results = results;
    });
    return entry;
  }
  return { status: 'loading', results: [] };
}

// ---------------------------------------------------------------------------
// Routes

async function fetchRoutes(from, to) {
  if (apiKey) {
    const live = await Promise.all(MODES.map((mode) => fetchGoogleRoute(from, to, mode)));
    const results = live.filter(Boolean);
    if (results.length > 0) {
      return { source: 'live', results };
    }
    console.warn('Google Routes returned nothing — falling back to estimates.');
  }
  return { source: 'estimate', results: estimateRoutes(from, to) };
}

async function fetchGoogleRoute(from, to, mode) {
  const body = {
    origin: { address: from.address },
    destination: { address: to.address },
    travelMode: mode,
    units: 'IMPERIAL',
  };
  if (mode === 'DRIVE') {
    body.routingPreference = 'TRAFFIC_AWARE';
  }

  try {
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': [
          'routes.duration',
          'routes.distanceMeters',
          'routes.travelAdvisory.transitFare',
          'routes.legs.steps.transitDetails.transitLine.name',
          'routes.legs.steps.transitDetails.transitLine.nameShort',
        ].join(','),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      console.warn(`Routes API (${mode}) error:`, data.error?.message || response.status);
      return null;
    }

    const route = data.routes?.[0];
    if (!route) {
      return null;
    }

    const minutes = parseInt(route.duration, 10) / 60;
    const miles = (route.distanceMeters || 0) / 1609.34;
    const fare = route.travelAdvisory?.transitFare;
    const fareUsd = fare ? Number(fare.units || 0) + (fare.nanos || 0) / 1e9 : null;

    return describeRoute(mode, minutes, miles, from, to, fareUsd, transitLines(route));
  } catch (error) {
    console.warn(`Routes API (${mode}) failed:`, error);
    return null;
  }
}

function transitLines(route) {
  const names = [];
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      const line = step.transitDetails?.transitLine;
      const name = line && (line.nameShort || line.name);
      if (name && names[names.length - 1] !== name) {
        names.push(name);
      }
    }
  }
  return names.join(' → ');
}

// Offline guess from straight-line distance, used when there's no API key.
function estimateRoutes(from, to) {
  const miles = haversineMiles(from, to) * 1.3;
  const crossesHudson = from.state !== to.state;
  const results = [
    describeRoute('TRANSIT', (miles / 12) * 60 + 10 + (crossesHudson ? 10 : 0), miles, from, to),
    describeRoute('DRIVE', (miles / 18) * 60 + (crossesHudson ? 20 : 0), miles, from, to),
  ];
  // You can't really walk or bike across the Hudson.
  if (!crossesHudson) {
    results.push(describeRoute('BICYCLE', (miles / 10) * 60, miles, from, to));
    results.push(describeRoute('WALK', (miles / 3) * 60, miles, from, to));
  }
  return results;
}

function describeRoute(mode, minutes, miles, from, to, fareUsd = null, detail = '') {
  const crossesHudson = from.state !== to.state;
  let cost = 0;
  if (mode === 'DRIVE') {
    cost = miles * COSTS.carPerMile + to.parking + (from.state === 'NJ' && to.state === 'NY' ? COSTS.hudsonToll : 0);
  } else if (mode === 'TRANSIT') {
    cost = fareUsd ?? (crossesHudson ? COSTS.transitCrossHudson : COSTS.transitLocal);
  }

  return {
    mode,
    minutes,
    miles,
    cost,
    co2: miles * CO2_KG_PER_MILE[mode],
    detail,
    tooLong: MAX_MINUTES[mode] !== undefined && minutes > MAX_MINUTES[mode],
  };
}

function haversineMiles(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

function recommend(results) {
  const options = results.filter((r) => !r.tooLong);
  if (options.length === 0) {
    return null;
  }
  const preference = PREFERENCES[preferenceIndex].key;
  const score = {
    fastest: (r) => [r.minutes],
    cheapest: (r) => [Math.round(r.cost * 100), r.minutes],
    greenest: (r) => [Math.round(r.co2 * 100), r.minutes],
  }[preference];

  return options.reduce((best, r) => {
    const [a1, a2 = 0] = score(r);
    const [b1, b2 = 0] = score(best);
    return a1 < b1 || (a1 === b1 && a2 < b2) ? r : best;
  });
}

// ---------------------------------------------------------------------------
// Drawing

function unit() {
  return Math.max(14, overlay.width * 0.014);
}

function drawPlaceTags(visible) {
  const u = unit();
  for (const [role, point] of visible) {
    let text;
    let color;
    if (PLACES[role]) {
      text = `${PLACES[role].icon} ${PLACES[role].label}`;
      color = PLACES[role].color;
    } else if (role === 'transport') {
      text = '🧭 Transport';
      color = '#ffffff';
    } else if (role === 'preference') {
      const p = PREFERENCES[preferenceIndex];
      text = `${p.icon} ${p.label}`;
      color = '#c6ff8a';
    } else {
      continue;
    }
    drawPill(text, point.x, point.y - QR_SIZE * 0.75, color, u * 1.4);
  }
}

function drawConnection({ from, to, transport }) {
  const u = unit();
  overlayCtx.save();
  overlayCtx.lineWidth = u * 0.5;
  overlayCtx.lineCap = 'round';
  overlayCtx.setLineDash([u * 1.2, u * 0.9]);
  overlayCtx.strokeStyle = 'rgba(255,255,255,0.9)';

  // Curve that passes through the transport code.
  const cx = 2 * transport.x - (from.point.x + to.point.x) / 2;
  const cy = 2 * transport.y - (from.point.y + to.point.y) / 2;
  overlayCtx.beginPath();
  overlayCtx.moveTo(from.point.x, from.point.y);
  overlayCtx.quadraticCurveTo(cx, cy, to.point.x, to.point.y);
  overlayCtx.stroke();

  // Arrowhead at the destination, pointing along the curve.
  const angle = Math.atan2(to.point.y - cy, to.point.x - cx);
  const tipX = to.point.x - Math.cos(angle) * QR_SIZE * 0.6;
  const tipY = to.point.y - Math.sin(angle) * QR_SIZE * 0.6;
  const size = u * 2;
  overlayCtx.setLineDash([]);
  overlayCtx.fillStyle = '#ffffff';
  overlayCtx.beginPath();
  overlayCtx.moveTo(tipX, tipY);
  overlayCtx.lineTo(tipX - size * Math.cos(angle - 0.45), tipY - size * Math.sin(angle - 0.45));
  overlayCtx.lineTo(tipX - size * Math.cos(angle + 0.45), tipY - size * Math.sin(angle + 0.45));
  overlayCtx.closePath();
  overlayCtx.fill();
  overlayCtx.restore();
}

function drawHud(visible, connection, route) {
  const u = unit();
  const pad = u;
  const p = PREFERENCES[preferenceIndex];

  overlayCtx.save();
  overlayCtx.textBaseline = 'top';
  overlayCtx.font = `600 ${u * 1.3}px system-ui, sans-serif`;
  drawPanel(pad, pad, u * 16, u * 2.6, 0.55);
  overlayCtx.fillStyle = '#c6ff8a';
  overlayCtx.fillText(`Prefer: ${p.icon} ${p.label}`, pad * 1.8, pad * 1.6);
  overlayCtx.restore();

  if (!connection) {
    const hint = !visible.has('transport')
      ? 'Hold the 🧭 transport code between two places'
      : 'Show two place codes next to 🧭 transport';
    drawBanner(hint);
  } else if (route.status !== 'done') {
    drawBanner('Finding routes…');
  }
}

function drawBanner(text) {
  const u = unit();
  overlayCtx.save();
  overlayCtx.font = `500 ${u * 1.5}px system-ui, sans-serif`;
  const w = overlayCtx.measureText(text).width + u * 3;
  const h = u * 3;
  const x = (overlay.width - w) / 2;
  const y = overlay.height - h - u * 2;
  drawPanel(x, y, w, h, 0.6);
  overlayCtx.fillStyle = '#fff';
  overlayCtx.textBaseline = 'middle';
  overlayCtx.textAlign = 'center';
  overlayCtx.fillText(text, overlay.width / 2, y + h / 2);
  overlayCtx.restore();
}

// ---------------------------------------------------------------------------
// Pop-up + voice. The pop-up only appears once transport has connected two
// places and the routes are in. It's read out loud once per connection, and
// again if the preference changes the recommendation.

const popup = document.getElementById('popup');
const popupTitle = document.getElementById('popup-title');
const popupBest = document.getElementById('popup-best');
const popupList = document.getElementById('popup-list');
const popupSource = document.getElementById('popup-source');
const speakButton = document.getElementById('speak-button');
const muteButton = document.getElementById('mute-button');

// Keep the pop-up up briefly when the codes flicker out of view.
const POPUP_HIDE_DELAY_MS = 1200;

let popupKey = null; // what's currently rendered
let spokenKey = null; // what was last read out
let popupLastConnected = 0;
let currentSpeech = '';
let muted = false;

speakButton.addEventListener('click', () => speak(currentSpeech, true));
muteButton.addEventListener('click', () => {
  muted = !muted;
  muteButton.textContent = muted ? '🔇' : '🔊';
  muteButton.setAttribute('aria-label', muted ? 'Unmute voice' : 'Mute voice');
  if (muted) {
    speechSynthesis.cancel();
  }
});

function updatePopup(connection, route, now) {
  if (connection && route.status === 'done' && route.results.length > 0) {
    popupLastConnected = now;
    const from = PLACES[connection.from.role];
    const to = PLACES[connection.to.role];
    const best = recommend(route.results);
    const key = `${connection.from.role}->${connection.to.role}|${preferenceIndex}`;

    if (key !== popupKey) {
      renderPopup(from, to, route, best);
      popupKey = key;
    }
    popup.hidden = false;
    requestAnimationFrame(() => popup.classList.add('show'));

    if (key !== spokenKey) {
      spokenKey = key;
      speak(currentSpeech);
    }
    return;
  }

  if (!popup.hidden && now - popupLastConnected > POPUP_HIDE_DELAY_MS) {
    popup.classList.remove('show');
    popup.hidden = true;
    popupKey = null;
    // Reconnecting the same places later reads it out again.
    spokenKey = null;
    speechSynthesis.cancel();
  }
}

function renderPopup(from, to, route, best) {
  const pref = PREFERENCES[preferenceIndex];
  popupTitle.textContent = `${from.icon} ${from.label}  →  ${to.icon} ${to.label}`;

  if (best) {
    const info = MODE_INFO[best.mode];
    popupBest.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'best-mode';
    head.textContent = `${info.icon} ${info.label}`;
    const meta = document.createElement('div');
    meta.className = 'best-meta';
    meta.textContent = [formatMinutes(best.minutes), formatCost(best.cost), best.detail].filter(Boolean).join(' · ');
    const tag = document.createElement('div');
    tag.className = 'best-tag';
    tag.textContent = `${pref.icon} ${pref.label} pick`;
    popupBest.append(tag, head, meta);
  } else {
    popupBest.textContent = 'No good option found.';
  }

  popupList.innerHTML = '';
  const others = route.results.filter((r) => r !== best).sort((a, b) => a.minutes - b.minutes);
  for (const r of others) {
    const li = document.createElement('li');
    if (r.tooLong) {
      li.className = 'too-long';
    }
    const info = MODE_INFO[r.mode];
    li.textContent = `${info.icon} ${info.label} · ${formatMinutes(r.minutes)} · ${formatCost(r.cost)}${r.tooLong ? ' · too far' : ''}`;
    popupList.append(li);
  }

  popupSource.textContent = route.source === 'live'
    ? 'Live from Google Maps · cost & CO₂ are estimates'
    : 'Offline estimate — add a Google Maps key for real routes';

  currentSpeech = speechFor(from, to, best, others);
}

function speechFor(from, to, best, others) {
  if (!best) {
    return `I couldn't find a good way from ${from.label} to ${to.label}.`;
  }
  const pref = PREFERENCES[preferenceIndex].label.toLowerCase();
  const verb = { TRANSIT: 'take transit', DRIVE: 'drive', BICYCLE: 'bike', WALK: 'walk' }[best.mode];
  let text = `From ${from.label} to ${to.label}, the ${pref} way is to ${verb}. ` +
    `It takes about ${spokenMinutes(best.minutes)}`;
  text += best.cost > 0 ? `, and costs around ${Math.round(best.cost)} dollars.` : ', and it\'s free.';
  if (best.mode === 'TRANSIT' && best.detail) {
    text += ` Ride ${best.detail.replace(/ → /g, ', then ')}.`;
  }
  const alt = others.find((r) => !r.tooLong);
  if (alt) {
    text += ` Or ${MODE_INFO[alt.mode].label.toLowerCase()}, about ${spokenMinutes(alt.minutes)}.`;
  }
  return text;
}

function spokenMinutes(minutes) {
  const m = Math.round(minutes);
  if (m < 60) {
    return `${m} minutes`;
  }
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h} hour${h > 1 ? 's' : ''}${rest ? ` ${rest} minutes` : ''}`;
}

function formatCost(cost) {
  return cost > 0 ? `$${cost.toFixed(cost < 10 ? 2 : 0)}` : 'free';
}

// Chrome/Safari only allow speech after a click, so the Start button calls
// this once to "unlock" it.
function unlockSpeech() {
  if (!('speechSynthesis' in window)) {
    return;
  }
  const silent = new SpeechSynthesisUtterance('');
  silent.volume = 0;
  speechSynthesis.speak(silent);
}

function speak(text, force = false) {
  if (!text || !('speechSynthesis' in window) || (muted && !force)) {
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = VOICE.lang;
  utterance.rate = VOICE.rate;
  const voice = speechSynthesis.getVoices().find((v) => v.name === VOICE.name)
    || speechSynthesis.getVoices().find((v) => v.lang === VOICE.lang);
  if (voice) {
    utterance.voice = voice;
  }
  speechSynthesis.speak(utterance);
}

function formatMinutes(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function drawPill(text, cx, cy, color, size) {
  overlayCtx.save();
  overlayCtx.font = `700 ${size}px system-ui, sans-serif`;
  const w = overlayCtx.measureText(text).width + size * 1.2;
  const h = size * 1.8;
  overlayCtx.fillStyle = 'rgba(0,0,0,0.65)';
  roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  overlayCtx.fill();
  overlayCtx.lineWidth = size * 0.15;
  overlayCtx.strokeStyle = color;
  overlayCtx.stroke();
  overlayCtx.fillStyle = color;
  overlayCtx.textAlign = 'center';
  overlayCtx.textBaseline = 'middle';
  overlayCtx.fillText(text, cx, cy + size * 0.05);
  overlayCtx.restore();
}

function drawPanel(x, y, w, h, alpha) {
  overlayCtx.fillStyle = `rgba(0,0,0,${alpha})`;
  roundRect(x, y, w, h, unit() * 0.8);
  overlayCtx.fill();
}

function roundRect(x, y, w, h, r) {
  overlayCtx.beginPath();
  overlayCtx.roundRect(x, y, w, h, r);
}

// ---------------------------------------------------------------------------
// QR detection

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
