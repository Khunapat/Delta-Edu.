// The menu bar (LINE "rich menu") under the 1:1 chat. Every button sends a
// plain command the bot already understands, so a tap costs no push and no AI.
// LINE does not show rich menus in groups.
//
//   งานฉัน      | วันนี้ทำอะไรดี | งานทีม
//   เพิ่มงาน     | ตั้งค่า        | แดชบอร์ด (opens the web board in LINE; วิธีใช้ when no LIFF_ID)
//
// Images: scripts/rich-menu/menu-board.png and menu.png (2500 x 843), drawn from
// scripts/rich-menu/menu.html with the same grid as areas() below.

export const MENU_SIZE = { width: 2500, height: 843 };
export const MENU_NAME = 'norse-main';
export const NEW_TASK_PREFIX = 'งานใหม่: ';

export const BUTTONS = [
  { key: 'mine', th: 'งานฉัน', en: 'My tasks', action: { type: 'message', label: 'งานฉัน', text: 'งานฉัน' } },
  { key: 'today', th: 'วันนี้ทำอะไรดี', en: 'Today', action: { type: 'message', label: 'วันนี้ทำอะไรดี', text: 'วันนี้ทำอะไรดี' } },
  { key: 'team', th: 'งานทีม', en: 'Team', action: { type: 'message', label: 'งานทีม', text: 'งานทีม' } },
  // Opens the keyboard with "งานใหม่: " typed in; the bot never replies to the tap itself.
  { key: 'new', th: 'เพิ่มงาน', en: 'New task', action: { type: 'postback', label: 'เพิ่มงาน', data: 'a=kbd', inputOption: 'openKeyboard', fillInText: NEW_TASK_PREFIX } },
  { key: 'settings', th: 'ตั้งค่า', en: 'AI & pushes', action: { type: 'message', label: 'ตั้งค่า', text: 'ตั้งค่า' } },
  { key: 'help', th: 'วิธีใช้', en: 'Help', action: { type: 'message', label: 'วิธีใช้', text: 'วิธีใช้' } },
];

/** The 6 buttons: with a LIFF app, the last one opens the web board instead of help. */
export function buttonsFor({ liffId = '' } = {}) {
  if (!liffId) return BUTTONS;
  return [...BUTTONS.slice(0, 5), { key: 'board', th: 'แดชบอร์ด', en: 'Dashboard', action: { type: 'uri', label: 'แดชบอร์ด', uri: `https://liff.line.me/${liffId}` } }];
}
export const imageFor = ({ liffId = '' } = {}) => (liffId ? 'menu-board.png' : 'menu.png');

/** 3 x 2 grid of tap areas covering the whole image, in BUTTONS order. */
export function areas({ width, height } = MENU_SIZE, cols = 3, rows = 2) {
  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((width * i) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((height * i) / rows));
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({ x: xs[c], y: ys[r], width: xs[c + 1] - xs[c], height: ys[r + 1] - ys[r] });
    }
  }
  return out;
}

/** The body for POST /v2/bot/richmenu. `version` goes in the name so re-runs can skip an unchanged menu. */
export function richMenuBody(version = '', { liffId = '' } = {}) {
  const grid = areas();
  const buttons = buttonsFor({ liffId });
  return {
    size: MENU_SIZE,
    selected: true, // open by default
    name: version ? `${MENU_NAME}-${version}` : MENU_NAME,
    chatBarText: 'เมนู Norse',
    areas: buttons.map((b, i) => ({ bounds: grid[i], action: b.action })),
  };
}
