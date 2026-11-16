import type { PluginCleanup } from "@getpaseo/plugin";
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GrillQuestionCard } from "./client/question-card";
import { GrillQuestionStub } from "./client/question-stub";
import { GrillSettingsScreen } from "./client/settings-screen";
import { transformQuestion } from "./client/transform-question";
import { registerWorkspaceBadge } from "./client/workspace-badge";
import {
  GRILL_CARD_ITEM_KIND,
  GRILL_CARD_ITEM_VERSION,
  GRILL_STUB_ITEM_KIND,
  GRILL_STUB_ITEM_VERSION,
  GrillCardItemSchema,
  GrillStubItemSchema,
  startGrillRpc,
} from "./shared/grill";

export default function contribute(client: PluginClientContext): PluginCleanup {
  const cleanups: PluginCleanup[] = [];

  cleanups.push(
    client.addTimelineTransformer({
      id: "grill-question",
      query: { itemType: "tool_call" },
      transform: transformQuestion,
    }),
  );

  cleanups.push(
    client.addTimelineRenderer({
      kind: GRILL_STUB_ITEM_KIND,
      version: GRILL_STUB_ITEM_VERSION,
      schema: GrillStubItemSchema,
      Component: GrillQuestionStub,
    }),
  );

  cleanups.push(
    client.addTimelineRenderer({
      kind: GRILL_CARD_ITEM_KIND,
      version: GRILL_CARD_ITEM_VERSION,
      schema: GrillCardItemSchema,
      Component: GrillQuestionCard,
    }),
  );

  cleanups.push(
    client.addSlashCommand({
      name: "grill-me",
      description: "Interview me about this task, one question at a time",
      argumentHint: "[topic]",
      context: "agent",
      onSubmit: async ({ args, agent, rpc }) => {
        await rpc(startGrillRpc, { agentId: agent.id, args });
      },
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "start-interview",
      title: "Grill-Me: Start design interview",
      icon: "MessageCircleQuestion",
      keywords: ["grill", "interview", "design", "questions"],
      context: "agent",
      onSelect: async ({ agent, rpc }) => {
        await rpc(startGrillRpc, { agentId: agent.id, args: "" });
      },
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "open-settings",
      title: "Grill-Me: Settings",
      icon: "Settings",
      context: "global",
      onSelect: ({ openSettings }) => {
        openSettings("grill-me");
      },
    }),
  );

  cleanups.push(
    client.addSettingsScreen({
      id: "grill-me",
      title: "Grill-Me",
      icon: "MessageCircleQuestion",
      Component: GrillSettingsScreen,
    }),
  );

  const badgeCleanup = registerWorkspaceBadge(client);
  if (badgeCleanup) {
    cleanups.push(badgeCleanup);
  }

  return () => {
    for (const cleanup of cleanups) {
      void cleanup();
    }
  };
}
