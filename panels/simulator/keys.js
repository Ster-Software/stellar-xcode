// Browser key events -> USB HID usage codes, for typing into the simulator.
const SHIFT = 225;
const LETTER_A = 4;
const DIGIT_1 = 30;
const DIGIT_0 = 39;

const NAMED = {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, ' ': 44,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, Delete: 76,
};

/** [character without shift, with shift] -> HID code. */
const PUNCTUATION = {
  45: ['-', '_'], 46: ['=', '+'], 47: ['[', '{'], 48: [']', '}'], 49: ['\\', '|'],
  51: [';', ':'], 52: ["'", '"'], 53: ['`', '~'], 54: [',', '<'], 55: ['.', '>'], 56: ['/', '?'],
};
const SHIFTED_DIGITS = '!@#$%^&*()';

/** The HID codes for one keydown (shift first when needed), or null for keys we don't send. */
export function keycodesFor(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const { key } = event;
  if (NAMED[key]) return [NAMED[key]];
  if (key.length !== 1) return null;
  const lower = key.toLowerCase();
  if (lower >= 'a' && lower <= 'z') {
    const code = LETTER_A + lower.charCodeAt(0) - 97;
    return key === lower ? [code] : [SHIFT, code];
  }
  if (key >= '1' && key <= '9') return [DIGIT_1 + Number(key) - 1];
  if (key === '0') return [DIGIT_0];
  const shiftedDigit = SHIFTED_DIGITS.indexOf(key);
  if (shiftedDigit >= 0) return [SHIFT, shiftedDigit === 9 ? DIGIT_0 : DIGIT_1 + shiftedDigit];
  for (const [code, [plain, shifted]] of Object.entries(PUNCTUATION)) {
    if (key === plain) return [Number(code)];
    if (key === shifted) return [SHIFT, Number(code)];
  }
  return null;
}
