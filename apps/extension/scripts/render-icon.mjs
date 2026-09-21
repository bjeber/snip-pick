/**
 * Renders media/icon.svg to media/icon.png at 128x128.
 *
 * VS Code Marketplace requires a PNG icon, but the source of truth should stay the SVG. Rather
 * than pull in a rendering dependency, this script rasterizes the small subset of SVG the icon
 * uses: `<rect rx>`, `<line stroke-linecap="round">` and stroked `<circle>`. If you add another
 * kind of shape to the SVG, teach this script about it (or render with `rsvg-convert -w 128 -h
 * 128 media/icon.svg -o media/icon.png`, which produces the same thing).
 */
import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 128;
const SAMPLES = 4; // per axis, so 16 samples per pixel

function attributes(tag) {
  const out = {};
  for (const [, key, value] of tag.matchAll(/([a-zA-Z][a-zA-Z0-9-]*)="([^"]*)"/g)) out[key] = value;
  return out;
}

function colour(value) {
  if (!value || value === 'none') return undefined;
  const hex = value.replace('#', '');
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

const number = (value, fallback = 0) => (value === undefined ? fallback : Number(value));

/** Distance from a point to a segment; the basis for round-capped strokes. */
function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function parseShapes(svg) {
  const shapes = [];
  for (const [tag] of svg.matchAll(/<(rect|line|circle)\b[^>]*>/g)) {
    const attrs = attributes(tag);
    if (tag.startsWith('<rect')) {
      const [x, y, w, h, r] = [
        number(attrs.x),
        number(attrs.y),
        number(attrs.width),
        number(attrs.height),
        number(attrs.rx),
      ];
      const fill = colour(attrs.fill);
      if (!fill) continue;
      shapes.push({
        colour: fill,
        inside: (px, py) => {
          if (px < x || py < y || px > x + w || py > y + h) return false;
          const cx = Math.min(Math.max(px, x + r), x + w - r);
          const cy = Math.min(Math.max(py, y + r), y + h - r);
          return Math.hypot(px - cx, py - cy) <= r;
        },
      });
    } else if (tag.startsWith('<line')) {
      const stroke = colour(attrs.stroke);
      if (!stroke) continue;
      const half = number(attrs['stroke-width'], 1) / 2;
      const [x1, y1, x2, y2] = [
        number(attrs.x1),
        number(attrs.y1),
        number(attrs.x2),
        number(attrs.y2),
      ];
      shapes.push({
        colour: stroke,
        inside: (px, py) => distanceToSegment(px, py, x1, y1, x2, y2) <= half,
      });
    } else {
      const stroke = colour(attrs.stroke);
      if (!stroke) continue;
      const half = number(attrs['stroke-width'], 1) / 2;
      const [cx, cy, r] = [number(attrs.cx), number(attrs.cy), number(attrs.r)];
      shapes.push({
        colour: stroke,
        inside: (px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= half,
      });
    }
  }
  return shapes;
}

function render(shapes) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const step = 1 / SAMPLES;
  const offset = step / 2;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = x + offset + sx * step;
          const py = y + offset + sy * step;
          let hit;
          for (const shape of shapes) if (shape.inside(px, py)) hit = shape.colour;
          if (!hit) continue;
          r += hit[0];
          g += hit[1];
          b += hit[2];
          a += 255;
        }
      }
      const total = SAMPLES * SAMPLES;
      const index = (y * SIZE + x) * 4;
      const covered = a / 255;
      pixels[index] = covered === 0 ? 0 : Math.round(r / covered);
      pixels[index + 1] = covered === 0 ? 0 : Math.round(g / covered);
      pixels[index + 2] = covered === 0 ? 0 : Math.round(b / covered);
      pixels[index + 3] = Math.round(a / total);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function toPng(pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y += 1) {
    raw[y * (SIZE * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const svg = readFileSync(join(ROOT, 'media', 'icon.svg'), 'utf8');
const png = toPng(render(parseShapes(svg)));
writeFileSync(join(ROOT, 'media', 'icon.png'), png);
console.log(`Wrote media/icon.png (${SIZE}x${SIZE}, ${png.length} bytes)`);
