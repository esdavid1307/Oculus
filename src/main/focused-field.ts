import type { FieldKind } from '../shared/session';

// The field that has focus in the app in front, read through Accessibility, which decides what Done does with the
// Gaze Keyboard's text. null when there is no focused element or it can't be read. sends is a web page saying Return
// sends or searches there (enterkeyhint), which a multi-line chat box can.
export type FocusedField = (FieldKind & { sends?: boolean }) | null;

// What a read of the focused field found: a field; no field (nothing focused, not a field, or a page Chrome can't run
// the read in); Chrome refusing to run the page read at all; or the read failing (timed out, osascript failed, a second
// Chrome running). Only a refusal leaves the Text Box the keyboard was opened on as a clue: in every other case it may
// no longer be where the focus is.
export type FieldRead = { kind: 'field'; field: NonNullable<FocusedField> } | { kind: 'none' } | { kind: 'javascript-off' } | { kind: 'failed' };

// What READ_FOCUSED_FIELD prints when Chrome is in front and won't run the page read, which is Chrome's default.
export const CHROME_JAVASCRIPT_OFF = 'chrome-javascript-off';

// Run in Chrome's front tab. Prints the focused field as Accessibility would show it with Chrome's tree on: the role,
// the subrole and "sends", one per line, or nothing when no field has focus or it can't be told. It goes into
// same-origin frames and shadow roots, where the focus really is, but not cross-origin frames, which it can't see into.
export const PAGE_FOCUS = `(() => {
  if (!document.hasFocus()) return '';
  let el = document.activeElement;
  for (let depth = 0; el && depth < 10; depth++) {
    if (el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    else if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      let inner = null;
      try { inner = el.contentDocument && el.contentDocument.activeElement; } catch (error) {}
      el = inner;
    } else break;
  }
  if (!el) return '';
  const attr = (name) => (el.getAttribute(name) || '').trim().toLowerCase();
  const role = attr('role').split(/\\s+/)[0];
  const sends = ['send', 'search', 'go'].includes(attr('enterkeyhint')) ? 'sends' : '';
  const field = (axRole, subrole) => [axRole, subrole, sends].join('\\n');
  // Codes, card details and passwords in a plain input are as private as a password field, so they count as one.
  const privateAutocomplete = /\\b(one-time-code|cc-[a-z-]+|current-password|new-password)\\b/.test(attr('autocomplete'));
  if (el.tagName === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'password' || privateAutocomplete) return field('AXTextField', 'AXSecureTextField');
    if (type === 'search' || role === 'searchbox') return field('AXTextField', 'AXSearchField');
    if (role === 'combobox') return field('AXComboBox', '');
    return ['text', 'email', 'url', 'tel', 'number'].includes(type) ? field('AXTextField', '') : '';
  }
  if (role === 'searchbox') return field('AXTextField', 'AXSearchField');
  // A rich editor that says combobox for its @mention list still takes many lines. Google's search box is a text area
  // that says combobox, and is single-line.
  if (role === 'combobox' && el.isContentEditable) return field(attr('aria-multiline') === 'false' ? 'AXTextField' : 'AXTextArea', '');
  if (role === 'combobox') return field('AXComboBox', '');
  // Rich editors that say textbox often leave out aria-multiline though they take many lines, so one is single-line
  // only when it says so. A stray Return in a document is the worse mistake.
  if (role === 'textbox' && (el.tagName === 'TEXTAREA' || el.isContentEditable)) return field(attr('aria-multiline') === 'false' ? 'AXTextField' : 'AXTextArea', '');
  if (role === 'textbox') return field(attr('aria-multiline') === 'true' ? 'AXTextArea' : 'AXTextField', '');
  if (el.tagName === 'TEXTAREA' || el.isContentEditable) return field('AXTextArea', '');
  return '';
})()`;

// Prints the role, then the subrole, of the focused element. Throws when nothing has focus. A field with no subrole is
// an ordinary field. Chrome never gives its focused element to Accessibility, even with its tree on
// (docs/chrome-scan.md), so with Chrome in front and nothing found its page is asked instead, which needs Chrome's
// View > Developer > Allow JavaScript from Apple Events. With two Chrome processes the scripting could reach the other.
export const READ_FOCUSED_FIELD = `function run() {
  const events = Application('System Events');
  const front = events.processes.whose({ frontmost: true })[0];
  const focused = front.attributes.byName('AXFocusedUIElement').value();
  if (focused) {
    const read = (name) => { try { return focused.attributes.byName(name).value() || ''; } catch (error) { return ''; } };
    return read('AXRole') + '\\n' + read('AXSubrole');
  }
  if (front.name() !== 'Google Chrome' || events.processes.whose({ name: 'Google Chrome' }).length !== 1) throw new Error('No focused element');
  let answer;
  // Any error here is Chrome refusing to run it: its message is in Chrome's language, so it isn't matched. A page that
  // can't run it (chrome://, the PDF viewer) or a read that throws gives missing value instead, which is no field.
  try {
    answer = Application('Google Chrome').windows[0].activeTab.execute({ javascript: ${JSON.stringify(PAGE_FOCUS)} });
  } catch (error) {
    return '${CHROME_JAVASCRIPT_OFF}';
  }
  return answer === null || answer === undefined ? '' : String(answer);
}`;

// What JXA prints for missing value, should one slip through as text.
const NOTHING = new Set(['null', 'undefined', 'missing value']);

export function parseFieldRead(stdout: string): FieldRead {
  const trimmed = stdout.trim();
  if (trimmed === CHROME_JAVASCRIPT_OFF) return { kind: 'javascript-off' };
  if (NOTHING.has(trimmed)) return { kind: 'none' };
  const [role = '', subrole = '', sends = ''] = stdout.split('\n').map((line) => line.trim());
  if (role === '' && subrole === '') return { kind: 'none' };
  return { kind: 'field', field: sends === 'sends' ? { role, subrole, sends: true } : { role, subrole } };
}

export function parseFocusedField(stdout: string): FocusedField {
  const read = parseFieldRead(stdout);
  return read.kind === 'field' ? read.field : null;
}

// A password field's text must never be remembered. A field that can't be read counts as one: not learning is the safe
// mistake.
export function isSecure(field: FocusedField): boolean {
  return field === null || field.subrole === 'AXSecureTextField';
}

// Fields where Return submits: a text or search field, and a combo box such as Google's search box.
const SINGLE_LINE_ROLES = new Set(['AXTextField', 'AXSearchField', 'AXComboBox']);

// Done submits with Return in a single-line field, such as a search or message box, but never in a text area like a
// document, where it would add a stray line, unless the page says Return sends there. submit, set by the session,
// presses it whatever the field.
export function pressesReturn(field: FocusedField, submit = false): boolean {
  if (submit) return true;
  if (isSecure(field)) return false;
  return field!.sends === true || SINGLE_LINE_ROLES.has(field!.role) || field!.subrole === 'AXSearchField';
}

// What Done does with the text, from what the read found and the Text Box the keyboard was opened on (if any). Learning
// goes only by the field read now: the box was read earlier, and the page may have changed it since. Return goes by the
// field read now too, and by the box only when Chrome refused the page read, since it is then the only clue. When the
// page says no field has focus, or the read failed, Return is never pressed: it could land on a button. inMessages, while
// Messages is in front, always sends: its compose box takes many lines, so the field alone would never press Return.
export function onDone(read: FieldRead, box: FieldKind | undefined, submit: boolean, inMessages = false): { submit: boolean; learn: boolean } {
  const field = read.kind === 'field' ? read.field : null;
  const known = field ?? (read.kind === 'javascript-off' ? (box ?? null) : null);
  return { submit: pressesReturn(known, submit || inMessages), learn: !isSecure(field) };
}
