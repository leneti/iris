import type { ReactNode } from 'react';
import { Canvas } from '@/components/tabs/canvas';
import { frameModel, type FrameModel } from '@/components/tabs/frame-model';
import { useFrames } from '@/components/tabs/use-frames';
import type { AddressMode } from '@/lib/client/address';
import type { TabsState } from '@/lib/client/tabs';
import type { ServiceEntry, ServiceStatus } from '@/lib/shared/contract';

export function tabsOf(open: string[], active: string | null, live = open): TabsState {
  return { open, active, lru: active ? [active, ...open.filter((x) => x !== active)] : open, live };
}

export type HarnessProps = {
  tabs: TabsState;
  services: ServiceEntry[];
  mode?: AddressMode;
  hostname?: string;
  protocol?: string;
  alwaysNewTab?: Record<string, boolean>;
  statusById?: Record<string, ServiceStatus>;
  onCheckAgain?: () => void;
  onAlwaysNewTab?: (id: string, on: boolean) => void;
  children?: ReactNode;
};

/** The Canvas wired to the real useFrames, as AppShell wires it. */
export function CanvasHarness({
  tabs,
  services,
  mode = 'lan',
  hostname = '127.0.0.1',
  protocol = 'http:',
  alwaysNewTab = {},
  statusById = {},
  onCheckAgain = () => {},
  onAlwaysNewTab = () => {},
  children,
}: HarnessProps) {
  const frames = useFrames(tabs.live);
  const models = new Map<string, FrameModel>(
    services.map((s) => [
      s.id,
      frameModel(s, { mode, hostname, protocol, alwaysNewTab: alwaysNewTab[s.id] === true }),
    ]),
  );
  return (
    <Canvas
      tabs={tabs}
      models={models}
      statusById={statusById}
      alwaysNewTab={alwaysNewTab}
      frames={frames}
      onCheckAgain={onCheckAgain}
      onAlwaysNewTab={onAlwaysNewTab}
    >
      {children}
    </Canvas>
  );
}
