/** The ball without WebGL: a lit circle in the ball's colour. */
export function StaticBall({ color, className }: { color: string; className?: string }) {
  return (
    <div
      data-slot="static-ball"
      aria-hidden="true"
      className={['size-full rounded-full', className].filter(Boolean).join(' ')}
      style={{
        background: `radial-gradient(circle at 35% 30%, ${color} 0%, color-mix(in srgb, ${color} 55%, transparent) 45%, transparent 72%)`,
        boxShadow: `0 0 80px 12px color-mix(in srgb, ${color} 25%, transparent)`,
      }}
    />
  );
}
