import { cn } from '@/lib/utils';
import type { ServiceStatus } from '@/lib/shared/contract';

const COLOR: Record<ServiceStatus, string> = {
  healthy: 'text-status-healthy',
  starting: 'text-status-starting',
  degraded: 'text-status-degraded',
  unhealthy: 'text-status-unhealthy',
  stopped: 'text-status-stopped',
  unknown: 'text-status-unknown',
};

function Shape({ status }: { status: ServiceStatus }) {
  switch (status) {
    case 'healthy':
      return <circle cx="7" cy="7" r="5" fill="currentColor" />;
    case 'starting':
      // Three quarters of a ring, open at the upper right.
      return (
        <path
          d="M7 2a5 5 0 1 0 5 5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="butt"
        />
      );
    case 'degraded':
      return <path d="M7 1.5 13 12.5H1Z" fill="currentColor" strokeLinejoin="round" />;
    case 'unhealthy':
      return <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />;
    case 'stopped':
      return <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" />;
    case 'unknown':
      return (
        <circle
          cx="7"
          cy="7"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray="2.2 2"
        />
      );
  }
}

/** One of six shapes, each with its own colour token, so the status reads without colour. */
export function HealthMark({
  status,
  size = 11,
  className,
}: {
  status: ServiceStatus;
  size?: 11 | 14;
  className?: string;
}) {
  return (
    <svg
      role="img"
      aria-label={status}
      data-status={status}
      width={size}
      height={size}
      viewBox="0 0 14 14"
      className={cn('shrink-0', COLOR[status], className)}
    >
      <Shape status={status} />
    </svg>
  );
}
