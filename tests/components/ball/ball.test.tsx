import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Ball, type BallProps } from '@/components/ball/ball';
import { SIZE } from '@/components/ball/size';
import { StaticBall } from '@/components/ball/static-ball';
import { hasWebGL2, resetWebGL2Probe } from '@/components/ball/webgl';

const stub = vi.hoisted(() => ({
  lose: null as null | (() => void),
  frame: null as null | (() => void),
  mounts: 0,
}));

vi.mock('@/components/ball/crystal-ball', async () => {
  const { useEffect } = await import('react');
  return {
    default: function CrystalBallStub(props: {
      color: string;
      hoverStrength: number;
      onContextLost: () => void;
      onFirstFrame?: () => void;
    }) {
      stub.lose = props.onContextLost;
      stub.frame = props.onFirstFrame ?? null;
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
  stub.frame = null;
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

  test('with WebGL2 it renders the static ball first, then the crystal ball over it', async () => {
    withWebGL2();
    const { container } = render(<Ball {...base} />);
    expect(container.querySelector('[data-slot="static-ball"]')).not.toBeNull();
    expect(await screen.findByText('', { selector: '[data-slot="crystal-ball"]' })).toBeTruthy();
    expect(container.querySelector('[data-slot="static-ball"]')).not.toBeNull();
  });

  describe('the cross-fade', () => {
    const canvas = (c: HTMLElement) => c.querySelector('[data-slot="ball-canvas"]') as HTMLElement;
    const still = (c: HTMLElement) => c.querySelector('[data-slot="static-ball"]') as HTMLElement;

    test('the canvas is clear until its first frame, then fades in over 300 ms', async () => {
      withWebGL2();
      const { container } = render(<Ball {...base} />);
      await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
      expect(canvas(container).className).toContain('opacity-0');
      expect(canvas(container).className).toContain('duration-300');
      expect(still(container).className).not.toContain('opacity-0');
      act(() => stub.frame?.());
      expect(canvas(container).className).toContain('opacity-100');
      expect(canvas(container).className).not.toContain('opacity-0');
      expect(still(container).className).toContain('opacity-0');
    });

    test('reduced motion turns the transition off', async () => {
      withWebGL2();
      const { container } = render(<Ball {...base} />);
      await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
      expect(canvas(container).className).toContain('motion-reduce:transition-none');
      expect(still(container).className).toContain('motion-reduce:transition-none');
    });

    test('the box is the same before and after the first frame', async () => {
      withWebGL2();
      const { container } = render(<Ball {...base} />);
      await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
      const classes = () => [canvas(container).className, still(container).className];
      const before = classes();
      act(() => stub.frame?.());
      for (const [i, after] of classes().entries()) {
        for (const name of ['absolute', 'inset-0']) {
          expect(after.split(' ')).toContain(name);
          expect(before[i]?.split(' ')).toContain(name);
        }
      }
      expect((container.firstElementChild as HTMLElement).className).toBe('relative size-full');
    });

    test('a lost context brings the static ball back', async () => {
      withWebGL2();
      const { container } = render(<Ball {...base} />);
      await screen.findByText('', { selector: '[data-slot="crystal-ball"]' });
      act(() => stub.frame?.());
      act(() => stub.lose?.());
      expect(canvas(container)).toBeNull();
      expect(still(container).className).not.toContain('opacity-0');
    });

    test('without WebGL2 there is no canvas to fade in', () => {
      const { container } = render(<Ball {...base} />);
      expect(canvas(container)).toBeNull();
      expect(still(container).className).not.toContain('opacity-0');
    });
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
  const sphere = (c: HTMLElement) => c.querySelector('[data-slot="static-sphere"]') as HTMLElement;

  test('static ball carries the colour', () => {
    const { container } = render(<StaticBall color="#f25bd0" className="x" />);
    const el = container.querySelector('[data-slot="static-ball"]') as HTMLElement;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.className).toContain('x');
    expect(sphere(container).getAttribute('style')).toContain('#f25bd0');
  });

  test.each([
    ['pink', '#f25bd0'],
    ['coral', '#ff7a6b'],
  ])('static ball is the same colour as the ball state (%s)', (_name, color) => {
    const { container } = render(<Ball {...base} color={color as BallProps['color']} />);
    expect(sphere(container).getAttribute('style')).toContain(color);
  });

  test.each([
    ['desktop', '86%'],
    ['phone', '82%'],
  ] as const)('the %s sphere is the WebGL size, centred in a full box', (variant, size) => {
    const { container } = render(<StaticBall color="#f25bd0" variant={variant} />);
    expect(SIZE[variant] * 100 + '%').toBe(size);
    const box = container.querySelector('[data-slot="static-ball"]') as HTMLElement;
    expect(box.className).toContain('size-full');
    expect(sphere(container).style.width).toBe(size);
    expect(sphere(container).style.height).toBe(size);
    const centre = sphere(container).className.split(' ');
    expect(centre).toEqual(
      expect.arrayContaining(['top-1/2', 'left-1/2', '-translate-x-1/2', '-translate-y-1/2']),
    );
  });

  test('it is a desktop sphere by default and the Ball passes its variant on', () => {
    const { container, rerender } = render(<StaticBall color="#f25bd0" />);
    expect(sphere(container).style.width).toBe('86%');
    rerender(<Ball {...base} variant="phone" />);
    expect(sphere(container).style.width).toBe('82%');
  });

  test('the rim glows in the ball colour', () => {
    const { container } = render(<StaticBall color="#ff7a6b" />);
    const shadow = sphere(container).style.boxShadow;
    expect(shadow).toContain('inset');
    expect(shadow).toContain('#ff7a6b');
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
