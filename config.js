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
  'object-a': 'transport',
  'object-b': 'preference',
  // 'object-c' is free — not used yet.
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
    address: 'ShopRite, Luis Marin Blvd & 6th St, Jersey City, NJ 07302',
    lat: 40.7262,
    lng: -74.0420,
    state: 'NJ',
    parking: 0,
  },
};

// Rough numbers for "cheapest" and "greenest". Edit freely — they're
// estimates, not quotes.
const COSTS = {
  carPerMile: 0.70,       // gas + wear, USD
  hudsonToll: 17.0,       // NJ -> NY crossing (tunnel/bridge), USD
  transitLocal: 2.90,     // one bus/subway ride, USD
  transitCrossHudson: 6.0, // PATH/NJ Transit + subway, USD
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
