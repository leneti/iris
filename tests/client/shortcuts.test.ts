import { afterEach, describe, expect, test } from 'vitest';
import { shouldOpenPalette } from '@/lib/client/shortcuts';

function key(init: KeyboardEventInit & { key: string }): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}
function mount(html: string): Element {
  document.body.innerHTML = html;
  return (
    document.body.firstElementChild!.querySelector('[data-focus]') ??
    document.body.firstElementChild!
  );
}
afterEach(() => {
  document.body.innerHTML = '';
});

describe('shouldOpenPalette (criterion 4.1)', () => {
  test('Cmd+K and Ctrl+K always open, even inside an input', () => {
    const input = mount('<input data-focus />');
    expect(shouldOpenPalette(key({ key: 'k', metaKey: true }), null)).toBe(true);
    expect(shouldOpenPalette(key({ key: 'k', ctrlKey: true }), null)).toBe(true);
    expect(shouldOpenPalette(key({ key: 'K', ctrlKey: true }), input)).toBe(true);
    expect(shouldOpenPalette(key({ key: 'k', metaKey: true }), input)).toBe(true);
  });
  test('plain k does not open', () => {
    expect(shouldOpenPalette(key({ key: 'k' }), null)).toBe(false);
  });
  test('/ opens when nothing or a non-text element has focus', () => {
    expect(shouldOpenPalette(key({ key: '/' }), null)).toBe(true);
    expect(shouldOpenPalette(key({ key: '/' }), document.body)).toBe(true);
    expect(shouldOpenPalette(key({ key: '/' }), mount('<button data-focus>x</button>'))).toBe(true);
  });
  test.each([
    ['input', '<input data-focus />'],
    ['textarea', '<textarea data-focus></textarea>'],
    ['select', '<select data-focus><option>a</option></select>'],
    ['contenteditable', '<div contenteditable="true" data-focus>x</div>'],
    ['contenteditable (empty attribute)', '<div contenteditable data-focus>x</div>'],
    ['child of contenteditable', '<div contenteditable="true"><span data-focus>x</span></div>'],
  ])('/ does not open when focus is in %s', (_name, html) => {
    expect(shouldOpenPalette(key({ key: '/' }), mount(html))).toBe(false);
  });
  test('contenteditable="false" is not text entry', () => {
    expect(
      shouldOpenPalette(
        key({ key: '/' }),
        mount('<div contenteditable="false" data-focus>x</div>'),
      ),
    ).toBe(true);
  });
  test('/ with a modifier, or while composing, does not open', () => {
    expect(shouldOpenPalette(key({ key: '/', ctrlKey: true }), null)).toBe(false);
    expect(shouldOpenPalette(key({ key: '/', altKey: true }), null)).toBe(false);
    expect(shouldOpenPalette(key({ key: '/', isComposing: true }), null)).toBe(false);
  });
});
