import { Clapperboard, Download, House, Server, Workflow, type LucideIcon } from 'lucide-react';

const GROUP_ICONS: Record<string, LucideIcon> = {
  clapperboard: Clapperboard,
  workflow: Workflow,
  download: Download,
  server: Server,
  house: House,
};

export function groupIcon(icon: string | null): LucideIcon | null {
  return GROUP_ICONS[icon?.replace(/^lucide:/, '') ?? ''] ?? null;
}

export const COLLAPSED_GROUPS_PREF = 'sidebar.collapsedGroups';
