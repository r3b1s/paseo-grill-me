import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import {
  answerGrillQuestionRpc,
  type GrillCardItemData,
  grillQueryKeys,
  parseOptionLabel,
} from "../shared/grill";

export function GrillQuestionCard({
  agentId,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<GrillCardItemData>) {
  const { cardId, questionId, question, branch, options, isMultiSelect, status, answer } =
    item.data;

  const answerRpc = useRpc(answerGrillQuestionRpc);
  const queryClient = useQueryClient();
  const toast = useToast();

  const [submittedCardId, setSubmittedCardId] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [customText, setCustomText] = useState("");
  const [note, setNote] = useState("");

  const isSubmittedWaitingForDaemon = submittedCardId === cardId;

  const mutation = useMutation({
    mutationFn: answerRpc,
    onSuccess: () => {
      setSubmittedCardId(cardId);
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
      cardOpen: {
        // Open questions get an accent border; locked cards keep the muted default.
        borderColor: theme.colors.accent,
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
      indicatorSelected: {
        color: theme.colors.accent,
      },
      indicatorMuted: {
        color: theme.colors.foregroundMuted,
        fontSize: 15,
        width: 18,
        textAlign: "center",
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

  if (status === "answered" || status === "superseded") {
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
          {options.map((option) => {
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
                style={[
                  styles.lockedOptionRow,
                  !isChosen && styles.lockedOptionRowUnchosen,
                ]}
              >
                <Text style={isChosen ? styles.indicator : styles.indicatorMuted}>
                  {indicator}
                </Text>
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
            {custom ? (
              <Text style={styles.readOnlyValue}>Other: {custom}</Text>
            ) : null}
            {noteText ? (
              <Text style={styles.readOnlyValue}>Note: {noteText}</Text>
            ) : null}
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

  function toggleOption(option: string) {
    if (isMultiSelect) {
      setSelectedOptions((prev) =>
        prev.includes(option) ? prev.filter((entry) => entry !== option) : [...prev, option],
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
  const submitDisabled =
    !canSubmit || mutation.isPending || isSubmittedWaitingForDaemon;

  function handleSubmit() {
    if (submitDisabled) return;
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
    <View style={[styles.card, styles.cardOpen]}>
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
          editable={!mutation.isPending && !isSubmittedWaitingForDaemon}
        />
      ) : null}

      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Add a note or context (optional)…"
        placeholderTextColor={theme.colors.foregroundMuted}
        editable={!mutation.isPending && !isSubmittedWaitingForDaemon}
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
        accessibilityState={{ disabled: submitDisabled }}
        disabled={submitDisabled}
        onPress={handleSubmit}
        style={[styles.submitButton, submitDisabled && styles.submitButtonDisabled]}
      >
        <Text style={styles.submitButtonText}>
          {mutation.isPending || isSubmittedWaitingForDaemon
            ? "Submitting…"
            : "Submit Answer"}
        </Text>
      </Pressable>
    </View>
  );
}
