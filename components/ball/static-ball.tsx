import { cn } from '@/lib/utils';
import { type BallVariant, SIZE } from './size';

const tint = (color: string, percent: number) =>
  `color-mix(in srgb, ${color} ${percent}%, transparent)`;
// The rim's hot core, as the shader's `rimHot`: the ball colour pulled toward white.
const hot = (color: string) => `color-mix(in srgb, ${color} 62%, white)`;

/**
 * The ball before (or without) WebGL: a sphere of the same size as the WebGL one, centred in the
 * same box, drawn the way its fragment shader lights it in the dark theme. The interior is clear
 * (the page's haze shows through), darkens toward a tinted edge, and holds a soft pool low down;
 * the rim is a thin bright line with a glow on both sides. The box itself is always full size, so
 * nothing around it moves when the canvas takes over.
 */
export function StaticBall({
  color,
  variant = 'desktop',
  className,
}: {
  color: string;
  variant?: BallVariant;
  className?: string;
}) {
  const size = `${Math.round(SIZE[variant] * 1000) / 10}%`;
  return (
    <div
      data-slot="static-ball"
      data-variant={variant}
      aria-hidden="true"
      className={cn('relative size-full', className)}
    >
      <div
        data-slot="static-sphere"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: size,
          height: size,
          background: [
            `radial-gradient(ellipse 64% 44% at 50% 100%, ${tint(color, 26)}, transparent)`,
            `radial-gradient(ellipse 60% 60% at 50% 40%, transparent 62%, ${tint(color, 10)})`,
          ].join(', '),
          boxShadow: [
            `inset 0 0 0 2px ${hot(color)}`,
            `0 0 0 2px ${hot(color)}`,
            `inset 0 0 12px 3px ${tint(color, 90)}`,
            `0 0 12px 3px ${tint(color, 90)}`,
            `inset 0 0 36px 4px ${tint(color, 28)}`,
            `0 0 28px 4px ${tint(color, 26)}`,
          ].join(', '),
        }}
      />
    </div>
  );
}
