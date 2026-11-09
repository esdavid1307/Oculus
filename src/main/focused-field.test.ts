import { describe, expect, it } from 'vitest';
import { isSecure, parseFocusedField, pressesReturn } from './focused-field';

describe('the focused field', () => {
  it('reads the role and subrole the script prints', () => {
    expect(parseFocusedField('AXTextField\nAXSearchField\n')).toEqual({ role: 'AXTextField', subrole: 'AXSearchField' });
    expect(parseFocusedField('AXTextArea\n\n')).toEqual({ role: 'AXTextArea', subrole: '' });
    expect(parseFocusedField('')).toBeNull();
  });

  it('presses Return after the text in a single-line text or search field', () => {
    expect(pressesReturn({ role: 'AXTextField', subrole: '' })).toBe(true);
    expect(pressesReturn({ role: 'AXTextField', subrole: 'AXSearchField' })).toBe(true);
    expect(pressesReturn({ role: 'AXSearchField', subrole: '' })).toBe(true);
  });

  it('never presses Return in a text area, a password field, or a field it could not read', () => {
    expect(pressesReturn({ role: 'AXTextArea', subrole: '' })).toBe(false);
    expect(pressesReturn({ role: 'AXWebArea', subrole: '' })).toBe(false);
    expect(pressesReturn({ role: 'AXTextField', subrole: 'AXSecureTextField' })).toBe(false);
    expect(pressesReturn(null)).toBe(false);
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
