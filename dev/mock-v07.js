// v0.7 mock data for the dev harness (?kiosk=1): genres, a Radio Browser tree and MA recommendation rows.
// Shapes follow MA 2.10.9 (music/genres/overview + /tracks, music/browse radiobrowser://..., music/recommendations + /items).
// PLACEHOLDER DATA ONLY: invented genre / station / tag names, fake ids, no real station uuids.
// URL params: v07=empty (no genres, empty rows, empty radio tree, empty recently played), rbfail=1 (music/browse throws),
// recfail=1 (music/recommendations throws), rowfail=<row id> (that row's items throw),
// recentfail=1 (music/recently_played_items throws; recommendations fallback still works),
// recent=empty (recently_played_items returns []), v07lat=<ms> (latency, default 60).

const GENRES = ['Rock', 'Jazz', 'Electronic', 'Soul', 'Classical', 'Mock Folk', 'Ambient', 'Blues'];
const svgArt = (label, hue) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue},45%,28%)"/><text x="50" y="58" font-family="sans-serif" font-size="18" fill="#fff" text-anchor="middle">${label.slice(0, 10)}</text></svg>`)}`;
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

const COUNTRIES = ['us', 'ca', 'gb', 'de', 'fr', 'es', 'it', 'nl', 'se', 'jp', 'br', 'au', 'mx', 'ie', 'no'];
const LANGUAGES = ['english', 'spanish', 'german', 'french', 'italian', 'dutch', 'japanese', 'portuguese'];
const TAGS = ['pop', 'rock', 'jazz', 'news', 'talk', 'classical', 'dance', 'chillout', 'oldies', 'country', 'blues', 'ambient', 'soul', 'lounge', 'sports', 'indie'];
const STATION_WORDS = ['Mock', 'Placeholder', 'Sample', 'Demo', 'Test', 'Example'];
const station = (seed, i, label) => {
  const n = hash(`${seed}:${i}`);
  const name = `${STATION_WORDS[n % STATION_WORDS.length]} ${label} ${['FM', 'Radio', 'Live', 'One', 'Wave'][n % 5]}`;
  return { media_type: 'radio', provider: 'radiobrowser', item_id: `00000000-0000-0000-0000-${String(n % 1e12).padStart(12, '0')}`,
    uri: `radiobrowser://radio/00000000-0000-0000-0000-${String(n % 1e12).padStart(12, '0')}`, name: i % 4 === 0 ? `\t${name}` : name,
    image: i % 3 === 2 ? null : svgArt(label, n % 360), favorite: false, metadata: { description: `Placeholder station (${label})` } };
};
const folder = (name, path, image = null) => ({ media_type: 'folder', item_id: path.split('/').pop(), provider: 'radiobrowser', name, path, uri: path, image, is_playable: false });
const up = (path) => folder('..', path.slice(0, path.lastIndexOf('/')) || 'radiobrowser://');
const regionName = (cc) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()); } catch { return cc.toUpperCase(); } };
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());

/** 0.7.2: MA music/browse <instance_id>:// for the demo providers (Apple Music has folders; TuneIn has none: the card shows "Type to search") */
function providerBrowse(id, sub) {
  const dom = id.split('--')[0];
  if (dom === 'tunein') return [];
  const f = (name, p) => ({ media_type: 'folder', item_id: p, provider: id, name, path: `${id}://${p}`, uri: `${id}://${p}`, image: null, is_playable: false });
  if (!sub) return [f('Artists', 'artists'), f('Albums', 'albums'), f('Playlists', 'playlists'), f('Tracks', 'tracks')];
  if (sub === 'playlists') return [f('..', ''), ...['Morning Mix', 'Placeholder Hits', 'Demo Chill', 'Sample Workout'].map((n, i) => ({ media_type: 'playlist', provider: id, item_id: `p${i}`, uri: `${id}://playlist/p${i}`, name: n, image: svgArt(n, (i * 70) % 360) }))];
  return [f('..', '')];
}
export function createV07({ params, catalog, sleep }) {
  const EMPTY = params.get('v07') === 'empty';
  const lat = Number(params.get('v07lat') ?? 60);
  const all = () => ['artists', 'albums', 'tracks', 'playlists', 'radio', 'podcasts', 'audiobooks'].flatMap((k) => catalog[k] ?? []);
  const pub = (it) => JSON.parse(JSON.stringify(it, (k, v) => (k.startsWith('_') ? undefined : v)));
  const genreItems = EMPTY ? [] : GENRES.map((name, i) => ({ media_type: 'genre', provider: 'library', item_id: String(i + 1), uri: `library://genre/${i + 1}`, name, favorite: false, image: null }));
  const inGenre = (gid, list) => list.filter((it) => hash(`${it.name}`) % GENRES.length === (Number(gid) - 1) % GENRES.length || Number(gid) === 1);

  function browse(path) {
    if (params.get('rbfail') === '1') throw new Error('mock: Radio Browser unavailable');
    if (EMPTY) return path === 'radiobrowser://' ? [] : [up(path)];
    const pm = /^([a-z_]+--demo\d{4}):\/\/(.*)$/.exec(path);
    if (pm) return providerBrowse(pm[1], pm[2]);
    const P = 'radiobrowser://';
    if (path === P) return [folder('Popularity', `${P}popularity`), folder('Category', `${P}category`)];
    if (path === `${P}popularity`) return [up(path), folder('Popular', `${P}popularity/popular`), folder('Votes', `${P}popularity/votes`)];
    if (path === `${P}category`) return [up(path), ...['country', 'language', 'tag'].map((c) => folder(cap(c), `${P}category/${c}`))];
    if (path === `${P}popularity/popular` || path === `${P}popularity/votes`) return [up(path), ...Array.from({ length: 24 }, (_, i) => station(path, i, ['Hits', 'Jazz', 'News', 'Chill', 'Rock', 'Talk'][i % 6]))];
    if (path === `${P}category/country`) return [up(path), ...COUNTRIES.map((cc) => folder(regionName(cc), `${path}/${cc}`))];
    if (path === `${P}category/language`) return [up(path), ...LANGUAGES.map((l) => folder(cap(l), `${path}/${l}`))];
    if (path === `${P}category/tag`) return [up(path), ...TAGS.map((t) => folder(t, `${path}/${t}`))];
    const m = /^radiobrowser:\/\/category\/(country|language|tag)\/([^/]+)$/.exec(path);
    if (m) {
      const label = m[1] === 'country' ? m[2].toUpperCase() : cap(decodeURIComponent(m[2]));
      return [up(path), ...Array.from({ length: m[2] === 'xx' ? 0 : 18 }, (_, i) => station(path, i, label))];
    }
    throw new Error(`MediaNotFoundError: ${path}`);
  }

  const ROWS = [
    ['in_progress', 'In progress'], ['recently_played', 'Recently played'], ['recently_added_tracks', 'Recently added tracks'],
    ['recently_added_albums', 'Recently added albums'], ['random_artists', 'Random artists'], ['random_albums', 'Random albums'],
    ['favorite_playlists', 'Favorite playlists'], ['favorite_radio', 'Favorite radio'], ['most_played_tracks', 'Most played tracks'],
    ['never_played_tracks', 'Never played tracks'],
  ];
  function rowItems(id) {
    if (EMPTY) return [];
    const c = catalog;
    switch (id) {
      case 'in_progress': return [
        ...(c.audiobooks ?? []).map((a) => ({ ...pub(a), duration: 36000, resume_position_ms: 12_600_000, fully_played: false })),
        { media_type: 'podcast_episode', provider: 'library', item_id: '901', uri: 'library://podcast_episode/901', name: 'Placeholder Pod #3', image: null, duration: 1800, resume_position_ms: 1_200_000, fully_played: false },
        { media_type: 'podcast_episode', provider: 'library', item_id: '902', uri: 'library://podcast_episode/902', name: 'Placeholder Pod #2', image: null, duration: 2400, resume_position_ms: 300_000, fully_played: false },
      ];
      case 'recently_played': return c.tracks.slice(0, 14).map(pub);
      case 'recently_added_tracks': return c.tracks.slice(-12).map(pub);
      case 'recently_added_albums': return c.albums.slice(0, 12).map(pub);
      case 'random_artists': return c.artists.slice(2, 14).map(pub);
      case 'random_albums': return [...c.albums].reverse().slice(0, 12).map(pub);
      case 'favorite_playlists': return c.playlists.filter((p) => p.favorite).map(pub);
      case 'favorite_radio': return Array.from({ length: 8 }, (_, i) => station('fav', i, ['Hits', 'Jazz', 'News', 'Chill'][i % 4]));
      case 'most_played_tracks': return c.tracks.slice(5, 20).map(pub);
      case 'never_played_tracks': return [];
      default: throw new Error(`mock: unknown recommendation row ${id}`);
    }
  }
  const asFolder = ([id, name], provider = 'recommendations') => ({ media_type: 'folder', item_id: id, provider, name, path: '', uri: `${provider}://folder/${id}`, items: [], subtitle: null, translation_key: id, icon: null });

  async function handle(command, args) {
    await sleep(lat);
    switch (command) {
      case 'music/browse': return browse(String(args.path ?? ''));
      case 'music/recently_played_items': {
        if (params.get('recentfail') === '1') throw new Error('mock: recently_played_items failed');
        if (EMPTY || params.get('recent') === 'empty') return [];
        const lim = Math.max(1, Math.min(50, Number(args.limit ?? 12)));
        // Mix of tracks, albums, playlists and radio (placeholder names only)
        const mix = [
          ...(catalog.tracks ?? []).slice(0, 4),
          ...(catalog.albums ?? []).slice(0, 2),
          ...(catalog.playlists ?? []).slice(0, 2),
          ...Array.from({ length: 2 }, (_, i) => station('recent', i, ['Hits', 'Jazz'][i % 2])),
        ].map(pub);
        return mix.slice(0, lim);
      }
      case 'music/recommendations':
        if (params.get('recfail') === '1') throw new Error('mock: recommendations failed');
        return [...ROWS.map((r) => asFolder(r)), asFolder(['stations_for_you', 'Stations for you'], 'mock_stream--XXXXXXXX')];
      case 'music/recommendations/items': {
        if (params.get('rowfail') === args.item_id) throw new Error(`mock: row ${args.item_id} failed`);
        if (args.provider === 'mock_stream--XXXXXXXX') return Array.from({ length: 6 }, (_, i) => station('sfy', i, 'For You'));
        return rowItems(String(args.item_id));
      }
      case 'music/genres/overview': {
        const gid = String(args.item_id ?? '');
        if (!genreItems.some((g) => g.item_id === gid)) throw new Error(`MediaNotFoundError: genre ${gid}`);
        const lim = Number(args.limit ?? 12);
        const f = (key, name, list) => ({ media_type: 'folder', item_id: `genre_${key}`, provider: 'library', name, path: '', items: inGenre(gid, list).slice(0, lim).map(pub) });
        if (gid === String(GENRES.indexOf('Mock Folk') + 1)) return [f('artists', 'Artists', []), f('albums', 'Albums', []), f('tracks', 'Tracks', [])];
        return [f('artists', 'Artists', catalog.artists), f('albums', 'Albums', catalog.albums), f('tracks', 'Tracks', catalog.tracks), f('playlists', 'Playlists', catalog.playlists)];
      }
      case 'music/genres/library_items': {
        const off = Number(args.offset ?? 0), lim = Number(args.limit ?? 25), q = String(args.search ?? '').toLowerCase();
        let list = genreItems.filter((g) => !q || g.name.toLowerCase().includes(q));
        if (args.hide_empty) list = list.filter((g) => g.name !== 'Mock Folk');
        list = [...list].sort((a, b) => (args.order_by === 'timestamp_added_desc' ? Number(b.item_id) - Number(a.item_id) : a.name.localeCompare(b.name)));
        return list.slice(off, off + lim);
      }
      case 'music/genres/tracks': {
        const gid = String(args.item_id ?? ''), off = Number(args.offset ?? 0), lim = Number(args.limit ?? 100);
        const list = inGenre(gid, catalog.tracks);
        return list.slice(off, off + lim).map(pub);
      }
      case 'music/search': {
        // only the genre part (the card asks for media_types ['genre'] separately)
        const q = String(args.search_query ?? '').trim().toLowerCase();
        return { genres: genreItems.filter((g) => g.name.toLowerCase().includes(q)).slice(0, Number(args.limit ?? 25)),
          artists: [], albums: [], tracks: [], playlists: [], radio: [], audiobooks: [], podcasts: [] };
      }
      default: throw new Error(`mock-v07: unhandled ${command}`);
    }
  }
  return { handle, genres: genreItems, all };
}
