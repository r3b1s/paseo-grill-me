import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import {
  getGrillStateRpc,
  grillQueryKeys,
  type GrillStubItemData,
  parseOptionLabel,
  readGrillState,
} from "../shared/grill";

export function GrillQuestionStub({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<GrillStubItemData>) {
  const { questionId, toolStatus, question, branch } = item.data;
  const toolFailedOrCanceled = toolStatus === "failed" || toolStatus === "canceled";

  const getState = useRpc(getGrillStateRpc);
  const stateQuery = useQuery({
    queryKey: grillQueryKeys.state(agentId),
    queryFn: () => getState({ agentId }),
    refetchInterval: (query) => {
      if (toolFailedOrCanceled) return false;
      const current = readGrillState(query.state.data);
      if (current.answers[questionId]) return false;
      // Poll only while this question can still change: the tool is running or it is pending.
      // Old stubs with no recorded state (history, pruned answers) stay quiet.
      if (toolStatus === "running") return 3000;
      return current.pendingQuestion?.questionId === questionId ? 3000 : false;
    },
    staleTime: 1000,
  });

  const styles = useMemo(() => {
    return StyleSheet.create({
      row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: layout.compact ? 2 : 4,
      },
      text: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        flex: 1,
      },
    });
  }, [theme, layout.compact]);

  const state = readGrillState(stateQuery.data);
  const answer = state.answers[questionId];

  let iconName = "MessageCircleQuestion";
  let iconColor = theme.colors.foregroundMuted;
  let lineText: string;

  if (answer?.answeredVia === "card") {
    iconName = "Check";
    iconColor = theme.colors.statusSuccess;
    const labels = answer.selectedOptions.map((opt) => parseOptionLabel(opt).label);
    const custom = answer.customText?.trim();
    const parts = [...labels];
    if (custom) {
      parts.push(`Other: ${custom}`);
    }
    lineText = parts.length > 0 ? `Answered: ${parts.join(", ")}` : "Answered";
  } else if (answer?.answeredVia === "composer") {
    iconName = "Check";
    iconColor = theme.colors.statusSuccess;
    lineText = "Answered in chat";
  } else if (answer?.answeredVia === "superseded") {
    iconName = "SkipForward";
    iconColor = theme.colors.foregroundMuted;
    lineText = "Skipped: superseded by a newer question";
  } else if (toolFailedOrCanceled) {
    iconName = "MessageCircleQuestion";
    iconColor = theme.colors.foregroundMuted;
    lineText = `Question could not be presented (tool call ${toolStatus})`;
  } else {
    iconName = "MessageCircleQuestion";
    iconColor = theme.colors.foregroundMuted;
    lineText = branch ? `[${branch}] Asked: ${question}` : `Asked: ${question}`;
  }

  return (
    <View style={styles.row}>
      <Icon name={iconName} size={14} color={iconColor} />
      <Text numberOfLines={1} style={styles.text}>
        {lineText}
      </Text>
    </View>
  );
}
