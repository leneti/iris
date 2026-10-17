'use client';

import { Component, type ReactNode } from 'react';

type Props = { name: string; fallback?: ReactNode; children: ReactNode };
type State = { failed: boolean };

/** Keeps one failing region from taking the page down; the rest keeps drawing. */
export class SectionBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('[iris]', this.props.name, error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <p className="text-faint text-sm">
        This part didn&apos;t draw.{' '}
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="rounded-sm underline outline-none focus-visible:ring-2 focus-visible:ring-pink-soft"
        >
          Try again
        </button>
      </p>
    );
  }
}
