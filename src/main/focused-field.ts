// The field that has focus in the app in front, read through Accessibility, which decides what Done does with the
// Gaze Keyboard's text. null when there is no focused element or it can't be read. sends is a web page saying Return
// sends or searches there (enterkeyhint), which a multi-line chat box can.
export type FocusedField = { role: string; subrole: string; sends?: boolean } | null;

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
  if (el.tagName === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    if (type === 'password') return field('AXTextField', 'AXSecureTextField');
    if (type === 'search' || role === 'searchbox') return field('AXTextField', 'AXSearchField');
    if (role === 'combobox') return field('AXComboBox', '');
    return ['text', 'email', 'url', 'tel', 'number'].includes(type) ? field('AXTextField', '') : '';
  }
  if (role === 'searchbox') return field('AXTextField', 'AXSearchField');
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
  try {
    return String(Application('Google Chrome').windows[0].activeTab.execute({ javascript: ${JSON.stringify(PAGE_FOCUS)} }));
  } catch (error) {
    if (/turned off/i.test(String(error.message))) return '${CHROME_JAVASCRIPT_OFF}';
    throw error;
  }
}`;

export function parseFocusedField(stdout: string): FocusedField {
  if (stdout.trim() === CHROME_JAVASCRIPT_OFF) return null;
  const [role = '', subrole = '', sends = ''] = stdout.split('\n').map((line) => line.trim());
  if (role === '' && subrole === '') return null;
  return sends === 'sends' ? { role, subrole, sends: true } : { role, subrole };
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
