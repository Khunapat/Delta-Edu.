// Draws LINE Flex messages as HTML, close to how LINE lays them out, for previews.
// Covers what src/flex.js uses: box (vertical/horizontal/baseline, spacing, margins,
// padding, width/height, corner radius, borders, gradients, absolute offsets),
// text, image (incl. animated), separator, filler; bubble blocks header/hero/body/footer.
// LINE's real renderer uses the phone's font and its own spacing, so expect small differences.

const SIZE = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const GAP = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const RAD = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 999 };
const BW = { none: 0, light: 0.5, normal: 1, medium: 2, 'semi-bold': 3, bold: 4 };
const px = (v, map) => (v == null ? null : map && map[v] != null ? map[v] + 'px' : String(v));
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** `urlFor(url)` lets the caller swap image URLs (e.g. for embedded data URIs). */
export function render(m, { urlFor = (u) => u } = {}) {
  function node(n, parent) {
    const st = [];
    const m2 = n.margin ? px(n.margin, GAP) : null;
    if (m2) st.push(parent === 'vertical' ? `margin-top:${m2}` : `margin-left:${m2}`);
    // LINE: in a horizontal box children share the width (flex 1 by default); in a vertical
    // box they keep their own height unless flex asks for more.
    if (parent === 'horizontal') {
      if (n.flex === 0 || (n.flex == null && n.width)) st.push('flex:none');
      else if (n.type !== 'filler' && n.type !== 'separator') st.push(`flex:${n.flex ?? 1} 1 0;min-width:0`);
    } else if (n.flex === 0) st.push('flex:none');
    if (n.position === 'absolute') {
      st.push('position:absolute');
      if (n.offsetTop) st.push(`top:${n.offsetTop}`);
      if (n.offsetStart) st.push(`left:${n.offsetStart}`);
      if (n.offsetBottom) st.push(`bottom:${n.offsetBottom}`);
      if (n.offsetEnd) st.push(`right:${n.offsetEnd}`);
    } else if (n.offsetTop) st.push(`position:relative;top:${n.offsetTop}`);
    if (n.type === 'text') {
      st.push(`font-size:${SIZE[n.size || 'md'] || parseInt(n.size, 10)}px`, `color:${n.color || '#111'}`, `font-weight:${n.weight === 'bold' ? 700 : 400}`, 'line-height:1.4');
      if (n.align) st.push(`text-align:${n.align === 'end' ? 'right' : n.align}`);
      st.push(n.wrap === false ? 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' : 'white-space:pre-wrap;overflow-wrap:anywhere');
      if (n.gravity === 'center') st.push('align-self:center');
      return `<div style="${st.join(';')}">${esc(n.text)}</div>`;
    }
    if (n.type === 'image') {
      const [w, h] = String(n.aspectRatio || '1:1').split(':').map(Number);
      return `<img alt="" src="${esc(urlFor(n.url))}" style="${st.join(';')};display:block;width:100%;aspect-ratio:${w}/${h};object-fit:${n.aspectMode === 'fit' ? 'contain' : 'cover'}">`;
    }
    if (n.type === 'separator') return `<div style="border-top:1px solid ${n.color};${m2 ? 'margin-top:' + m2 : ''}"></div>`;
    if (n.type === 'filler') return '<div style="flex:1 1 0"></div>';
    if (n.type === 'box') {
      st.push('display:flex', `flex-direction:${n.layout === 'vertical' ? 'column' : 'row'}`, 'position:' + (n.position === 'absolute' ? 'absolute' : 'relative'), 'box-sizing:border-box');
      if (n.layout === 'baseline') st.push('align-items:baseline');
      if (n.spacing) st.push(`gap:${px(n.spacing, GAP)}`);
      if (n.backgroundColor) st.push(`background:${n.backgroundColor}`);
      const g = n.background;
      if (g?.type === 'linearGradient') st.push(`background:linear-gradient(${g.angle},${[g.startColor, g.centerColor, g.endColor].filter(Boolean).join(',')})`);
      if (n.borderColor) st.push(`border:${BW[n.borderWidth || 'light'] ?? 1}px solid ${n.borderColor}`);
      if (n.cornerRadius) st.push(`border-radius:${px(n.cornerRadius, RAD)};overflow:hidden`);
      for (const k of ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd']) {
        if (n[k] == null) continue;
        const v = px(n[k], GAP);
        if (k === 'paddingAll') st.push(`padding:${v}`);
        else st.push(`padding-${{ paddingTop: 'top', paddingBottom: 'bottom', paddingStart: 'left', paddingEnd: 'right' }[k]}:${v}`);
      }
      if (n.width) st.push(`width:${n.width};flex-shrink:0`);
      if (n.height) st.push(`height:${n.height};min-height:${n.height}`);
      if (n.alignItems) st.push(`align-items:${n.alignItems}`);
      if (n.justifyContent) st.push(`justify-content:${n.justifyContent}`);
      if (n.action) st.push('cursor:pointer');
      const kids = n.contents.map((c) => node(c, n.layout === 'vertical' ? 'vertical' : 'horizontal')).join('');
      return `<div style="${st.join(';')}"${n.action ? ` title="${esc(n.action.label || '')}"` : ''}>${kids}</div>`;
    }
    return '';
  }
  function bubble(b) {
    const w = { nano: 120, micro: 160, kilo: 260, mega: 300, giga: 386 }[b.size || 'mega'];
    const block = (k) => {
      if (!b[k]) return '';
      if (b[k].type === 'image') return node(b[k], 'vertical');
      const bg = b.styles?.[k]?.backgroundColor;
      return `<div style="${bg ? 'background:' + bg : ''}">${node(b[k], 'vertical')}</div>`;
    };
    return `<div class="bubble" style="width:${w}px">${['header', 'hero', 'body', 'footer'].map(block).join('')}</div>`;
  }
  if (m.type === 'text' || m.type === 'textV2') {
    const quick = m.quickReply ? `<div class="quick">${m.quickReply.items.map((i) => `<span>${esc(i.action.label)}</span>`).join('')}</div>` : '';
    return `<div class="msg"><div class="text">${esc(m.text)}</div>${quick}</div>`;
  }
  const c = m.contents;
  const inner = c.type === 'carousel' ? c.contents.map(bubble).join('') : bubble(c);
  return `<div class="msg"><div class="row">${inner}</div></div>`;
}
