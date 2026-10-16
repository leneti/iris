'use client';

import { Copy } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * "Copy link" for a page that is not a secure context: no clipboard API is available there, so
 * the button reveals a read-only field with the address selected, ready for Ctrl+C or a long
 * press. Render it inside a wrapping flex row: the field takes a line of its own.
 */
export function CopyField({
  value,
  label = 'Copy link',
  defaultShown = false,
  className,
}: {
  value: string;
  label?: string;
  defaultShown?: boolean;
  className?: string;
}) {
  const [shown, setShown] = useState(defaultShown);
  const input = useRef<HTMLInputElement | null>(null);

  const select = useCallback(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Runs when the field mounts, not on every render, so later renders keep the selection.
  const attach = useCallback((el: HTMLInputElement | null) => {
    input.current = el;
    el?.focus();
    el?.select();
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className={className}
        onClick={() => (shown ? select() : setShown(true))}
      >
        <Copy />
        {label}
      </Button>
      {shown && (
        <div className="flex basis-full flex-col gap-1">
          <input
            ref={attach}
            readOnly
            aria-label="Link"
            value={value}
            onFocus={(e) => e.currentTarget.select()}
            className="h-8 w-full rounded-row border border-input bg-raised px-2 font-mono text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span className="text-xs text-text-3">Selected. Press Ctrl+C or Cmd+C to copy it.</span>
        </div>
      )}
    </>
  );
}
