import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useDialog } from '../hooks/useDialog';

function Dialog({ onClose, label }: { onClose: () => void; label: string }) {
  useDialog(onClose);
  return (
    <div role="dialog" aria-modal="true" aria-label={label}>
      <button>first</button>
      <button>second</button>
    </div>
  );
}

describe('useDialog', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} label="a" />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('only the top-most dialog reacts to Escape', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const { rerender } = render(<Dialog onClose={outer} label="outer" />);
    rerender(
      <>
        <Dialog onClose={outer} label="outer" />
        <Dialog onClose={inner} label="inner" />
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('wraps Tab focus inside the dialog', () => {
    render(<Dialog onClose={() => {}} label="b" />);
    const first = screen.getByText('first');
    const second = screen.getByText('second');
    second.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(second);
  });
});
