import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CopyField } from '@/components/tabs/copy-field';

afterEach(() => vi.unstubAllGlobals());

describe('CopyField', () => {
  test('"Copy link" selects the text in a read-only input and calls no clipboard API', () => {
    const writeText = vi.fn();
    const exec = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    document.execCommand = exec;
    render(<CopyField value="https://app.example.invalid/path" />);
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const field = screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe('https://app.example.invalid/path');
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(document.activeElement).toBe(field);
    expect(writeText).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
  });

  test('a second press selects again after the user clicked elsewhere in the field', () => {
    render(<CopyField value="https://app.example.invalid/" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    const field = screen.getByRole('textbox', { name: 'Link' }) as HTMLInputElement;
    field.setSelectionRange(2, 2);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });
});
