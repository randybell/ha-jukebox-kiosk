// Mock `hass` for the jukebox-card dev harness. No network, no Home Assistant.
// Shapes follow the real exports in /workspace/ha-exports (HA 2026.10.4, MA 2.10.9):
//  - music_assistant.search -> {context, response:{artists, albums, tracks, playlists, radio, audiobooks, podcasts}} (always 7 lists)
//    items: {media_type, uri, name, version, image, favorite, explicit} (+artists[]/album{} on tracks, artists[] on albums).
//    No provider / duration / year / owner / metadata. Provider is the uri scheme (library://, apple_music://, apple_music--XXXXXXXX://).
//  - music_assistant.get_library -> {response:{items, limit, offset, order_by, media_type}}
//  - music_assistant.get_queue (entity) -> {response:{<entity_id>: {current_index, current_item{queue_item_id,...}, items:<count>, shuffle_enabled, repeat_mode}}}
//  - radio items: {media_type:'radio', uri:'radiobrowser://radio/<uuid>', name (often with leading tabs/spaces), image (https or null)}
//  - media_player.everywhere: entity_picture is an absolute LAN URL (not loadable from the kiosk); entity_picture_local is
//    /api/media_player_proxy/... (served by dev/api/ in the harness).
// URL params: latency, jitter, mode=fixed|inverse, real=1 (search returns the real "eagles" sample),
// radio=1 (Radio Browser stations in search only; the library has none, as on the real server), radio=lib (stations in the library too),
// default: no radio provider at all;
// idle=1 (nothing playing), empty=1 (empty library), noart=1 (player without entity_picture_local),
// pods=1 (a podcast + an audiobook in the catalog),
// playlat=<ms> (play_media round trip, default 20).
// Lyrics (through the Jukebox Kiosk mock's jukebox_kiosk/ma): lyrics=none (nothing has lyrics); lyrlat, lyrfail: see mock-kiosk.js.
// The mock lyrics are INVENTED placeholder text (see dev/fixtures/ma-lyrics-sample.json), never real song lyrics.
// 'So What' = synced via metadata/get_track_lyrics, 'Teardrop' = synced in item metadata, 'Dreams' = plain, the rest = none.
// music_assistant.search with `artist` / `album`: MA prefixes the query ("artist - name"); the mock keeps only items by that artist.
// Speakers (0.5.0): dev/mock-ma.js adds media_player.indoor / media_player.outdoor (dynamic MA groups, each with its own queue)
// and the players/*, player_queues/* and config/players/* MA commands (logged in __maLog; writes also in __calls). See mock-ma.js for params.
// admin=1 (the user is an admin), user=<name>, uid=<user id>. nolib=1: get_library is refused (a guest without library reads).
// jjgrey=1: the v0.7 search-filters artist (JJ Grey, library + Apple Music, one duplicate track) and look-alikes.
// HA media_player.join / unjoin throw (their ids don't match MA's speakers; the card must use MA set_members).

import { createMa } from './mock-ma.js';
import { createKiosk } from './mock-kiosk.js';

const params = new URLSearchParams(location.search);
export const mock = (window.__mock = {
  latency: Number(params.get('latency') ?? 120),
  jitter: Number(params.get('jitter') ?? 0),
  mode: params.get('mode') ?? 'fixed',
  fail: false,
  failQueue: params.get('qfail') === '1',
});
window.__calls = [];
window.__lyricsLog = [];
window.__itemByUriLog = [];
const REAL = params.get('real') === '1';
const RADIO = params.get('radio') === '1' || params.get('radio') === 'lib';
const RADIO_LIB = params.get('radio') === 'lib';
const NOART = params.get('noart') === '1';
const EMPTY = params.get('empty') === '1';
const PODS = params.get('pods') === '1';
const LYRNONE = params.get('lyrics') === 'none';
/** the Music Assistant config entry (the Jukebox Kiosk mock reports it; music_assistant.* services refuse anything else) */
export const MA_ENTRY = '01MUSICASSISTANT0000000000';
const fixture = async (f) => (await fetch(new URL(`./fixtures/${f}`, import.meta.url))).json();
const realRadio = await fixture('ma-search-sample-radio.json').then((d) => d.result.response.radio).catch(() => []);
const realSample = REAL ? (await (await fetch(new URL('./fixtures/ma-search-sample.json', import.meta.url))).json()).result.response : null;

const PALETTE = [['#ff2e7e', '#ff9a3d'], ['#3b2cff', '#00d4c4'], ['#ffd23f', '#ff4f8b'], ['#00b37e', '#1e3cff'], ['#c42fd8', '#ffd23f'], ['#ff7a3d', '#7a2cff'], ['#0fd1ff', '#ff2e7e'], ['#7a2cff', '#00d4c4']];
const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7) >>> 0;
function art(name) {
  const [a, b] = PALETTE[h(name) % PALETTE.length];
  const init = name.replace(/^the /i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="${40 + (h(name) % 120)}" cy="${50 + (h(name + 'y') % 90)}" r="46" fill="#ffffff" opacity=".22"/><text x="18" y="182" font-family="Helvetica,Arial" font-weight="800" font-size="54" fill="#fff" opacity=".9">${init}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seqId = 1000;
const nid = () => String(seqId++);
// provider scheme per item: 'library' | 'apple_music'. Nested artists of apple_music items use the instance id (as in the real sample).
const nestedScheme = (p) => (p === 'apple_music' ? 'apple_music--XXXXXXXX' : p);
const short = (media_type, uri, name, image = null) => ({ media_type, uri, name, version: '', image });

// ---- catalog (internal fields start with _ and are stripped from responses) ----
const A = {}; // artist name -> item
function artist(name, prov = 'library', fav = false) {
  const it = { media_type: 'artist', uri: `${prov}://artist/${prov === 'library' ? nid() : encodeURIComponent(name)}`, name, version: '', image: art(name), favorite: fav, explicit: null, fanart_image: null, _added: h(name) % 1000 };
  A[name] = it; return it;
}
const nestedArtist = (by, prov) => short('artist', prov === 'library' ? (A[by]?.uri ?? `library://artist/${h(by) % 9000}`) : `${nestedScheme(prov)}://artist/${encodeURIComponent(by)}`, by);
function album(name, by, prov = 'library', fav = false) {
  return { media_type: 'album', uri: `${prov}://album/${nid()}`, name, version: '', image: art(name), favorite: fav, explicit: null, discart_image: null, artists: [nestedArtist(by, prov)], _added: h(name) % 1000 };
}
function track(name, by, alb, dur, prov = 'library', version = '', fav = false) {
  return { media_type: 'track', uri: `${prov}://track/${nid()}`, name, version, image: art(alb), favorite: fav, explicit: null,
    artists: [nestedArtist(by, prov)], album: short('album', `${prov}://album/${h(alb) % 90000}`, alb, art(alb)), _duration: dur, _added: h(name + by) % 1000, _played: h(by + name) % 1000 };
}
const playlist = (name, prov = 'library', fav = false) => ({ media_type: 'playlist', uri: `${prov}://playlist/${nid()}`, name, version: '', image: art(name), favorite: fav, explicit: null, _added: h(name) % 1000 });
const uuid = (s) => { const x = [0, 1, 2, 3].map((i) => h(s + i).toString(16).padStart(8, '0')).join(''); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`; };
// Radio Browser station as MA returns it: tab/space-padded name, https logo or null
const radio = (name, logo, played = 0) => ({ media_type: 'radio', uri: `radiobrowser://radio/${uuid(name)}`, name, version: '',
  image: logo === undefined ? `https://logos.radio.example/${h(name).toString(36)}.png` : logo, favorite: false, explicit: null, _added: h(name) % 1000, _played: played, _plays: played });
// stations=fake: placeholder station names only (screenshots); radiofav=N: the first N library stations are favourites
const FAKE_STATIONS = ['Mockingbird FM', 'Lakeside Jazz 101', 'Night Owl Radio', 'Placeholder Talk 7', 'Harbour Lights Classical', 'Static & Signal',
  'Example City Hits', 'Fakeville Country 88', 'Sample Beats Radio', 'Testcard Oldies', 'Demo Drive 95.5', 'Lorem Ipsum Lounge'];
const STATIONS = () => (params.get('stations') === 'fake' ? FAKE_STATIONS.map((n, i) => radio(n, undefined, 40 - i * 3)) : [
  ...realRadio.map((x, i) => ({ ...x, _added: 900 - i, _played: 50 - i, _plays: 50 - i })),
  radio('\tRadio Paradise - Main Mix', undefined, 80), radio(' \tJazz FM', undefined, 30), radio('Magic Radio\t', null, 12),
  radio('\t\tKEXP 90.3 FM', undefined, 64), radio('BBC Radio 6 Music', undefined, 71), radio('\tSomaFM Groove Salad', undefined, 44),
  radio('FIP Radio', null, 9), radio('\tAbsolute Classic Rock', undefined, 22), radio('NTS Radio 1 ', undefined, 5),
]).map((x, i) => (i < Number(params.get('radiofav') ?? 0) ? { ...x, favorite: true } : x))
  // radioinlib=N (heart lookup): the first N stations are already library items (e.g. favourited elsewhere)
  .map((x, i) => (i < Number(params.get('radioinlib') ?? 0) ? { ...x, _inlib: true } : x));
// station sheet (0.6.3): what music/item_by_uri adds for a few placeholder stations (fake text); the others have no extra fields
const STATION_DETAILS = {
  'Mockingbird FM': { description: 'Placeholder station for screenshots: easy listening all day, with a fake morning show and no real broadcaster behind it.',
    genres: ['Easy listening', 'Pop'], domain: 'tunein', ct: 'mp3', br: 128 },
  'Lakeside Jazz 101': { description: 'Made-up jazz station used by the mock.', genres: ['Jazz'], domain: 'radiobrowser', ct: 'aac', br: 64 },
};
const stationDetail = (t) => {
  const d = STATION_DETAILS[t.name.trim()];
  return { metadata: { description: d?.description ?? null, genres: d?.genres ?? [], images: null },
    provider_mappings: [{ item_id: 'XXXXXXXX', provider_domain: d?.domain ?? 'radiobrowser', provider_instance: `${d?.domain ?? 'radiobrowser'}--XXXXXXXX`, available: true,
      audio_format: { content_type: d?.ct ?? '?', bit_rate: d?.br ?? 0 } }] };
};

const CATALOG = {
  artists: [
    artist('The Mock Ups', 'library', true), artist('Mockingbird Trio', 'apple_music'), artist('Mocktail Lounge'), artist('DJ Mockery'),
    artist('Miles Davis', 'library', true), artist('Moby', 'apple_music'), artist('Muse'), artist('Massive Attack', 'library', true), artist('Mumford & Sons', 'apple_music'),
    artist('Madonna'), artist('Metallica'), artist('Eagles', 'library', true), artist('Fleetwood Mac'), artist('Abba', 'apple_music'), artist('Adele'),
    artist('Bob Marley & The Wailers'), artist('Coldplay', 'apple_music'), artist('Daft Punk', 'library', true), artist('Norah Jones'), artist('Air'), artist('The Beatles', 'library', true),
    // "chicago": the band (library + the same artist on Apple Music), plus look-alikes that must not show up as its albums
    artist('Chicago', 'library', true), artist('Chicago Symphony Orchestra', 'apple_music'),
    // the same band from Apple Music, without artwork (not registered in A: nested artists of library items keep the library uri)
    { media_type: 'artist', uri: 'apple_music://artist/Chicago', name: 'Chicago', version: '', image: null, favorite: false, explicit: null, fanart_image: null, _added: 11 },
  ],
  albums: [
    album('Mock Turtle Soup', 'The Mock Ups', 'library', true), album('Mocking the Blues', 'Mockingbird Trio', 'apple_music'),
    album('Mockumentary OST', 'Various Artists', 'apple_music'), album('Mock Sessions Vol. 2', 'Lorem Funk'),
    album('Kind of Blue', 'Miles Davis', 'library', true), album('Mezzanine', 'Massive Attack'), album('Moon Safari', 'Air', 'library', true),
    album('Hotel California', 'Eagles', 'library', true), album('Rumours', 'Fleetwood Mac'), album('Abbey Road', 'The Beatles', 'apple_music'),
    album('Come Away with Me', 'Norah Jones'), album('Random Access Memories', 'Daft Punk', 'library', true), album('Their Greatest Hits 1971-1975', 'Eagles', 'apple_music'),
    album('Discovery', 'Daft Punk'), album('Play', 'Moby'), album('The 2nd Law', 'Muse'), album('21', 'Adele'), album('Arrival', 'Abba', 'apple_music'),
    album('Exodus', 'Bob Marley & The Wailers'), album('Parachutes', 'Coldplay', 'apple_music'), album('Master of Puppets', 'Metallica'), album('Like a Prayer', 'Madonna'),
    album('Sigh No More', 'Mumford & Sons'), album('Tusk', 'Fleetwood Mac'),
    album('Chicago Transit Authority', 'Chicago', 'library', true), album('Chicago X', 'Chicago'), album('Chicago 17', 'Chicago', 'apple_music'),
    album('Chicago X', 'Chicago', 'apple_music'), // same album on another provider: shown once
    album('Chicago (Original Broadway Cast)', 'Original Broadway Cast', 'apple_music'), album('Mahler: Symphony No. 5', 'Chicago Symphony Orchestra', 'apple_music'),
  ],
  tracks: [
    track('Mockingbird Lane', 'The Mock Ups', 'Mock Turtle Soup', 221), track('Mock Sunrise', 'Placeholder Band', 'Ipsum', 242, 'apple_music'),
    track("Don't Mock the Groove", 'Lorem Funk', 'Mock Sessions Vol. 2', 195), track('Mockingjay Blues', 'Mockingbird Trio', 'Mocking the Blues', 288, 'apple_music'),
    track('Mocktail Hour', 'Mocktail Lounge', 'Happy Hour', 204), track('Mock Turtle', 'The Mock Ups', 'Mock Turtle Soup', 176, 'library', 'Remastered 2024'),
    track('Mockery', 'DJ Mockery', 'Mockery EP', 312), track('So What', 'Miles Davis', 'Kind of Blue', 562, 'library', '', true), track('Freddie Freeloader', 'Miles Davis', 'Kind of Blue', 589),
    track('Blue in Green', 'Miles Davis', 'Kind of Blue', 337), track('All Blues', 'Miles Davis', 'Kind of Blue', 693), track('Teardrop', 'Massive Attack', 'Mezzanine', 330, 'library', '', true),
    track('Angel', 'Massive Attack', 'Mezzanine', 379), track('Porcelain', 'Moby', 'Play', 241, 'apple_music'), track('Madness', 'Muse', 'The 2nd Law', 281),
    track('Hotel California', 'Eagles', 'Hotel California', 391, 'library', '', true), track('New Kid in Town', 'Eagles', 'Hotel California', 304), track('Life in the Fast Lane', 'Eagles', 'Hotel California', 286),
    track('The Last Resort', 'Eagles', 'Hotel California', 445), track('Take It Easy', 'Eagles', 'Their Greatest Hits 1971-1975', 211, 'apple_music'),
    track('Dreams', 'Fleetwood Mac', 'Rumours', 257, 'library', '', true), track('Go Your Own Way', 'Fleetwood Mac', 'Rumours', 218), track('The Chain', 'Fleetwood Mac', 'Rumours', 270),
    track('Come Together', 'The Beatles', 'Abbey Road', 259, 'apple_music'), track('Here Comes the Sun', 'The Beatles', 'Abbey Road', 185, 'apple_music'),
    track("Don't Know Why", 'Norah Jones', 'Come Away with Me', 186), track('Get Lucky', 'Daft Punk', 'Random Access Memories', 369, 'library', '', true),
    track('Instant Crush', 'Daft Punk', 'Random Access Memories', 337), track('One More Time', 'Daft Punk', 'Discovery', 320), track('La Femme d\'Argent', 'Air', 'Moon Safari', 429),
    track('Sexy Boy', 'Air', 'Moon Safari', 298), track('Mo Money Mo Problems', 'The Notorious B.I.G.', 'Life After Death', 257, 'apple_music'), track('Moondance', 'Van Morrison', 'Moondance', 274, 'apple_music'),
    track('Rolling in the Deep', 'Adele', '21', 228), track('Dancing Queen', 'Abba', 'Arrival', 231, 'apple_music'), track('Three Little Birds', 'Bob Marley & The Wailers', 'Exodus', 180),
    track('Yellow', 'Coldplay', 'Parachutes', 269, 'apple_music'), track('Like a Prayer', 'Madonna', 'Like a Prayer', 340), track('Little Lion Man', 'Mumford & Sons', 'Sigh No More', 245),
    track('25 or 6 to 4', 'Chicago', 'Chicago Transit Authority', 290), track('Beginnings', 'Chicago', 'Chicago Transit Authority', 474), track('Questions 67 and 68', 'Chicago', 'Chicago Transit Authority', 303),
    track('If You Leave Me Now', 'Chicago', 'Chicago X', 236, 'library', '', true), track('Another Rainy Day in New York City', 'Chicago', 'Chicago X', 180),
    track("Hard to Say I'm Sorry", 'Chicago', 'Chicago 17', 302, 'apple_music'), track("You're the Inspiration", 'Chicago', 'Chicago 17', 228, 'apple_music'),
    track('All That Jazz', 'Original Broadway Cast', 'Chicago (Original Broadway Cast)', 362, 'apple_music'), track('Chicago', 'Frank Sinatra', 'Sinatra Sings', 133, 'apple_music'),
  ],
  playlists: [
    playlist('Mock Rock Essentials', 'library', true), playlist('Mockingbird Jazz Club', 'apple_music'), playlist('Monday Morning Mix'),
    playlist('Motown Classics', 'apple_music'), playlist('Eagles'), playlist('Long Drive'), playlist('Mellow Moods', 'library', true), playlist('Dinner Party'), playlist('Garage Workout', 'apple_music'),
    playlist('Chicago Blues Classics', 'apple_music'),
  ],
  radio: RADIO ? [...STATIONS(), ...(params.get('stations') === 'fake' ? [] : [radio('\tWXRT Chicago 93.1 FM', undefined, 3)])] : [],
  podcasts: PODS ? [{ media_type: 'podcast', uri: 'library://podcast/31', name: 'The Mockcast', version: '', image: art('The Mockcast'), favorite: false, explicit: null, _added: 5 },
    { media_type: 'podcast', uri: 'library://podcast/32', name: 'Chicago Stories', version: '', image: null, favorite: false, explicit: null, _added: 6 }] : [],
  audiobooks: PODS ? [{ media_type: 'audiobook', uri: 'library://audiobook/7', name: 'The Mock Chronicles', version: '', image: art('Mock Chronicles'), favorite: false, explicit: null,
    authors: ['A. N. Author'], narrators: ['R. Reader'], publisher: 'Mock Press',
    metadata: { release_date: '2024-03-15' },
    provider_mappings: [{ provider_domain: 'audible', audio_format: { content_type: 'mp3', bit_rate: 64 } }], _added: 4 }] : [],
};
// names=fake: every artist / album / track / playlist name that is not already a placeholder becomes an invented one
// (deterministic, for screenshots). Ids and uris are kept so drill-downs and fixtures still line up.
if (params.get('names') === 'fake') {
  const ADJ = ['Velvet', 'Paper', 'Copper', 'Silver', 'Hollow', 'Golden', 'Quiet', 'Neon', 'Amber', 'Cobalt', 'Willow', 'Marble', 'Saffron', 'Indigo', 'Juniper', 'Lantern', 'Harbor', 'Meadow'];
  const NOUN = ['Lanterns', 'Foxes', 'Orchard', 'Tides', 'Satellites', 'Kites', 'Rivers', 'Echoes', 'Comets', 'Pines', 'Harbors', 'Sparrows', 'Atlas', 'Gardens', 'Signals', 'Postcards', 'Islands', 'Embers'];
  const SONG = ['Morning', 'Window', 'Highway', 'Letters', 'Summer', 'Lights', 'Rain', 'Dancing', 'Shadows', 'Waves', 'Sunday', 'Static', 'Paper', 'Horizon', 'Little', 'Blue', 'Slow', 'City'];
  const SONG2 = ['Song', 'Avenue', 'Weather', 'Parade', 'Signal', 'Garden', 'Machine', 'Postcard', 'Lullaby', 'Daydream', 'Tide', 'Echo', 'Hours', 'Motel', 'Theory', 'Glow', 'Drive', 'Bells'];
  const keep = (n) => /mock|placeholder|lorem|ipsum|various artists/i.test(n);
  const used = new Set(), memo = new Map();
  const make = (kind, n, a, b, fmt) => {
    const key = kind + '|' + n; if (memo.has(key)) return memo.get(key);
    if (keep(n)) { memo.set(key, n); return n; }
    let i = h(key), out;
    do { out = fmt(a[i % a.length], b[(i >>> 5) % b.length]); i += 7; } while (used.has(out));
    used.add(out); memo.set(key, out); return out;
  };
  const fa = (n) => make('artist', n, ADJ, NOUN, (x, y) => `The ${x} ${y}`);
  const fl = (n) => make('album', n, ADJ, SONG2, (x, y) => `${x} ${y}`);
  const ft = (n) => make('track', n, SONG, SONG2, (x, y) => `${x} ${y}`);
  const fp = (n) => make('playlist', n, SONG, SONG2, (x, y) => `${x} ${y} Mix`);
  for (const [k, v] of Object.entries(A)) { const n = fa(k); if (n !== k) { v.name = n; v.image = art(n); A[n] = v; delete A[k]; } }
  for (const it of CATALOG.artists) if (!A[it.name]) { it.name = fa(it.name); it.image = art(it.name); }
  for (const it of [...CATALOG.albums, ...CATALOG.tracks, ...CATALOG.playlists]) it._orig = it.name;
  for (const it of CATALOG.albums) { it.name = fl(it.name); it.image = art(it.name); it.artists = it.artists.map((x) => ({ ...x, name: fa(x.name) })); }
  for (const it of CATALOG.tracks) {
    it.name = ft(it.name); it.artists = it.artists.map((x) => ({ ...x, name: fa(x.name) }));
    const al = fl(it.album.name); it.album = { ...it.album, name: al, image: art(al) }; it.image = art(al);
  }
  for (const it of CATALOG.playlists) { it.name = fp(it.name); it.image = art(it.name); }
}
// the real export's album id
CATALOG.albums.find((x) => (x._orig ?? x.name) === 'Hotel California').uri = 'library://album/1448';
// jjgrey=1 (v0.7 search filters): a public artist name with invented albums/tracks, in the library and on Apple Music
// ("Low Tide Lantern" is on both: the provider copy must be dropped), plus look-alike words by other artists
if (params.get('jjgrey') === '1') {
  const J = 'JJ Grey';
  CATALOG.artists.push(artist(J, 'library', true), { media_type: 'artist', uri: 'apple_music://artist/JJ%20Grey', name: J, version: '', image: art(J), favorite: false, explicit: null, _added: 5 },
    artist('Grey Harbor', 'apple_music'), artist('Lantern Choir'));
  A[J] = CATALOG.artists.find((x) => x.name === J && x.uri.startsWith('library://'));
  CATALOG.albums.push(album('Porch Light', J, 'library', true), album('Swamp Radio', J), album('Gulf Coast Sessions', J, 'apple_music'),
    album('Porch Light Blues', 'Grey Harbor', 'apple_music'));
  CATALOG.tracks.push(
    track('Low Tide Lantern', J, 'Porch Light', 245), track('Screen Door', J, 'Porch Light', 212), track('Cypress Morning', J, 'Porch Light', 301),
    track('Bayou Static', J, 'Swamp Radio', 228), track('Lantern Swing', J, 'Swamp Radio', 199),
    track('Low Tide Lantern', J, 'Porch Light', 245, 'apple_music'), track('Gulf Wind', J, 'Gulf Coast Sessions', 265, 'apple_music'),
    track('Pelican Run', J, 'Gulf Coast Sessions', 233, 'apple_music'), track('Lantern on the Levee', J, 'Gulf Coast Sessions', 280, 'apple_music'),
    track('Porch Light Blues', 'Grey Harbor', 'Porch Light Blues', 240, 'apple_music'), track('Lantern', 'Lantern Choir', 'Evensong', 190));
  // the Apple Music-only items are not in the library: get_library leaves them out (search and the artist page still list them)
  for (const k of ['artists', 'albums', 'tracks']) for (const it of CATALOG[k]) if (it.uri.startsWith('apple_music://')) it._nolib = true;
}
const KEYS = ['artists', 'albums', 'tracks', 'playlists', 'radio', 'audiobooks', 'podcasts'];
const TYPE2KEY = { artist: 'artists', album: 'albums', track: 'tracks', playlist: 'playlists', radio: 'radio', audiobook: 'audiobooks', podcast: 'podcasts' };
const pub = (it) => JSON.parse(JSON.stringify(it, (k, v) => (k.startsWith('_') ? undefined : v)));
const allItems = () => KEYS.flatMap((k) => CATALOG[k]);
const libUri = (it) => (it.uri.startsWith('library://') ? it.uri : (it._lib ??= `library://${it.media_type}/${nid()}`));
const libView = (it) => (it.uri.startsWith('library://') ? it : { ...it, uri: libUri(it), favorite: it.favorite,
  artists: it.artists?.map((a) => ({ ...a, uri: A[a.name] ? libUri(A[a.name]) : a.uri })) });
const byUri = (uri) => allItems().find((i) => i.uri === uri || i._lib === uri);
// a station favourited through the Search heart is now a library item, so MA returns its library copy (uri, provider, item_id)
const asLibRadio = (it) => (it.media_type === 'radio' && it._inlib ? { ...libView(it), provider: 'library', item_id: libUri(it).split('/').pop() } : it);
// radiohit=provider (heart lookup): search keeps returning the provider copy (radiobrowser://…) even for library stations
const RADIO_HIT_PROVIDER = params.get('radiohit') === 'provider';

function search(name, limit, types, by = '', libOnly = false) {
  const q = name.trim().toLowerCase();
  const byOk = (it) => !by || (it.artists ?? []).some((a) => a.name.toLowerCase() === by.toLowerCase()) || it.name.toLowerCase() === by.toLowerCase();
  // MA's Radio Browser search also matches tags/genre, so "radio" or "rock" finds stations without it in the name
  const hay = (it) => [it.name, ...(it.artists ?? []).map((a) => a.name), it.album?.name ?? '', it.media_type === 'radio' ? 'radio rock fm' : ''].join(' ').toLowerCase();
  const score = (it) => (it.name.trim().toLowerCase().startsWith(q) ? 0 : it.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) ? 1 : 2);
  const want = new Set((types ?? Object.keys(TYPE2KEY)).map((t) => TYPE2KEY[t]));
  const out = {};
  const asLib = RADIO_HIT_PROVIDER ? (it) => it : asLibRadio;
  for (const key of KEYS) out[key] = want.has(key) ? CATALOG[key].filter((it) => hay(it).includes(q) && byOk(it) && (!libOnly || it.uri.startsWith('library://') || it._inlib)).sort((a, b) => score(a) - score(b)).slice(0, limit).map(asLib).map(pub) : [];
  return out;
}
// 0.7.2 Search source picker: demo MA provider instances (invented instance ids; MA's display names)
export const DEMO_PROVIDERS = [
  { instance_id: 'apple_music--demo0001', domain: 'apple_music', name: 'Apple Music', type: 'music', available: true, supported_features: ['search', 'browse', 'library_tracks'] },
  { instance_id: 'spotify--demo0002', domain: 'spotify', name: 'Spotify', type: 'music', available: true, supported_features: ['search', 'browse'] },
  { instance_id: 'tunein--demo0003', domain: 'tunein', name: 'TuneIn', type: 'music', available: true, supported_features: ['search', 'browse'] },
  { instance_id: 'radiobrowser--demo0004', domain: 'radiobrowser', name: 'Radio Browser', type: 'music', available: true, supported_features: ['search', 'browse'] },
  { instance_id: 'filesystem_local--demo0005', domain: 'filesystem_local', name: 'Local files', type: 'music', available: false, supported_features: ['search', 'browse'] },
  { instance_id: 'chromecast--demo0006', domain: 'chromecast', name: 'Chromecast', type: 'player', available: true, supported_features: [] },
];
window.__provSearchLog = [];
/** MA music/search with providers=[instance_id | 'library', ...]: only those sources' items (catalog items whose uri has
 *  the provider's domain; demo providers without catalog items get re-labelled copies so the screenshots have results).
 *  Several providers: their results one after another, per media type. */
function providerSearch(d) {
  const ids = d.providers.map(String);
  window.__provSearchLog.push({ id: ids.join(','), ids, q: d.search_query, types: d.media_types });
  const out = {};
  for (const id of ids) {
    const r = providerSearchOne(d, id);
    for (const k of KEYS) out[k] = [...(out[k] ?? []), ...(r[k] ?? [])];
  }
  return out;
}
function providerSearchOne(d, id) {
  const types = Array.isArray(d.media_types) && d.media_types.length ? d.media_types.filter((t) => TYPE2KEY[t]) : undefined;
  const all = search(String(d.search_query ?? ''), 200, types ?? Object.keys(TYPE2KEY), '', id === 'library');
  const out = {}; const lim = d.limit ?? 8;
  if (id === 'library') { for (const k of KEYS) out[k] = (all[k] ?? []).filter((it) => it.uri.startsWith('library://') || it._inlib).slice(0, lim); return out; }
  const p = DEMO_PROVIDERS.find((x) => x.instance_id === id);
  if (!p) throw new Error(`ProviderUnavailableError: ${id}`);
  const dom = p.domain;
  const src = dom === 'spotify' ? 'apple_music' : dom === 'tunein' ? 'radiobrowser' : dom;
  for (const k of KEYS) out[k] = (all[k] ?? []).filter((it) => it.uri.startsWith(`${src}://`)).slice(0, lim)
    .map((it) => ({ ...it, provider: id, uri: it.uri.replace(`${src}://`, `${id}://`) }));
  return out;
}
function library({ media_type, favorite, search: s, limit = 25, offset = 0, order_by = 'name' }) {
  const key = TYPE2KEY[media_type];
  if (!key) throw new Error(`invalid media_type ${media_type}`);
  // Everything in the mock catalog is "in the library"; MA reports library items with library:// uris.
  // radio=1: stations are only in the library once favourited through the Search heart (0.6.2, kiosk mock)
  let items = EMPTY ? [] : key === 'radio' && !RADIO_LIB ? CATALOG.radio.filter((i) => i._inlib).map(libView) : CATALOG[key].filter((i) => !i._nolib).map(libView);
  if (favorite) items = items.filter((i) => i.favorite);
  if (s) items = items.filter((i) => i.name.toLowerCase().includes(String(s).toLowerCase()));
  const cmp = {
    name: (a, b) => a.name.localeCompare(b.name), name_desc: (a, b) => b.name.localeCompare(a.name),
    sort_name: (a, b) => a.name.replace(/^the /i, '').localeCompare(b.name.replace(/^the /i, '')),
    timestamp_added_desc: (a, b) => b._added - a._added, timestamp_added: (a, b) => a._added - b._added,
    last_played_desc: (a, b) => (b._played ?? b._added) - (a._played ?? a._added),
    play_count_desc: (a, b) => (b._plays ?? 0) - (a._plays ?? 0) || a.name.localeCompare(b.name),
    play_count: (a, b) => (a._plays ?? 0) - (b._plays ?? 0) || a.name.localeCompare(b.name),
  }[order_by] ?? ((a, b) => a.name.localeCompare(b.name));
  items = [...items].sort(cmp);
  return { items: items.slice(offset, offset + Math.min(500, limit)).map(pub), limit, offset, order_by, media_type };
}

// ---- player state ----
const EVERY = 'media_player.everywhere';
const ROOMS = { 'media_player.living_room': ['Living Room Speaker', 0.45], 'media_player.kitchen': ['Kitchen Speaker', 0.62], 'media_player.garage': ['Garage Speaker', 0.3] };
let qn = 0;
const qItem = (t) => ({ queue_item_id: `${(++qn).toString(16).padStart(4, '0')}a7c1e0b84d2f9e${qn}`, _t: t });
const libTracks = CATALOG.tracks;
const startList = ['So What', 'Teardrop', 'Dreams', 'Get Lucky', 'Hotel California', 'La Femme d\'Argent', 'Come Together', 'Instant Crush', 'The Chain', 'Angel', 'Porcelain', 'Rolling in the Deep', 'Yellow', 'Three Little Birds'];
export const Q = (window.__queue = {
  items: params.get('idle') === '1' ? [] : [libTracks.find((t) => t.name === 'Mockingbird Lane'), ...startList.map((n) => libTracks.find((t) => (t._orig ?? t.name) === n))].map(qItem),
  index: params.get('idle') === '1' ? -1 : 1,
});
/** one queue per MA group entity (Everywhere's is Q / window.__queue; mock-ma adds Indoor and Outdoor) */
const QS = (window.__queues = { 'media_player.everywhere': Q });
const qOf = (id) => QS[id];
const qPub = (q) => ({ queue_item_id: q.queue_item_id, media_title: q._t.name, media_album_name: q._t.album?.name ?? '', media_artist: (q._t.artists ?? []).map((a) => a.name).join(', '),
  media_content_id: q._t.uri, media_image: q._t.image, favorite: !!q._t.favorite });

const states = {};
const st = (id) => states[id];
let afterGroupState = null; // set once the MA mock exists: re-derives a group entity's attributes (live active_queue) after a state change
function setState(id, state, attrs) {
  const old = states[id];
  states[id] = { entity_id: id, state: state ?? old.state, attributes: { ...(old?.attributes ?? {}), ...(attrs ?? {}) }, last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: { id: 'mock' } };
  if (state && old && state !== old.state && afterGroupState) afterGroupState(id);
}
function syncNowPlaying(resetPos = true, EVERY = 'media_player.everywhere') {
  const Q = qOf(EVERY);
  const cur = Q.items[Q.index];
  const e = st(EVERY);
  if (!cur) { setState(EVERY, 'idle', { media_title: undefined, media_artist: undefined, media_album_name: undefined, media_content_id: undefined, entity_picture: undefined, entity_picture_local: undefined, media_duration: undefined, media_position: undefined }); return; }
  const t = cur._t;
  // Like HA + MA: entity_picture is the MA server's absolute image URL (LAN http, blocked/unreachable on the kiosk),
  // entity_picture_local goes through HA's media_player_proxy (here: dev/api/media_player_proxy/ fetch interception).
  const tag = h(t.uri).toString(16);
  setState(EVERY, e?.state === 'idle' || !e ? 'playing' : e.state, {
    media_title: t.name, media_artist: (t.artists ?? []).map((a) => a.name).join(', '), media_album_name: t.album?.name, media_content_id: t.uri, media_content_type: 'music',
    entity_picture: `http://192.168.0.10:8095/imageproxy?path=${tag}&size=512`,
    entity_picture_local: NOART ? undefined : `/api/media_player_proxy/${EVERY}?token=mock&cache=${tag}`,
    media_content_type: t.media_type === 'radio' ? 'radio' : 'music', media_duration: t._duration ?? null,
    ...(resetPos ? { media_position: 0, media_position_updated_at: new Date().toISOString() } : {}),
  });
}
setState(EVERY, params.get('idle') === '1' ? 'idle' : params.get('paused') === '1' ? 'paused' : 'playing', {
  friendly_name: 'Everywhere', group_members: Object.keys(ROOMS), app_id: 'music_assistant', active_queue: 'syncgroup_everywhere',
  volume_level: 0.55, is_volume_muted: false, shuffle: params.get('shuffle') === '1', repeat: params.get('repeat') ?? 'off', supported_features: 4127295, mass_player_type: 'group', mass_player_id: null,
});
syncNowPlaying();
if (st(EVERY).state !== 'idle') setState(EVERY, null, { media_position: 128, media_position_updated_at: new Date(Date.now() - 2000).toISOString() });
for (const [id, [name, v]] of Object.entries(ROOMS))
  setState(id, st(EVERY).state === 'idle' ? 'idle' : 'playing', { friendly_name: name, volume_level: v, is_volume_muted: false, source: 'Music Assistant', supported_features: 152463, mass_player_id: null });
setState('button.everywhere_favorite_current_song', 'unknown', { friendly_name: 'Everywhere Favorite current song' });
const ma = createMa({ params, st, setState, commit: () => commit(), sleep, QS, syncNowPlaying, EVERY, libTracks, qItem });
afterGroupState = (id) => ma.groupStateChanged(id);
// wiim=1 (#94): one speaker HA knows twice, like a WiiM next to Music Assistant. NATIVE: the WiiM integration's own entity (platform wiim,
// no active_queue, no MA queue by its id). MA_WIIM: the Music Assistant entity of the same speaker (same friendly name, own queue,
// player 'wiim_mock_master' in players/all). ORPHAN_WIIM: a native entity Music Assistant has no player for.
const WIIM = params.get('wiim') === '1';
const NATIVE_WIIM = 'media_player.master_bedroom_master_bedroom', MA_WIIM = 'media_player.wiim_sound_lite_aaf2', ORPHAN_WIIM = 'media_player.hall_orphan';
if (WIIM) {
  QS[MA_WIIM] = { items: ['Teardrop', 'Porcelain', 'Angel', 'Dreams', 'Yellow', 'Three Little Birds'].map((n) => qItem(libTracks.find((t) => t.name === n))), index: 1 };
  setState(MA_WIIM, 'playing', { friendly_name: 'Master Bedroom', group_members: [], app_id: 'music_assistant', active_queue: 'wiim_mock_master', mass_player_id: null, mass_player_type: 'player',
    volume_level: 0.35, is_volume_muted: false, shuffle: false, repeat: 'off', supported_features: 152463 });
  syncNowPlaying(true, MA_WIIM);
  const a = st(MA_WIIM).attributes;
  setState(NATIVE_WIIM, 'playing', { friendly_name: 'Master Bedroom', volume_level: 0.35, is_volume_muted: false, media_title: a.media_title, media_artist: a.media_artist, supported_features: 152463 });
  setState(ORPHAN_WIIM, 'idle', { friendly_name: 'Hall Speaker', volume_level: 0.2, is_volume_muted: false, supported_features: 152463 });
}

const listeners = new Set();
export const onHass = (fn) => listeners.add(fn);
function commit() { hass = makeHass(); window.__hass = hass; listeners.forEach((f) => f(hass)); }

function delayFor(name) {
  let ms = mock.latency;
  if (mock.mode === 'inverse') ms = mock.latency * Math.max(1, 6 - name.trim().length);
  return ms + (mock.jitter ? Math.random() * mock.jitter : 0);
}
const ids = (target) => [target?.entity_id].flat().filter(Boolean);
const posNow = (a, s) => (a.media_position ?? 0) + (s === 'playing' && a.media_position_updated_at ? (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : 0);
// 120 unique tracks, for playlist paging
const LONG_DRIVE = Array.from({ length: 120 }, (_, i) => track(`Highway Song ${String(i + 1).padStart(3, '0')}`, ['Eagles', 'Fleetwood Mac', 'Daft Punk', 'Air'][i % 4], 'Long Drive Sessions', 150 + ((i * 37) % 200)));
const tracksFor = (it) => {
  if (!it) return [];
  if (it.media_type === 'track') return [it];
  if (it.media_type === 'album') return libTracks.filter((t) => t.album?.name === it.name);
  if (it.media_type === 'artist') return libTracks.filter((t) => t.artists.some((a) => a.name === it.name));
  if (it.media_type === 'playlist' && (it._orig ?? it.name) === 'Long Drive') return LONG_DRIVE;
  if (it.media_type === 'playlist') return libTracks.filter((_, i) => (h(it.name) + i) % 4 === 0).slice(0, 12);
  if (it.media_type === 'radio') return [it];
  return [];
};

async function callService(domain, service, data = {}, target, notifyOnError, returnResponse) {
  const call = { t: Math.round(performance.now()), domain, service, data: structuredClone(data), target: target ? structuredClone(target) : undefined, returnResponse: !!returnResponse };
  // read-only lyrics fetches go to their own log so the user-action log (__calls) stays exactly as before 0.4.0
  window.__calls.push(call);
  const ctx = { id: 'mock-' + window.__calls.length };
  const needResp = () => { if (!returnResponse) throw new Error(`${domain}.${service} needs return_response`); };
  if (domain === 'music_assistant' && service === 'search') {
    needResp();
    if (data.config_entry_id !== MA_ENTRY) throw new Error(`Config entry ${data.config_entry_id || '(none)'} not found`);
    const ms = delayFor(data.name ?? '');
    await sleep(ms);
    if (mock.fail) throw new Error('mock failure');
    const response = realSample ? structuredClone(realSample) : search(data.name ?? '', data.limit ?? 5, data.media_type, data.artist ?? '', !!data.library_only);
    call.ms = Math.round(ms); call.replyAt = Math.round(performance.now());
    return { context: ctx, response };
  }
  await sleep(30 + Math.random() * 30);
  if (domain === 'music_assistant' && service === 'get_library') {
    needResp();
    if (data.config_entry_id !== MA_ENTRY) throw new Error(`Config entry ${data.config_entry_id || '(none)'} not found`);
    if (params.get('nolib') === '1') throw Object.assign(new Error('Unauthorized'), { code: 'unauthorized' });
    return { context: ctx, response: library(data) };
  }
  if (domain === 'music_assistant' && service === 'get_queue') {
    needResp();
    if (mock.failQueue) throw new Error('queue unavailable');
    const id = ids(target)[0];
    if (!qOf(id)) throw new Error(`${id} is not a Music Assistant player`);
    const Q = qOf(id), E = st(id);
    const cur = Q.items[Q.index];
    return { context: ctx, response: { [id]: { queue_id: E.attributes.active_queue, active: true, name: E.attributes.friendly_name, items: Q.items.length, shuffle_enabled: !!E.attributes.shuffle,
      repeat_mode: E.attributes.repeat, current_index: Q.index < 0 ? null : Q.index, elapsed_time: Math.round(posNow(E.attributes, E.state)),
      current_item: cur ? { queue_item_id: cur.queue_item_id, name: cur._t.name, duration: cur._t._duration, media_item: pub(cur._t) } : null,
      next_item: Q.items[Q.index + 1] ? { queue_item_id: Q.items[Q.index + 1].queue_item_id, name: Q.items[Q.index + 1]._t.name } : null } } };
  }
  if (domain === 'music_assistant' && service === 'play_media') {
    const id = ids(target);
    if (id.length !== 1 || !qOf(id[0])) throw new Error(`play_media: ${id.join(',')} is not a Music Assistant player (only ${Object.keys(QS).join(', ')})`);
    const EVERY = id[0], Q = qOf(EVERY);
    if (!['play', 'replace', 'next', 'replace_next', 'add', undefined].includes(data.enqueue)) throw new Error('invalid enqueue');
    // HA's MA schema: media_type is optional, one of these (MA infers the type from a full uri when it is omitted)
    if (!['artist', 'album', 'audiobook', 'folder', 'playlist', 'podcast', 'track', 'radio', undefined].includes(data.media_type)) throw new Error(`invalid media_type ${data.media_type}`);
    if (data.radio_mode !== undefined && typeof data.radio_mode !== 'boolean') throw new Error('radio_mode must be a boolean');
    await sleep(Number(params.get('playlat') ?? 20)); // a real MA takes a moment to answer play_media
    const uris = [data.media_id].flat();
    let add = uris.flatMap((u) => tracksFor(byUri(u) ?? (realSample ? null : null)));
    if (!add.length) add = [libTracks[h(uris[0]) % libTracks.length]];
    if (data.radio_mode && (data.media_type === 'radio' || uris.some((u) => /:\/\/radio\//.test(u)))) throw new Error('radio_mode is not supported for radio stations');
    if (data.radio_mode) add = [...add, ...libTracks.filter((t) => !add.includes(t)).slice(0, 8)];
    const items = add.map(qItem);
    const at = Q.index + 1;
    if (['play', 'replace', undefined].includes(data.enqueue) && ma.willPlay(EVERY)) ma.afterHa();
    switch (data.enqueue ?? 'play') {
      case 'play': Q.items.splice(at, 0, ...items); Q.index = at; syncNowPlaying(true, EVERY); setState(EVERY, 'playing'); break;
      case 'replace': Q.items = items; Q.index = 0; syncNowPlaying(true, EVERY); setState(EVERY, 'playing'); break;
      case 'next': Q.items.splice(at, 0, ...items); break;
      case 'replace_next': Q.items.splice(at, Q.items.length, ...items); break;
      case 'add': Q.items.push(...items); break;
    }
    commit();
    return { context: ctx };
  }
  if (domain === 'media_player' && (service === 'join' || service === 'unjoin'))
    throw new Error(`media_player.${service}: HA group member ids don't match Music Assistant's speakers; use players/cmd/set_members`);
  if (domain === 'media_player') {
    const tg = ids(target);
    if (!tg.length) throw new Error('no target');
    for (const id of tg) {
      const e = st(id); if (!e) throw new Error(`unknown entity ${id}`);
      const a = e.attributes;
      switch (service) {
        case 'volume_set': setState(id, null, { volume_level: Math.max(0, Math.min(1, +data.volume_level)) }); break;
        case 'volume_mute': setState(id, null, { is_volume_muted: !!data.is_volume_muted }); break;
        case 'media_play': if (ma.willPlay(id)) ma.afterHa(); setState(id, 'playing', { media_position: posNow(a, e.state), media_position_updated_at: new Date().toISOString() }); break;
        case 'media_pause': setState(id, 'paused', { media_position: posNow(a, e.state), media_position_updated_at: new Date().toISOString() }); break;
        case 'media_play_pause': setState(id, e.state === 'playing' ? 'paused' : 'playing'); break;
        case 'media_next_track': { const Q = qOf(id); if (Q && Q.index < Q.items.length - 1) { Q.index++; syncNowPlaying(true, id); } break; }
        case 'media_previous_track': { const Q = qOf(id); if (Q) { if (posNow(a, e.state) < 3 && Q.index > 0) Q.index--; syncNowPlaying(true, id); } break; }
        case 'media_seek': setState(id, null, { media_position: +data.seek_position, media_position_updated_at: new Date().toISOString() }); break;
        case 'shuffle_set': setState(id, null, { shuffle: !!data.shuffle }); break;
        // HA itself accepts 'one'; the card must never send it. ?stickyrepeat=1 ignores repeat_set (MA re-reporting 'one')
        case 'repeat_set': if (!['off', 'all', 'one'].includes(data.repeat)) throw new Error('bad repeat'); if (params.get('stickyrepeat') !== '1') setState(id, null, { repeat: data.repeat }); break;
        default: throw new Error(`mock-hass: unhandled media_player.${service}`);
      }
    }
    commit();
    return { context: ctx };
  }
  if (domain === 'button' && service === 'press') {
    const id = ids(target)[0];
    if (!st(id)) throw new Error(`unknown entity ${id}`);
    const cur = Q.items[Q.index]; if (cur) cur._t.favorite = true;
    setState(id, new Date().toISOString());
    commit();
    return { context: ctx };
  }
  throw new Error(`mock-hass: unhandled ${domain}.${service}`);
}

// ---------------- lyrics (invented text only) ----------------
const LYR = await fixture('ma-lyrics-sample.json').catch(() => ({ lines: ['La la la'] }));
const stamp = (t) => `[${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}]`;
/** invented synced lyrics spanning `dur` seconds: a line every `step` s from `start`, a blank break every 8th line */
function fakeLrc(dur, start = 6, step = 9) {
  const out = ['[ar:Placeholder]', '[ti:Placeholder]'];
  for (let t = start, i = 0; t < dur - 4; t += step, i++) out.push(`${stamp(t)}${i % 8 === 7 ? '' : LYR.lines[i % LYR.lines.length]}`);
  return out.join('\n');
}
const fakePlain = () => LYR.lines.slice(0, 12).join('\n') + '\n\n' + LYR.lines.slice(12).join('\n');
const LYRICS_TABLE = {
  'So What': { via: 'gtl', lrc: () => fakeLrc(562) },
  'Teardrop': { via: 'meta', lrc: () => fakeLrc(330, 4, 7) },
  'Dreams': { via: 'meta', plain: fakePlain },
};
window.__lyricsCalls = () => window.__lyricsLog;
/** sanitized MA item_by_uri shape: placeholder ids, provider apple_music--XXXXXXXX */
function maItem(t) {
  const lyr = LYRNONE ? undefined : LYRICS_TABLE[t._orig ?? t.name];
  return { item_id: String(h(t.uri) % 100000), provider: 'library', name: t.name, version: t.version ?? '', duration: t._duration ?? 0, media_type: 'track', uri: t.uri,
    artists: (t.artists ?? []).map((a) => ({ ...a, item_id: String(h(a.name) % 9000), provider: 'library' })), album: t.album ?? null, favorite: !!t.favorite,
    provider_mappings: [{ item_id: 'XXXXXXXX', provider_domain: 'apple_music', provider_instance: 'apple_music--XXXXXXXX', available: true }],
    metadata: { lyrics: lyr?.via === 'meta' && lyr.plain ? lyr.plain() : null, lrc_lyrics: lyr?.via === 'meta' && lyr.lrc ? lyr.lrc() : null, images: null } };
}
function sendCommand(command, d) {
  switch (command) {
    case 'music/item_by_uri': {
      const t = byUri(d.uri) ?? [...libTracks, ...LONG_DRIVE].find((x) => x.uri === d.uri);
      if (!t) throw new Error(`MediaNotFoundError: ${d.uri}`);
      // like MA's RadioController.get(): the library copy when the station is in the library, else the provider item
      if (t.media_type === 'radio') { window.__itemByUriLog?.push(d.uri); return pub({ ...asLibRadio(t), ...stationDetail(t) }); }
      window.__itemByUriLog?.push(d.uri);
      // v0.7 hearts: like MA's controllers, the library copy (library uri + library item_id) when the item is in the library
      const inLib = t.uri.startsWith('library://') || t._inlib || (t._lib && !t._nolib);
      if (!t.media_type || t.media_type === 'track') {
        const m = maItem(t);
        if (inLib) return { ...m, uri: libUri(t), item_id: libUri(t).split('/').pop() };
        return { ...m, provider: t.provider ?? t.uri.split('://')[0], item_id: t.uri.split('/').pop() };
      }
      return inLib ? pub({ ...libView(t), provider: 'library', item_id: libUri(t).split('/').pop() })
        : pub({ ...t, provider: t.provider ?? t.uri.split('://')[0], item_id: t.uri.split('/').pop() });
    }
    case 'metadata/get_track_lyrics': {
      if (!d.track || typeof d.track !== 'object') throw new Error('track required');
      const lyr = LYRNONE ? undefined : LYRICS_TABLE[d.track.name];
      if (!lyr) return [null, null];
      return [lyr.plain ? lyr.plain() : null, lyr.lrc ? lyr.lrc() : null];
    }
    case 'providers': return structuredClone(DEMO_PROVIDERS);
    case 'music/recently_played_items': {
      if (params.get('recentfail') === '1') throw new Error('mock: recently_played_items failed');
      if (params.get('recent') === 'empty' || params.get('v07') === 'empty') return [];
      const lim = Math.max(1, Math.min(50, Number(d.limit ?? 12)));
      const mix = [
        ...libTracks.slice(0, 4).map(maItem),
        ...(CATALOG.albums ?? []).slice(0, 2).map((x) => pub({ ...x, media_type: x.media_type || 'album' })),
        ...(CATALOG.playlists ?? []).slice(0, 2).map((x) => pub({ ...x, media_type: x.media_type || 'playlist' })),
      ];
      return mix.slice(0, lim);
    }
    case 'music/search': {
      if (Array.isArray(d.providers) && d.providers.length) return providerSearch(d);
      const q = String(d.search_query ?? '').toLowerCase();
      const words = q.split(/\s+-\s+|\s+/).filter(Boolean);
      const tracks = libTracks.filter((t) => { const hay = `${t.name} ${(t.artists ?? []).map((a) => a.name).join(' ')}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
        .slice(0, d.limit ?? 8).map(maItem);
      return { artists: [], albums: [], tracks, playlists: [], radio: [], audiobooks: [], podcasts: [] };
    }
    default: throw new Error(`mock-hass: unhandled send_command ${command}`);
  }
}
/** test hook: pretend a radio station (or anything else) is now playing artist/title */
/** tests: change attributes of one entity and push a new hass (e.g. a player reporting repeat 'one' again) */
window.__setAttrs = (id, attrs, state = null) => { setState(id, state, attrs); commit(); };
window.__setNowPlaying = ({ artist = '', title = '', radio = true, uri, duration = null, position = 0 } = {}) => {
  setState(EVERY, 'playing', { media_title: title, media_artist: artist, media_album_name: radio ? 'Mock Radio FM' : '', media_content_id: uri ?? (radio ? 'library://radio/7' : undefined),
    media_content_type: radio ? 'radio' : 'music', media_duration: duration, media_position: position, media_position_updated_at: new Date().toISOString() });
  commit();
};

/** test hook: play a catalog track by name (non-radio, real uri/duration) */
window.__playTrack = (name, position = 60) => {
  const t = libTracks.find((x) => x.name === name);
  if (!t) throw new Error('no track ' + name);
  window.__setNowPlaying({ artist: (t.artists ?? []).map((a) => a.name).join(', '), title: t.name, radio: false, uri: t.uri, duration: t._duration ?? 0, position });
};

const USER = { ...(params.get('uid') ? { id: params.get('uid') } : {}), name: params.get('user') ?? 'Kiosk', is_admin: params.get('admin') === '1' };
// The jukebox_kiosk integration is loaded (dev/mock-kiosk.js), as in every real install; the card's backend: auto picks it.
// kiosk=0: core Music Assistant only (the card's native backend).
const kiosk = params.get('kiosk') !== '0' ? createKiosk({ DEMO_PROVIDERS, params, maApi: ma, QS, st, qPub, sendCommand, maItem, byUri, tracksFor, commit: () => commit(), sleep, catalog: CATALOG, user: USER }) : null;
/** entity registry display entries, like hass.entities: every MA player on its own device, plus Everywhere's MA favorite button */
function registry() {
  const out = {};
  for (const id of Object.keys(states)) {
    if (id.startsWith('media_player.')) out[id] = { entity_id: id, device_id: 'dev_' + id.slice(13), platform: WIIM && (id === NATIVE_WIIM || id === ORPHAN_WIIM) ? 'wiim' : 'music_assistant' };
    if (id === 'button.everywhere_favorite_current_song') out[id] = { entity_id: id, device_id: 'dev_everywhere', platform: 'music_assistant', translation_key: 'favorite_now_playing' };
  }
  return out;
}
/** without the integration: HA's own config_entries/get (admins only), the native backend's way to find the entry */
async function coreWS(msg) {
  if (msg.type !== 'config_entries/get') throw Object.assign(new Error(`Unknown command ${msg.type}`), { code: 'unknown_command' });
  if (!USER.is_admin) throw Object.assign(new Error('Unauthorized'), { code: 'unauthorized' });
  return msg.domain === 'music_assistant' ? [{ entry_id: MA_ENTRY, domain: 'music_assistant', state: 'loaded', title: 'Music Assistant' }] : [];
}
function makeHass() {
  return { states: { ...states }, entities: registry(), ...(kiosk ? {} : { callWS: coreWS }), user: USER, locale: { language: 'en-US' }, language: 'en-US', callService, ...(kiosk ? kiosk.extras : {}) };
}
export let hass = makeHass();
window.__hass = hass;
