import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatDuration,
  renderTrackPage,
  type TrackPageInput,
} from '../src/track-page.js';

const AUDIO = 'c'.repeat(64);
const input = (extra: Partial<TrackPageInput> = {}): TrackPageInput => ({
  pieceId: 'the-river-forgets-to-answer',
  pieceTitle: 'The River Forgets to Answer',
  track: {
    id: 'first-light',
    title: 'First Light',
    seed: 'ox-bow',
    bars: 40,
    audio: `sha256:${AUDIO}`,
    frames: 6_432_000,
  },
  label: 'v1',
  credits: [
    { name: 'A. Composer', role: 'composition' },
    { name: 'B. Player', role: 'viola' },
  ],
  ...extra,
});
const head = (html: string) => html.slice(0, html.indexOf('</head>'));
const body = (html: string) => html.slice(html.indexOf('<body>'));
const metaContent = (html: string, property: string) =>
  new RegExp(`<meta property="${property}" content="([^"]*)"`).exec(html)?.[1];

describe('track page', () => {
  it('shows the details', () => {
    const b = body(renderTrackPage(input()));
    for (const text of [
      'First Light',
      'The River Forgets to Answer',
      'v1',
      'ox-bow',
      '40 bars',
      '2:14',
    ]) {
      expect(b).toContain(text);
    }
  });

  it('lists credits in order as name and role', () => {
    const b = body(renderTrackPage(input()));
    expect(b.indexOf('A. Composer')).toBeLessThan(b.indexOf('composition'));
    expect(b.indexOf('composition')).toBeLessThan(b.indexOf('B. Player'));
    expect(b.indexOf('B. Player')).toBeLessThan(b.indexOf('viola'));
  });

  it('leaves out the credits heading when there are none', () => {
    expect(renderTrackPage(input({ credits: [] }))).not.toContain('Credits');
  });

  it('shows markup in a title as text', () => {
    const html = renderTrackPage(input({ track: { ...input().track, title: '<b>Loud</b>' } }));
    expect(html).toContain('&lt;b&gt;Loud&lt;/b&gt;');
    expect(html).not.toMatch(/<b[\s>]/);
  });

  it('escapes every value from the release file and manifest', () => {
    const evil = '"><script>x</script>';
    const html = renderTrackPage(
      input({
        pieceTitle: evil,
        track: { ...input().track, seed: evil },
        credits: [{ name: evil, role: evil }],
        label: 'v1',
      }),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('"><');
  });

  it('has one audio element with controls, metadata preload and the FLAC, and no script', () => {
    const html = renderTrackPage(input());
    expect(html.match(/<audio/g)).toHaveLength(1);
    expect(html).toContain('<audio controls preload="metadata">');
    expect(html).toContain(`<source src="/stems/${AUDIO}.flac" type="audio/flac" />`);
    expect(html).not.toMatch(/<script/i);
  });

  it('offers the download named for the track and says what it is', () => {
    const html = renderTrackPage(input());
    expect(html).toContain(
      `<a href="/stems/${AUDIO}.flac" download="the-river-forgets-to-answer--first-light.flac">`,
    );
    expect(html).toContain('24-bit, 48 kHz FLAC');
  });

  it('links to the live piece at the same version, seed and bars', () => {
    const html = renderTrackPage(input());
    const href = /<a href="(\/\?[^"]*)"/.exec(html)![1]!.replace(/&amp;/g, '&');
    const q = new URLSearchParams(href.slice(2));
    expect(Object.fromEntries(q)).toEqual({
      piece: 'the-river-forgets-to-answer',
      version: 'v1',
      seed: 'ox-bow',
      bars: '40',
    });
    expect(body(html)).toContain('plays differently every time');
  });

  it('encodes an awkward seed in the live link', () => {
    const html = renderTrackPage(input({ track: { ...input().track, seed: 'a b&c' } }));
    const href = /<a href="(\/\?[^"]*)"/.exec(html)![1]!.replace(/&amp;/g, '&');
    expect(new URLSearchParams(href.slice(2)).get('seed')).toBe('a b&c');
  });

  it('has the share tags with an origin', () => {
    const h = head(renderTrackPage(input({ origin: 'https://example.test' })));
    expect(h).toContain('<title>First Light · The River Forgets to Answer · Spite Store</title>');
    expect(h).toMatch(/<meta name="description" content="[^"]+"/);
    expect(metaContent(h, 'og:title')).toBe('First Light · The River Forgets to Answer');
    expect(metaContent(h, 'og:description')).toBeTruthy();
    expect(metaContent(h, 'og:type')).toBe('music.song');
    expect(metaContent(h, 'og:url')).toBe(
      'https://example.test/pieces/the-river-forgets-to-answer/tracks/first-light/',
    );
    expect(metaContent(h, 'og:audio')).toBe(`https://example.test/stems/${AUDIO}.flac`);
  });

  it('leaves out og:url and og:audio without an origin, keeping the other tags', () => {
    const h = head(renderTrackPage(input()));
    expect(metaContent(h, 'og:url')).toBeUndefined();
    expect(metaContent(h, 'og:audio')).toBeUndefined();
    for (const p of ['og:title', 'og:description', 'og:type'])
      expect(metaContent(h, p)).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(renderTrackPage(input())).toBe(renderTrackPage(input()));
  });
});

describe('helpers', () => {
  it('escapes the five HTML characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
  it('formats m:ss, rounded down', () => {
    expect(formatDuration(6_432_000)).toBe('2:14');
    expect(formatDuration(47_999)).toBe('0:00');
  });
});
