// 0.7.12 a8: More Info lines for songs, podcast episodes and audiobooks (songInfo / hasMoreInfo).
// Bundled on the fly; no browser. Usage: node test/unit/song-info.unit.mjs
import { rollup } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import { mkdirSync } from 'node:fs';

const OUT = new URL('../tmp/unit-song-info/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const bundle = await rollup({
  onwarn: (w, def) => { if (w.code !== 'THIS_IS_UNDEFINED') def(w); },
  input: ['src/song-info.ts'],
  plugins: [resolve({ exportConditions: ['node'] }), typescript({ tsconfig: './tsconfig.json', outDir: OUT, noEmitOnError: true })],
});
await bundle.write({ dir: OUT, format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name]-[hash].mjs' });
await bundle.close();

const S = await import(OUT + 'song-info.mjs');
let failures = 0, total = 0;
function check(name, ok, info = '') { total++; if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && info ? '  — ' + info : ''}`); }
const J = JSON.stringify;
const keys = (l) => l.map((x) => x.k);
const vals = (l) => Object.fromEntries(l.map((x) => [x.k, x.v]));

const af = { content_type: 'flac', sample_rate: 44100, bit_depth: 16 };
const song = {
  media_type: 'track', name: 'Hotel California', uri: 'library://track/1', duration: 391,
  album: { name: 'Hotel California', year: 1976 }, year: 1976,
  provider_mappings: [{ provider_domain: 'apple_music', audio_format: af }],
};

{
  const l = S.songInfo(song);
  check('song lines and order: Album, Year, Length, Source, Quality', J(keys(l)) === J(['album', 'year', 'length', 'source', 'quality']), J(keys(l)));
  check('song values unchanged', vals(l).album === 'Hotel California' && vals(l).year === '1976' && vals(l).length === '6:31'
    && vals(l).source === 'Apple Music' && /FLAC/.test(vals(l).quality), J(vals(l)));
  check('song hasMoreInfo true', S.hasMoreInfo(l) === true);
}

{
  const ep = {
    media_type: 'podcast_episode', name: 'Placeholder Pod #3', uri: 'library://podcast_episode/901',
    duration: 1800, resume_position_ms: 1_200_000, fully_played: false, position: 3,
    podcast: { media_type: 'podcast', name: 'The Mockcast', uri: 'library://podcast/31' },
    metadata: { release_date: '2026-11-01' },
    provider_mappings: [{ provider_domain: 'podcastfeed', audio_format: { content_type: 'mp3', bit_rate: 128 } }],
  };
  const l = S.songInfo(ep);
  check('episode lines and order: Show, Episode, Published, Length, Left, Source, Quality',
    J(keys(l)) === J(['show', 'episode', 'published', 'length', 'left', 'source', 'quality']), J(keys(l)));
  check('episode values', vals(l).show === 'The Mockcast' && vals(l).episode === '3' && vals(l).published === 'Nov 1, 2026'
    && vals(l).length === '30:00' && vals(l).left === '10:00' && vals(l).source === 'Podcastfeed' && /MP3/.test(vals(l).quality), J(vals(l)));
}

{
  const book = {
    media_type: 'audiobook', name: 'The Mock Chronicles', uri: 'library://audiobook/7',
    duration: 36000, resume_position_ms: 12_600_000, fully_played: false,
    authors: ['A. N. Author', { name: 'B. Coauthor' }], narrators: [{ name: 'R. Reader' }],
    publisher: 'Mock Press', metadata: { release_date: '2024-03-15' },
    provider_mappings: [{ provider_domain: 'audible', audio_format: { content_type: 'mp3', bit_rate: 64 } }],
  };
  const l = S.songInfo(book);
  check('audiobook lines and order: Author, Narrator, Publisher, Published, Length, Left, Source, Quality',
    J(keys(l)) === J(['author', 'narrator', 'publisher', 'published', 'length', 'left', 'source', 'quality']), J(keys(l)));
  check('audiobook values', vals(l).author === 'A. N. Author, B. Coauthor' && vals(l).narrator === 'R. Reader'
    && vals(l).publisher === 'Mock Press' && vals(l).published === 'Mar 15, 2024'
    && vals(l).length === '10:00:00' && vals(l).left === '6:30:00' && vals(l).source === 'Audible', J(vals(l)));
}

{
  const played = S.songInfo({ media_type: 'podcast_episode', name: 'Done', uri: 'x://e/1', duration: 1800, fully_played: true, resume_position_ms: 1_800_000, position: 1, podcast: { name: 'Show' } });
  check('Left is Played when fully_played', vals(played).left === 'Played', J(vals(played)));
  const progress = S.songInfo({ media_type: 'audiobook', name: 'Mid', uri: 'x://a/1', duration: 1000, resume_position_ms: 250_000, fully_played: false, authors: ['A'] });
  check('Left is remaining time when in progress', vals(progress).left === '12:30', J(vals(progress)));
  const hidden = S.songInfo({ media_type: 'podcast_episode', name: 'Fresh', uri: 'x://e/2', duration: 1800, position: 1, podcast: { name: 'Show' } });
  check('Left hidden when not in progress and not fully_played', !('left' in vals(hidden)), J(vals(hidden)));
}

{
  const empty = S.songInfo({
    media_type: 'podcast_episode', name: 'Sparse', uri: 'x://e/3', duration: 0, position: 0,
    podcast: { name: '' }, metadata: {}, provider_mappings: [{ provider_domain: 'podcastfeed' }],
  });
  check('empty lines dropped (only Source when that is all)', J(keys(empty)) === J(['source']) && vals(empty).source === 'Podcastfeed', J(empty));
  check('grayed / hasMoreInfo false when only Source has data', S.hasMoreInfo(empty) === false);
  const none = S.songInfo({ media_type: 'audiobook', name: 'Bare', uri: 'x://a/2' });
  check('all-empty audiobook → no lines; hasMoreInfo false', none.length === 0 && S.hasMoreInfo(none) === false, J(none));
}

{
  const wrapped = S.songInfo({
    media_title: 'Q Ep', duration: 600, media_item: {
      media_type: 'podcast_episode', name: 'Q Ep', duration: 600, position: 5,
      podcast: { name: 'Wrapped Show' }, resume_position_ms: 120_000, fully_played: false,
      metadata: { release_date: '2025-01-02' },
    },
  });
  check('queue wrapper uses media_item fields', vals(wrapped).show === 'Wrapped Show' && vals(wrapped).episode === '5'
    && vals(wrapped).left === '8:00' && vals(wrapped).published === 'Jan 2, 2025', J(vals(wrapped)));
}

check('INFO_TYPES still lists track, podcast_episode, audiobook', J(S.INFO_TYPES) === J(['track', 'podcast_episode', 'audiobook']));

console.log(`\n${total - failures}/${total} song-info checks passed`);
process.exit(failures ? 1 : 0);
