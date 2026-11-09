import { describe, expect, it } from 'vitest';
import { CHROME_JAVASCRIPT_OFF, isSecure, PAGE_FOCUS, parseFocusedField, pressesReturn } from './focused-field';

type FakeElement = {
  tagName: string;
  type?: string;
  attributes?: Record<string, string>;
  isContentEditable?: boolean;
  shadowRoot?: { activeElement: FakeElement | null };
  contentDocument?: { activeElement: FakeElement | null } | null;
};

// Runs the page read against a fake page, the way Chrome runs it in the front tab.
function pageFocus(active: FakeElement | null, hasFocus = true): string {
  const withAttributes = (el: FakeElement | null): unknown =>
    el && {
      ...el,
      getAttribute: (name: string) => el.attributes?.[name] ?? null,
      shadowRoot: el.shadowRoot && { activeElement: withAttributes(el.shadowRoot.activeElement) },
      contentDocument: el.contentDocument && { activeElement: withAttributes(el.contentDocument.activeElement) },
    };
  const document = { hasFocus: () => hasFocus, activeElement: withAttributes(active) };
  return new Function('document', `return ${PAGE_FOCUS};`)(document);
}
const readPage = (active: FakeElement | null, hasFocus = true) => parseFocusedField(pageFocus(active, hasFocus));

describe('the focused field', () => {
  it('reads the role and subrole the script prints', () => {
    expect(parseFocusedField('AXTextField\nAXSearchField\n')).toEqual({ role: 'AXTextField', subrole: 'AXSearchField' });
    expect(parseFocusedField('AXTextArea\n\n')).toEqual({ role: 'AXTextArea', subrole: '' });
    expect(parseFocusedField('AXTextArea\n\nsends\n')).toEqual({ role: 'AXTextArea', subrole: '', sends: true });
    expect(parseFocusedField('')).toBeNull();
  });

  it('reads no field when Chrome will not run the page read', () => {
    expect(parseFocusedField(`${CHROME_JAVASCRIPT_OFF}\n`)).toBeNull();
  });

  it('presses Return after the text in a single-line text, search or combo box', () => {
    expect(pressesReturn({ role: 'AXTextField', subrole: '' })).toBe(true);
    expect(pressesReturn({ role: 'AXTextField', subrole: 'AXSearchField' })).toBe(true);
    expect(pressesReturn({ role: 'AXSearchField', subrole: '' })).toBe(true);
    expect(pressesReturn({ role: 'AXComboBox', subrole: '' })).toBe(true);
  });

  it('never presses Return in a text area, a password field, or a field it could not read', () => {
    expect(pressesReturn({ role: 'AXTextArea', subrole: '' })).toBe(false);
    expect(pressesReturn({ role: 'AXWebArea', subrole: '' })).toBe(false);
    expect(pressesReturn({ role: 'AXTextField', subrole: 'AXSecureTextField' })).toBe(false);
    expect(pressesReturn({ role: 'AXTextField', subrole: 'AXSecureTextField', sends: true })).toBe(false);
    expect(pressesReturn(null)).toBe(false);
  });

  it('presses Return in a text area whose page says Return sends there', () => {
    expect(pressesReturn({ role: 'AXTextArea', subrole: '', sends: true })).toBe(true);
  });

  it('presses Return whatever the field when the session asks it to submit', () => {
    expect(pressesReturn({ role: 'AXTextArea', subrole: '' }, true)).toBe(true);
    expect(pressesReturn(null, true)).toBe(true);
  });

  it('treats a password field, or one it could not read, as secure', () => {
    expect(isSecure({ role: 'AXTextField', subrole: 'AXSecureTextField' })).toBe(true);
    expect(isSecure(null)).toBe(true);
    expect(isSecure({ role: 'AXTextField', subrole: '' })).toBe(false);
  });
});

describe('the field a Chrome page has focused', () => {
  it('reads single-line inputs as text fields, so Done submits a search', () => {
    expect(readPage({ tagName: 'INPUT', type: 'text' })).toEqual({ role: 'AXTextField', subrole: '' });
    expect(readPage({ tagName: 'INPUT', type: 'email' })).toEqual({ role: 'AXTextField', subrole: '' });
    expect(readPage({ tagName: 'INPUT', type: 'search' })).toEqual({ role: 'AXTextField', subrole: 'AXSearchField' });
    expect(readPage({ tagName: 'INPUT', type: 'text', attributes: { role: 'searchbox' } })).toEqual({ role: 'AXTextField', subrole: 'AXSearchField' });
  });

  it('reads a password input as secure, so it is neither submitted nor learned', () => {
    const field = readPage({ tagName: 'INPUT', type: 'password' });
    expect(field).toEqual({ role: 'AXTextField', subrole: 'AXSecureTextField' });
    expect(isSecure(field)).toBe(true);
    expect(pressesReturn(field)).toBe(false);
  });

  it("reads Google's search box, a text area marked as a combo box, as single-line", () => {
    const field = readPage({ tagName: 'TEXTAREA', attributes: { role: 'combobox' } });
    expect(field).toEqual({ role: 'AXComboBox', subrole: '' });
    expect(pressesReturn(field)).toBe(true);
  });

  it('reads text areas and rich editors as multi-line, so Return is never added there', () => {
    expect(readPage({ tagName: 'TEXTAREA' })).toEqual({ role: 'AXTextArea', subrole: '' });
    expect(readPage({ tagName: 'DIV', isContentEditable: true })).toEqual({ role: 'AXTextArea', subrole: '' });
    expect(readPage({ tagName: 'DIV', isContentEditable: true, attributes: { role: 'textbox' } })).toEqual({ role: 'AXTextArea', subrole: '' });
    expect(readPage({ tagName: 'DIV', attributes: { role: 'textbox', 'aria-multiline': 'true' } })).toEqual({ role: 'AXTextArea', subrole: '' });
  });

  it('reads an editor as single-line only when it says so', () => {
    expect(readPage({ tagName: 'DIV', isContentEditable: true, attributes: { role: 'textbox', 'aria-multiline': 'false' } })).toEqual({ role: 'AXTextField', subrole: '' });
    expect(readPage({ tagName: 'DIV', attributes: { role: 'textbox' } })).toEqual({ role: 'AXTextField', subrole: '' });
  });

  it('notes a chat box whose page says Return sends', () => {
    const field = readPage({ tagName: 'DIV', isContentEditable: true, attributes: { enterkeyhint: 'send' } });
    expect(field).toEqual({ role: 'AXTextArea', subrole: '', sends: true });
    expect(pressesReturn(field)).toBe(true);
    expect(readPage({ tagName: 'TEXTAREA', attributes: { enterkeyhint: 'enter' } })).toEqual({ role: 'AXTextArea', subrole: '' });
  });

  it('finds the focus inside shadow roots and same-origin frames', () => {
    expect(readPage({ tagName: 'YT-SEARCHBOX', shadowRoot: { activeElement: { tagName: 'INPUT', type: 'text' } } })).toEqual({ role: 'AXTextField', subrole: '' });
    expect(readPage({ tagName: 'IFRAME', contentDocument: { activeElement: { tagName: 'TEXTAREA' } } })).toEqual({ role: 'AXTextArea', subrole: '' });
  });

  it('reads nothing it cannot tell: no focus, a button, or a cross-origin frame', () => {
    expect(readPage({ tagName: 'INPUT', type: 'text' }, false)).toBeNull();
    expect(readPage({ tagName: 'BODY' })).toBeNull();
    expect(readPage({ tagName: 'INPUT', type: 'checkbox' })).toBeNull();
    expect(readPage({ tagName: 'IFRAME', contentDocument: null })).toBeNull();
    expect(readPage(null)).toBeNull();
  });
});
