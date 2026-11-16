import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  answerGrillQuestionRpc,
  getGrillStateRpc,
  grillQueryKeys,
  parseOptionLabel,
  readGrillState,
  type GrillQuestionAnswer,
  type GrillQuestionItemData,
} from "../shared/grill";

export function GrillQuestionCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<GrillQuestionItemData>) {
  const { questionId, toolStatus, question, branch, options, isMultiSelect } = item.data;

  const getState = useRpc(getGrillStateRpc);
  const answerRpc = useRpc(answerGrillQuestionRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [submitted, setSubmitted] = useState<GrillQuestionAnswer | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [customText, setCustomText] = useState("");
  const [note, setNote] = useState("");

  const stateQuery = useQuery({
    queryKey: grillQueryKeys.state(agentId),
    queryFn: () => getState({ agentId }),
    refetchInterval: (query) => {
      if (submitted) return false;
      const current = readGrillState(query.state.data);
      if (current.answers[questionId]) return false;
      // The agent moved on to another question: this card was superseded, stop polling.
      const pending = current.pendingQuestion;
      if (pending && pending.questionId !== questionId) return false;
      return 2500;
    },
    staleTime: 1000,
  });

  const state = readGrillState(stateQuery.data);
  const answer = submitted ?? state.answers[questionId];

  const mutation = useMutation({
    mutationFn: answerRpc,
    onSuccess: (_data, variables) => {
      setSubmitted({
        selectedOptions: variables.selectedOptions,
        ...(variables.customText ? { customText: variables.customText } : {}),
        ...(variables.note ? { note: variables.note } : {}),
        answeredVia: "card",
        answeredAt: new Date().toISOString(),
      });
      void queryClient.invalidateQueries({ queryKey: grillQueryKeys.state(agentId) });
      void queryClient.invalidateQueries({ queryKey: grillQueryKeys.pending() });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Failed to submit answer");
    },
  });

  const styles = useMemo(() => {
    const pad = layout.compact ? 10 : 14;
    const gap = layout.compact ? 8 : 10;
    return StyleSheet.create({
      card: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: pad,
        gap,
      },
      mutedCard: {
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: pad,
        paddingVertical: layout.compact ? 8 : 10,
      },
      mutedText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
      headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 6,
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
      hintText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
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
      optionRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: layout.compact ? 10 : 12,
        paddingVertical: layout.compact ? 8 : 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      optionRowSelected: {
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.surface2,
      },
      indicator: {
        color: theme.colors.foreground,
        fontSize: 15,
        width: 18,
        textAlign: "center",
      },
      indicatorSelected: {
        color: theme.colors.accent,
      },
      optionLabel: {
        color: theme.colors.foreground,
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
      input: {
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      submitButton: {
        backgroundColor: theme.colors.accent,
        borderRadius: 8,
        paddingVertical: layout.compact ? 9 : 10,
        paddingHorizontal: 14,
        alignItems: "center",
        justifyContent: "center",
      },
      submitButtonDisabled: {
        opacity: 0.45,
      },
      submitButtonText: {
        color: theme.colors.accentForeground,
        fontSize: 14,
        fontWeight: "600",
      },
      errorText: {
        color: theme.colors.statusDanger,
        fontSize: 13,
      },
      answeredBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
      },
      answeredBadgeText: {
        color: theme.colors.statusSuccess,
        fontSize: 12,
        fontWeight: "600",
      },
      summaryBody: {
        gap: 4,
      },
      summaryItem: {
        color: theme.colors.foreground,
        fontSize: 13,
      },
      summaryMeta: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
      },
    });
  }, [theme, layout.compact]);

  if ((toolStatus === "failed" || toolStatus === "canceled") && !answer) {
    return (
      <View style={styles.mutedCard}>
        <Text style={styles.mutedText}>
          Question could not be presented (tool call {toolStatus}).
        </Text>
      </View>
    );
  }

  if (answer) {
    const cleanSelections = answer.selectedOptions.map((opt) => parseOptionLabel(opt).label);
    const hasSelections = cleanSelections.length > 0;
    const hasCustom = Boolean(answer.customText && answer.customText.trim().length > 0);
    const hasNote = Boolean(answer.note && answer.note.trim().length > 0);

    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          {branch ? (
            <View style={styles.branchPill}>
              <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
              <Text style={styles.branchText}>{branch}</Text>
            </View>
          ) : (
            <View />
          )}
          <View style={styles.answeredBadge}>
            <Icon name="Check" size={14} color={theme.colors.statusSuccess} />
            <Text style={styles.answeredBadgeText}>Answered</Text>
          </View>
        </View>

        <Text style={styles.questionText}>{question}</Text>

        <View style={styles.summaryBody}>
          {hasSelections
            ? cleanSelections.map((label, idx) => (
                <Text key={`${idx}-${label}`} style={styles.summaryItem}>
                  • {label}
                </Text>
              ))
            : null}
          {hasCustom ? (
            <Text style={styles.summaryItem}>• Other: {answer.customText}</Text>
          ) : null}
          {!hasSelections && !hasCustom && answer.answeredVia === "composer" ? (
            <Text style={styles.summaryMeta}>Answered in chat</Text>
          ) : null}
          {hasNote ? <Text style={styles.summaryMeta}>Note: {answer.note}</Text> : null}
        </View>
      </View>
    );
  }

  function toggleOption(option: string) {
    if (isMultiSelect) {
      setSelectedOptions((prev) =>
        prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option],
      );
    } else {
      setSelectedOptions([option]);
      setOtherSelected(false);
    }
  }

  function toggleOther() {
    if (isMultiSelect) {
      setOtherSelected((prev) => !prev);
    } else {
      setSelectedOptions([]);
      setOtherSelected(true);
    }
  }

  const trimmedCustom = customText.trim();
  const trimmedNote = note.trim();
  const canSubmit =
    selectedOptions.length > 0 || (otherSelected && trimmedCustom.length > 0);

  function handleSubmit() {
    if (!canSubmit || mutation.isPending) return;
    mutation.mutate({
      agentId,
      questionId,
      question,
      ...(branch ? { branch } : {}),
      selectedOptions,
      ...(otherSelected && trimmedCustom.length > 0 ? { customText: trimmedCustom } : {}),
      ...(trimmedNote.length > 0 ? { note: trimmedNote } : {}),
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        {branch ? (
          <View style={styles.branchPill}>
            <Icon name="GitBranch" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.branchText}>{branch}</Text>
          </View>
        ) : (
          <View />
        )}
        <Text style={styles.hintText}>
          {isMultiSelect ? "Select all that apply" : "Select one"}
        </Text>
      </View>

      <Text style={styles.questionText}>{question}</Text>

      <View style={styles.optionsList}>
        {options.map((option) => {
          const isSelected = selectedOptions.includes(option);
          const { label, recommended } = parseOptionLabel(option);
          const indicator = isMultiSelect
            ? isSelected
              ? "☑"
              : "☐"
            : isSelected
              ? "●"
              : "○";

          return (
            <Pressable
              key={option}
              accessibilityRole={isMultiSelect ? "checkbox" : "radio"}
              accessibilityState={{ checked: isSelected }}
              onPress={() => toggleOption(option)}
              style={[styles.optionRow, isSelected && styles.optionRowSelected]}
            >
              <Text style={[styles.indicator, isSelected && styles.indicatorSelected]}>
                {indicator}
              </Text>
              <Text style={styles.optionLabel}>{label}</Text>
              {recommended ? (
                <View style={styles.recommendedPill}>
                  <Text style={styles.recommendedText}>Recommended</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole={isMultiSelect ? "checkbox" : "radio"}
          accessibilityState={{ checked: otherSelected }}
          onPress={toggleOther}
          style={[styles.optionRow, otherSelected && styles.optionRowSelected]}
        >
          <Text style={[styles.indicator, otherSelected && styles.indicatorSelected]}>
            {isMultiSelect ? (otherSelected ? "☑" : "☐") : otherSelected ? "●" : "○"}
          </Text>
          <Text style={styles.optionLabel}>Other (custom answer)…</Text>
        </Pressable>
      </View>

      {otherSelected ? (
        <TextInput
          style={styles.input}
          value={customText}
          onChangeText={setCustomText}
          placeholder="Enter your custom answer…"
          placeholderTextColor={theme.colors.foregroundMuted}
          editable={!mutation.isPending}
        />
      ) : null}

      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Add a note or context (optional)…"
        placeholderTextColor={theme.colors.foregroundMuted}
        editable={!mutation.isPending}
      />

      {mutation.error ? (
        <Text style={styles.errorText}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : String(mutation.error)}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit || mutation.isPending }}
        disabled={!canSubmit || mutation.isPending}
        onPress={handleSubmit}
        style={[
          styles.submitButton,
          (!canSubmit || mutation.isPending) && styles.submitButtonDisabled,
        ]}
      >
        <Text style={styles.submitButtonText}>
          {mutation.isPending ? "Submitting…" : "Submit Answer"}
        </Text>
      </Pressable>
    </View>
  );
}
