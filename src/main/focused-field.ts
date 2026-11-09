// The field that has focus in the app in front, read through Accessibility, which decides what Done does with the
// Gaze Keyboard's text. null when there is no focused element or it can't be read.
export type FocusedField = { role: string; subrole: string } | null;

// Prints the role, then the subrole, of the focused element. Throws when nothing has focus. A field with no subrole is
// an ordinary field.
export const READ_FOCUSED_FIELD = `const events = Application('System Events');
const focused = events.processes.whose({ frontmost: true })[0].attributes.byName('AXFocusedUIElement').value();
if (!focused) throw new Error('No focused element');
const read = (name) => { try { return focused.attributes.byName(name).value() || ''; } catch (error) { return ''; } };
read('AXRole') + '\\n' + read('AXSubrole')`;

export function parseFocusedField(stdout: string): FocusedField {
  const [role = '', subrole = ''] = stdout.split('\n').map((line) => line.trim());
  return role === '' && subrole === '' ? null : { role, subrole };
}

// A password field's text must never be remembered. A field that can't be read counts as one: not learning is the safe
// mistake.
export function isSecure(field: FocusedField): boolean {
  return field === null || field.subrole === 'AXSecureTextField';
}

// Done submits with Return in a single-line field, such as a search or message box, but never in a text area like a
// document, where it would add a stray line. submit, set by the session, presses it whatever the field.
export function pressesReturn(field: FocusedField, submit = false): boolean {
  if (submit) return true;
  if (isSecure(field)) return false;
  return field!.role === 'AXTextField' || field!.role === 'AXSearchField' || field!.subrole === 'AXSearchField';
}
