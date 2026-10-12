// Everything you'd want to tweak lives here: which printed QR code means
// what, where each place is, and the rough cost / CO2 numbers used to pick
// a recommendation.

// Google Maps Platform key with the **Routes API** enabled.
// Don't commit a real key to a public repo — instead open the page once as
//   https://.../?key=YOUR_KEY
// and it is remembered in this browser (localStorage). Restrict the key to
// your site's URL in Google Cloud Console.
const GOOGLE_MAPS_API_KEY = '';

// The printed QR codes are reused from the old game. Their decoded text is
// on the left; what they mean now is on the right.
const QR_ROLES = {
  phone: 'home',
  notebook: 'sva',
  bottle: 'shoprite',
  'object-b': 'gnc',
  'object-a': 'transport',
  'object-c': 'preference',
};

// Places. `address` is what Google Maps routes to/from. `lat`/`lng` are
// only used for the offline estimate when there's no API key.
const PLACES = {
  home: {
    label: 'Home',
    sub: 'New Jersey',
    icon: '🏠',
    color: '#ffb347',
    address: '100 Christopher Columbus Dr, Jersey City, NJ 07302',
    lat: 40.7167,
    lng: -74.0392,
    state: 'NJ',
    parking: 0,
  },
  sva: {
    label: 'SVA',
    sub: 'New York',
    icon: '🎨',
    color: '#7ab8ff',
    address: '136 W 21st St, New York, NY 10011',
    lat: 40.7417,
    lng: -73.9944,
    state: 'NY',
    parking: 35, // Manhattan garage, rough daily rate
  },
  shoprite: {
    label: 'ShopRite',
    sub: 'Groceries',
    icon: '🛒',
    color: '#ff6b6b',
    address: 'ShopRite of Metro Plaza, Luis Marin Blvd & 6th St, Jersey City, NJ 07302',
    lat: 40.7262,
    lng: -74.0420,
    state: 'NJ',
    parking: 0,
  },
  gnc: {
    label: 'GNC',
    sub: 'Newport',
    icon: '💪',
    color: '#c58bff',
    address: 'GNC, Newport Centre, Jersey City, NJ',
    lat: 40.7274,
    lng: -74.0377,
    state: 'NJ',
    parking: 0,
  },
};

// Real door-to-door times, looked up in Google Maps and the PATH app.
// Used whenever there's no Google API key. Key is "from->to".
// A mode set to 'estimate' is guessed from distance. Pairs not listed here
// fall back to the guess for every mode.
const PRESET_ROUTES = {
  'home->sva': {
    TRANSIT: {
      minutes: 30, // door to door, not counting the wait for the train
      miles: 4,
      fare: 3.00,
      detail: 'PATH Grove St → 23rd St',
      say: 'Take the PATH from Grove Street to 23rd Street.',
      schedule: 'GROVE_TO_33RD',
      walkToStation: 4, // home -> Grove St platform
    },
    DRIVE: 'estimate',
  },
  'sva->home': {
    TRANSIT: {
      minutes: 30,
      miles: 4,
      fare: 3.00,
      detail: 'PATH 23rd St → Grove St',
      say: 'Take the PATH from 23rd Street to Grove Street.',
    },
    DRIVE: 'estimate',
  },
  'home->shoprite': {
    WALK: { minutes: 9, miles: 0.4 },
    BICYCLE: { minutes: 5, miles: 0.4 },
    DRIVE: { minutes: 3, miles: 0.4 },
  },
  'shoprite->home': {
    WALK: { minutes: 9, miles: 0.4 },
    BICYCLE: { minutes: 5, miles: 0.4 },
    DRIVE: { minutes: 3, miles: 0.4 },
  },
  'home->gnc': {
    WALK: { minutes: 16, miles: 0.7 },
    BICYCLE: { minutes: 7, miles: 0.7 },
    DRIVE: { minutes: 5, miles: 0.7 },
  },
  'gnc->home': {
    WALK: { minutes: 16, miles: 0.7 },
    BICYCLE: { minutes: 7, miles: 0.7 },
    DRIVE: { minutes: 5, miles: 0.7 },
  },
};

// Train timetables: [first departure, last departure, every N minutes].
// GROVE_TO_33RD is copied from the PATH app (Grove St -> 23rd St, 33rd St
// line). Rows marked "guess" weren't in the screenshots.
const TIMETABLES = {
  GROVE_TO_33RD: [
    ['07:08', '07:33', 5],
    ['07:37', '08:45', 4],
    ['08:51', '09:57', 6], // guess
    ['10:04', '15:04', 12],
    ['15:13', '15:53', 10],
    ['15:58', '18:58', 5], // 18:53 and 18:58 are a guess
    ['19:03', '19:53', 10],
    ['20:04', '22:16', 12],
    ['22:31', '22:31', 1],
    ['22:44', '22:44', 1],
    ['23:04', '23:04', 1],
  ],
};

// Rough numbers for "cheapest" and "greenest". Edit freely — they're
// estimates, not quotes.
const COSTS = {
  carPerMile: 0.70,       // gas + wear, USD
  hudsonToll: 17.0,       // NJ -> NY crossing (tunnel/bridge), USD
  transitLocal: 2.90,     // one bus/subway ride, USD
  transitCrossHudson: 3.0, // one PATH ride, USD
};

const CO2_KG_PER_MILE = {
  DRIVE: 0.40,
  TRANSIT: 0.15,
  WALK: 0,
  BICYCLE: 0,
};

// Walking or biking longer than this isn't a realistic suggestion.
const MAX_MINUTES = {
  WALK: 45,
  BICYCLE: 60,
};

// Show the webcam like a mirror (your left = screen left). Set to false for
// a camera pointing down at a table or away from you.
const MIRROR_VIDEO = true;

// Read-aloud voice. `name` is optional — leave '' to use the default voice
// for `lang`. On a Mac, e.g. 'Samantha'.
const VOICE = {
  lang: 'en-US',
  name: '',
  rate: 1,
};
