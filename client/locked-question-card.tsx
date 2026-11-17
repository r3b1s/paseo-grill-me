import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { type GrillQuestionAnswer, parseOptionLabel } from "../shared/grill";

interface LockedQuestionCardProps {
  theme: PluginTheme;
  layout: { compact: boolean };
  question: string;
  branch?: string;
  options: string[];
  isMultiSelect: boolean;
  status: "answered" | "superseded";
  answer?: GrillQuestionAnswer;
}

/**
 * The read-only card shown once a question is answered or superseded. Used by the appended
 * timeline card while its row is still live and by the tool-call stub after a restart.
 */
export function LockedQuestionCard({
  theme,
  layout,
  question,
  branch,
  options,
  isMultiSelect,
  status,
  answer,
}: LockedQuestionCardProps) {
  const styles = useMemo(() => {
    return StyleSheet.create({
      card: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: layout.compact ? 10 : 14,
        gap: layout.compact ? 8 : 10,
      },
      headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 6,
      },
      headerLeft: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexShrink: 1,
      },
      branchPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      },
      branchText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "500",
      },
      questionText: {
        color: theme.colors.foreground,
        fontSize: 15,
        fontWeight: "600",
        lineHeight: 21,
      },
      optionsList: {
        gap: 6,
      },
      lockedOptionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: layout.compact ? 7 : 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      lockedOptionRowUnchosen: {
        opacity: 0.7,
      },
      indicator: {
        color: theme.colors.foreground,
        fontSize: 15,
        width: 18,
        textAlign: "center",
      },
      indicatorMuted: {
        color: theme.colors.foregroundMuted,
        fontSize: 15,
        width: 18,
        textAlign: "center",
      },
      optionNumber: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        fontVariant: ["tabular-nums"],
      },
      optionLabel: {
        color: theme.colors.foreground,
        fontSize: 14,
        flex: 1,
      },
      optionLabelMuted: {
        color: theme.colors.foregroundMuted,
        fontSize: 14,
        flex: 1,
      },
      recommendedPill: {
        backgroundColor: theme.colors.accent,
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 2,
      },
      recommendedText: {
        color: theme.colors.accentForeground,
        fontSize: 11,
        fontWeight: "600",
      },
      statusBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      },
      answeredBadgeText: {
        color: theme.colors.statusSuccess,
        fontSize: 12,
        fontWeight: "600",
      },
      skippedBadgeText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500",
      },
      readOnlyMeta: {
        gap: 4,
      },
      readOnlyLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
      readOnlyValue: {
        color: theme.colors.foreground,
        fontSize: 13,
      },
      composerQuote: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontStyle: "italic",
      },
    });
  }, [theme, layout.compact]);

  const isSuperseded = status === "superseded";
  const chosenSet = new Set(isSuperseded ? [] : answer?.selectedOptions ?? []);
  const custom = answer?.customText?.trim();
  const noteText = answer?.note?.trim();
  const composerQuote = answer?.composerText?.trim();

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Icon name="Lock" size={13} color={theme.colors.foregroundMuted} />
          {branch ? (
            <View style={styles.branchPill}>
              <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
              <Text style={styles.branchText}>{branch}</Text>
            </View>
          ) : null}
        </View>

        {isSuperseded ? (
          <View style={styles.statusBadge}>
            <Icon name="SkipForward" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.skippedBadgeText}>Skipped</Text>
          </View>
        ) : (
          <View style={styles.statusBadge}>
            <Icon name="Check" size={14} color={theme.colors.statusSuccess} />
            <Text style={styles.answeredBadgeText}>Answered</Text>
          </View>
        )}
      </View>

      <Text style={styles.questionText}>{question}</Text>

      {isSuperseded ? (
        <Text style={styles.readOnlyLabel}>Superseded by a newer question</Text>
      ) : null}

      <View style={styles.optionsList}>
        {options.map((option, index) => {
          const isChosen = chosenSet.has(option);
          const { label, recommended } = parseOptionLabel(option);
          const indicator = isMultiSelect
            ? isChosen
              ? "☑"
              : "☐"
            : isChosen
              ? "●"
              : "○";

          return (
            <View
              key={option}
              style={[styles.lockedOptionRow, !isChosen && styles.lockedOptionRowUnchosen]}
            >
              <Text style={isChosen ? styles.indicator : styles.indicatorMuted}>
                {indicator}
              </Text>
              <Text style={styles.optionNumber}>{index + 1}.</Text>
              <Text style={isChosen ? styles.optionLabel : styles.optionLabelMuted}>
                {label}
              </Text>
              {recommended ? (
                <View style={styles.recommendedPill}>
                  <Text style={styles.recommendedText}>Recommended</Text>
                </View>
              ) : null}
              {isChosen ? (
                <Icon name="Check" size={14} color={theme.colors.statusSuccess} />
              ) : null}
            </View>
          );
        })}
      </View>

      {!isSuperseded && (custom || noteText || answer?.answeredVia === "composer") ? (
        <View style={styles.readOnlyMeta}>
          {custom ? <Text style={styles.readOnlyValue}>Other: {custom}</Text> : null}
          {noteText ? <Text style={styles.readOnlyValue}>Note: {noteText}</Text> : null}
          {answer?.answeredVia === "composer" ? (
            <View style={{ gap: 2 }}>
              <Text style={styles.readOnlyLabel}>Answered in chat:</Text>
              {composerQuote ? (
                <Text style={styles.composerQuote}>{composerQuote}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
