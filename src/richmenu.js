// The menu bar (LINE "rich menu") under the 1:1 chat. Every button sends a
// plain command the bot already understands, so a tap costs no push and no AI.
// LINE does not show rich menus in groups.
//
//   My tasks | Today   | Team
//   New task | Classes | Board (opens the web board in LINE; Help when no LIFF_ID)
//
// Images: scripts/rich-menu/menu-board.png and menu.png (2500 x 843), drawn from
// scripts/rich-menu/menu.html with the same grid as areas() below.

export const MENU_SIZE = { width: 2500, height: 843 };
export const MENU_NAME = 'delta-main';
export const NEW_TASK_PREFIX = 'new task: ';

export const BUTTONS = [
  { key: 'mine', en: 'My tasks', action: { type: 'message', label: 'My tasks', text: 'my tasks' } },
  { key: 'today', en: 'Today', action: { type: 'message', label: 'Today', text: 'today' } },
  { key: 'team', en: 'Team', action: { type: 'message', label: 'Team', text: 'team' } },
  // Opens the keyboard with "new task: " typed in; the bot never replies to the tap itself.
  { key: 'new', en: 'New task', action: { type: 'postback', label: 'New task', data: 'a=kbd', inputOption: 'openKeyboard', fillInText: NEW_TASK_PREFIX } },
  { key: 'classes', en: 'Classes', action: { type: 'message', label: 'Classes', text: 'my classes' } },
  { key: 'help', en: 'Help', action: { type: 'message', label: 'Help', text: 'help' } },
];

/** The 6 buttons: with a LIFF app, the last one opens the web board instead of help. */
export function buttonsFor({ liffId = '' } = {}) {
  if (!liffId) return BUTTONS;
  return [...BUTTONS.slice(0, 5), { key: 'board', en: 'Board', action: { type: 'uri', label: 'Board', uri: `https://liff.line.me/${liffId}` } }];
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
    chatBarText: 'Delta menu',
    areas: buttons.map((b, i) => ({ bounds: grid[i], action: b.action })),
  };
}
