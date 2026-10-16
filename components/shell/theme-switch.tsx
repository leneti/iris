'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useHydrated } from '@/lib/client/use-client';
import { cn } from '@/lib/utils';

const OPTIONS = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
  { value: 'system', label: 'System theme', Icon: Monitor },
] as const;

/** Three-way switch: light, dark, system. `compact` is one button that cycles (the rail). */
export function ThemeSwitch({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  // next-themes knows the theme only on the client; render a neutral state until mounted.
  const mounted = useHydrated();
  const current = mounted ? (theme ?? 'system') : 'system';

  if (compact) {
    const index = OPTIONS.findIndex((o) => o.value === current);
    const here = OPTIONS[index === -1 ? 2 : index]!;
    const next = OPTIONS[(OPTIONS.indexOf(here) + 1) % OPTIONS.length]!;
    return (
      <button
        type="button"
        aria-label={`${here.label}, switch to ${next.value}`}
        onClick={() => setTheme(next.value)}
        className="flex h-8 w-10 items-center justify-center rounded-row text-text-2 outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <here.Icon className="size-4" />
      </button>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-row border border-control p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          onClick={() => setTheme(value)}
          className={cn(
            'flex size-6 items-center justify-center rounded-row text-text-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            current === value ? 'bg-selected text-text' : 'hover:bg-hover',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
