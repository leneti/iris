import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Ball, type BallProps } from '@/components/ball/ball';
import { StaticBall } from '@/components/ball/static-ball';
import { hasWebGL2, resetWebGL2Probe } from '@/components/ball/webgl';

const stub = vi.hoisted(() => ({ lose: null as null | (() => void), mounts: 0 }));

vi.mock('@/components/ball/crystal-ball', async () => {
  const { useEffect } = await import('react');
  return {
    default: function CrystalBallStub(props: {
      color: string;
      hoverStrength: number;
      onContextLost: () => void;
    }) {
      stub.lose = props.onContextLost;
      useEffect(() => {
        stub.mounts += 1;
      }, []);
      return (
        <div data-slot="crystal-ball" data-hover={props.hoverStrength} data-color={props.color} />
      );
    },
  };
});

const base: BallProps = {
  color: '#f25bd0',
  motion: 'drift',
  crackle: 0.3,
  sparks: 0.4,
  flares: 0.5,
  speed: 1.2,
  fill: 0.6,
  hoverStrength: 0.6,
  variant: 'desktop',
};

let getContext: ReturnType<typeof vi.spyOn>;

function withWebGL2() {
  const loseContext = vi.fn();
  getContext.mockImplementation(((kind: string) =>
    kind === 'webgl2'
      ? { getExtension: () => ({ loseContext }) }
      : null) as unknown as HTMLCanvasElement['getContext']);
  return loseContext;
}

beforeEach(() => {
  resetWebGL2Probe();
  stub.lose = null;
  stub.mounts = 0;
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  getContext.mockRestore();
});

describe('Ball', () => {
  test('without WebGL2 it renders the static ball and never loads the crystal ball', async () => {
    const { container } = render(<Ball {...base} />);
    expect(container.querySelector('[data-slot="static-ball"]')).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container.querySelector('[data-slot="crystal-ball"]')).toBeNull();
    expect(stub.mounts).toBe(0);
  });

  test('with WebGL2 it renders the static ball first, then the crystal ball', async () => {
    withWebGL2();
    const { container } = render(<Ball {...base} />);
    expect(container.querySelector('[data-slot="static-ball"]')).not.toBeNull();
    expect(await screen.findByText('', { selector: '[data-slot="crystal-ball"]' })).toBeTruthy();
    expect(container.querySelector('[data-slot="static-ball"]')).toBeNull();
  });

  test('props change without remounting', async () => {
    withWebGL2();
    const { container, rerender } = render(<Ball {...base} />);
    await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
    const node = container.querySelector('[data-slot="crystal-ball"]');
    rerender(<Ball {...base} color="#ff7a6b" hoverStrength={1} />);
    const after = container.querySelector('[data-slot="crystal-ball"]');
    expect(after).toBe(node);
    expect(after?.getAttribute('data-color')).toBe('#ff7a6b');
    expect(after?.getAttribute('data-hover')).toBe('1');
    expect(stub.mounts).toBe(1);
  });

  test('a lost context falls back to the static ball', async () => {
    withWebGL2();
    const { container } = render(<Ball {...base} />);
    await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
    act(() => stub.lose?.());
    expect(container.querySelector('[data-slot="crystal-ball"]')).toBeNull();
    expect(container.querySelector('[data-slot="static-ball"]')).not.toBeNull();
  });
});

describe('StaticBall', () => {
  test('static ball carries the colour', () => {
    const { container } = render(<StaticBall color="#f25bd0" className="x" />);
    const el = container.querySelector('[data-slot="static-ball"]') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('x');
    expect(el.getAttribute('style')).toContain('#f25bd0');
  });

  test.each([
    ['pink', '#f25bd0'],
    ['coral', '#ff7a6b'],
  ])('static ball is the same colour as the ball state (%s)', (_name, color) => {
    const { container } = render(<Ball {...base} color={color as BallProps['color']} />);
    const el = container.querySelector('[data-slot="static-ball"]') as HTMLElement;
    expect(el.getAttribute('style')).toContain(color);
  });
});

describe('hasWebGL2', () => {
  test('hasWebGL2 probes once', () => {
    const loseContext = withWebGL2();
    expect(hasWebGL2()).toBe(true);
    expect(hasWebGL2()).toBe(true);
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });

  test('is false when the context is refused', () => {
    expect(hasWebGL2()).toBe(false);
    expect(hasWebGL2()).toBe(false);
    expect(getContext).toHaveBeenCalledTimes(1);
  });
});
