// δelta Edu. brand pieces shared by the render scripts (brand, banners, rich-menu).
// Everything is drawn from brand/delta-logo.svg (the one-line wordmark as outlines, so no
// font is needed): its two <path>s are "δelta" and "Edu.", each with its width in data-w.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const BRAND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'brand');
export const C = {
  dark: '#0B5C03', green: '#2E7D1E', light: '#C8E88D', cream: '#FDFCF4',
  soft: '#E8F0E4', gold: '#D4A017', ink: '#1F2A1D',
};
export const TAGLINE = 'Small things create big change.';

export const logoSvg = readFileSync(join(BRAND_DIR, 'delta-logo.svg'), 'utf8');
const paths = [...logoSvg.matchAll(/<path data-line="(\d)" data-w="([\d.]+)"(?: transform="[^"]*")? d="([^"]+)"\/>/g)]
  .map((m) => ({ w: Number(m[2]), d: m[3] }));
if (paths.length !== 2) throw new Error('brand/delta-logo.svg: expected two <path data-line> elements');
const [L1, L2] = paths;
const CAP = 745; const LEAD = 830; // glyph top above the baseline; baseline to baseline

// The two-line wordmark as an SVG group: "δelta" over "Edu.", top-left at (x, y), scale s.
export function stacked(x, y, s, fill) {
  return `<g transform="translate(${x} ${y}) scale(${s}) translate(0 ${CAP})" fill="${fill}">`
    + `<path d="${L1.d}"/><path transform="translate(0 ${LEAD})" d="${L2.d}"/></g>`;
}
export const STACK_W = Math.max(L1.w, L2.w); export const STACK_H = CAP + LEAD + 20;

// The logo mark: a slab (top-left and bottom-right corners cut at 45°) with the stacked
// wordmark bottom-left inside. Returns { svg, w, h } in its own units (width 1000).
export function slab({ fill = C.cream, ink = C.dark, title = true } = {}) {
  const w = 1000; const s = 0.255; const tw = STACK_W * s; const th = STACK_H * s;
  const padL = 92; const padB = 78; const h = Math.round(th + padB + 250); const c = 190;
  const pts = `${c},0 ${w},0 ${w},${h - c} ${w - c},${h} 0,${h} 0,${c}`;
  const body = `<polygon points="${pts}" fill="${fill}"/>`
    + stacked(padL, h - padB - th, s, ink);
  return { w, h, body, svg: (style = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"${style ? ` style="${style}"` : ''}${title ? ' role="img" aria-label="δelta Edu."><title>δelta Edu.</title>' : ' aria-hidden="true">'}${body}</svg>`, tw };
}

// Just the δ (first glyph of the wordmark), clipped out, ~600 x 760 units with its baseline at 745.
export function deltaGlyph(fill) {
  return `<g fill="${fill}"><clipPath id="dclip"><rect x="0" y="-10" width="596" height="800"/></clipPath>`
    + `<g clip-path="url(#dclip)"><path transform="translate(0 ${CAP})" d="${L1.d}"/></g></g>`;
}
