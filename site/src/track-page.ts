/**
 * A track's page: plain static HTML with no script, rendered by the same function for the build
 * and the dev server. Every value from a release file or manifest goes through `escapeHtml`.
 */

export interface PageTrack {
  id: string;
  title: string;
  seed: string;
  bars: number;
  /** `sha256:<hex>` of the track's FLAC. */
  audio: string;
  frames: number;
}

export interface TrackPageInput {
  pieceId: string;
  /** From the piece's working manifest. */
  pieceTitle: string;
  track: PageTrack;
  /** The label of the track's version in versions.json. */
  label: string;
  credits: readonly { name: string; role: string }[];
  /** The site's absolute origin, e.g. `https://example.test`, for share metadata; none in dev. */
  origin?: string;
}

const SAMPLE_RATE = 48_000;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `m:ss`, rounded down, for a length in frames at 48 kHz. */
export function formatDuration(frames: number): string {
  const seconds = Math.floor(frames / SAMPLE_RATE);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The page's path, `/pieces/<piece-id>/tracks/<track-id>/`. */
export const trackPath = (pieceId: string, trackId: string) =>
  `/pieces/${pieceId}/tracks/${trackId}/`;

export function renderTrackPage(input: TrackPageInput): string {
  const { pieceId, pieceTitle, track, label, credits, origin } = input;
  const e = escapeHtml;
  const length = formatDuration(track.frames);
  const audioPath = `/stems/${track.audio.slice('sha256:'.length)}.flac`;
  const fileName = `${pieceId}--${track.id}.flac`;
  const live =
    '/?' +
    new URLSearchParams({
      piece: pieceId,
      version: label,
      seed: track.seed,
      bars: String(track.bars),
    }).toString();
  const title = `${track.title} · ${pieceTitle} · Spite Store`;
  const description = `${track.title}: a ${length} performance of ${pieceTitle} (version ${label}, seed ${track.seed}, ${track.bars} bars), free to download from Spite Store.`;
  const meta = (property: string, content: string) =>
    `    <meta property="${property}" content="${e(content)}" />`;
  const head = [
    `    <title>${e(title)}</title>`,
    `    <meta name="description" content="${e(description)}" />`,
    meta('og:title', `${track.title} · ${pieceTitle}`),
    meta('og:description', description),
    meta('og:type', 'music.song'),
    meta('og:site_name', 'Spite Store'),
  ];
  if (origin) {
    const base = origin.replace(/\/+$/, '');
    head.push(meta('og:url', `${base}${trackPath(pieceId, track.id)}`));
    head.push(meta('og:audio', `${base}${audioPath}`));
    head.push(meta('og:audio:type', 'audio/flac'));
  }
  const creditList =
    credits.length === 0
      ? ''
      : `
    <h2>Credits</h2>
    <ul class="credits">
${credits.map((c) => `      <li><span class="name">${e(c.name)}</span> <span class="role">${e(c.role)}</span></li>`).join('\n')}
    </ul>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
${head.join('\n')}
    <style>
      body {
        font: 15px system-ui, sans-serif;
        max-width: 640px;
        margin: 40px auto;
        padding: 0 16px;
        color: #222;
        background: #fff;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 4px;
      }
      h2 {
        font-size: 15px;
        margin: 28px 0 8px;
      }
      p {
        color: #666;
        margin: 0 0 20px;
      }
      a {
        color: inherit;
      }
      dl {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: 4px 16px;
        margin: 0 0 20px;
      }
      dt {
        color: #666;
      }
      dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      audio {
        width: 100%;
        margin: 0 0 12px;
      }
      .credits {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .credits li {
        margin: 0 0 4px;
      }
      .role {
        color: #666;
      }
    </style>
  </head>
  <body>
    <h1>${e(track.title)}</h1>
    <p>${e(pieceTitle)}</p>
    <dl>
      <dt>Version</dt>
      <dd>${e(label)}</dd>
      <dt>Seed</dt>
      <dd>${e(track.seed)}</dd>
      <dt>Length</dt>
      <dd>${track.bars} bars · ${length}</dd>
    </dl>
    <audio controls preload="metadata">
      <source src="${e(audioPath)}" type="audio/flac" />
    </audio>
    <p>
      <a href="${e(audioPath)}" download="${e(fileName)}">Download</a>
      (24-bit, 48 kHz FLAC)
    </p>
    <h2>Hear it play live</h2>
    <p>
      ${e(pieceTitle)} plays differently every time.
      <a href="${e(live)}">This link starts the live piece from this track's performance</a>,
      and reroll goes on from there.
    </p>${creditList}
  </body>
</html>
`;
}
