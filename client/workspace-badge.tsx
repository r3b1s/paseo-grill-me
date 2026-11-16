import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  type PluginClientContext,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import * as ui from "@getpaseo/plugin/client/ui";
import {
  grillQueryKeys,
  grillSettings,
  listPendingQuestionsRpc,
} from "../shared/grill";

export interface GrillWorkspaceRowBadgeItemProps {
  theme: PluginTheme;
  host: { id: string; label: string };
  layout: { compact: boolean; platform: "ios" | "android" | "web" };
  workspaceId: string;
}

interface WorkspaceRowBadgeProps {
  icon?: string;
  label?: string;
  tone?: "muted" | "success" | "warning" | "danger" | "info";
  accessibilityLabel?: string;
}

const WorkspaceRowBadge = (
  ui as unknown as { WorkspaceRowBadge?: ComponentType<WorkspaceRowBadgeProps> }
).WorkspaceRowBadge;

export function GrillWorkspaceBadge({ workspaceId }: GrillWorkspaceRowBadgeItemProps) {
  const settings = useSettings(grillSettings);
  const listPending = useRpc(listPendingQuestionsRpc);
  const pendingQuery = useQuery({
    queryKey: grillQueryKeys.pending(),
    queryFn: () => listPending({}),
    refetchInterval: 4000,
  });

  if (!WorkspaceRowBadge) return null;
  if (settings.status === "ready" && !settings.values.showWorkspaceBadge) return null;

  const hasPending =
    pendingQuery.data?.pending.some((entry) => entry.workspaceId === workspaceId) ?? false;
  if (!hasPending) return null;

  return (
    <WorkspaceRowBadge
      icon="HelpCircle"
      label="Question"
      tone="warning"
      accessibilityLabel="Agent waiting on a Grill-Me question"
    />
  );
}

type AddWorkspaceRowBadgeItemFn = (contribution: {
  id: string;
  title: string;
  icon: string;
  Component: ComponentType<GrillWorkspaceRowBadgeItemProps>;
}) => () => void;

export function registerWorkspaceBadge(client: PluginClientContext): (() => void) | null {
  const addWorkspaceRowBadgeItem = (
    client as unknown as { addWorkspaceRowBadgeItem?: AddWorkspaceRowBadgeItemFn }
  ).addWorkspaceRowBadgeItem;

  if (typeof addWorkspaceRowBadgeItem !== "function") return null;

  return addWorkspaceRowBadgeItem.call(client, {
    id: "pending-question",
    title: "Grill-Me Question",
    icon: "HelpCircle",
    Component: GrillWorkspaceBadge,
  });
}
