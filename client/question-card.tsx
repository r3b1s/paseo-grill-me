import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { LockedQuestionCard } from "./locked-question-card";
import {
  answerGrillQuestionRpc,
  type GrillCardItemData,
  grillQueryKeys,
  parseOptionLabel,
} from "../shared/grill";

const INPUT_MIN_HEIGHT = 38;
const INPUT_MAX_HEIGHT = 140;

interface AutoGrowInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  placeholderTextColor: string;
  editable: boolean;
  style: StyleProp<TextStyle>;
}

/** Multiline input that wraps, accepts newlines, grows with content, and scrolls past a cap. */
function AutoGrowInput({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  editable,
  style,
}: AutoGrowInputProps) {
  const [height, setHeight] = useState(INPUT_MIN_HEIGHT);
  return (
    <TextInput
      multiline
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      editable={editable}
      onContentSizeChange={(event) => {
        const contentHeight = event.nativeEvent.contentSize?.height;
        if (typeof contentHeight === "number" && Number.isFinite(contentHeight)) {
          setHeight(Math.min(Math.max(contentHeight, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT));
        }
      }}
      style={[style, { height, textAlignVertical: "top" as const }]}
    />
  );
}

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
    });
  }, [theme, layout.compact]);

  if (status === "answered" || status === "superseded") {
    return (
      <LockedQuestionCard
        theme={theme}
        layout={layout}
        question={question}
        branch={branch}
        options={options}
        isMultiSelect={isMultiSelect}
        status={status}
        answer={answer}
      />
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
      options,
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
        {options.map((option, index) => {
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
              <Text style={styles.optionNumber}>{index + 1}.</Text>
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
        <AutoGrowInput
          style={styles.input}
          value={customText}
          onChangeText={setCustomText}
          placeholder="Enter your custom answer…"
          placeholderTextColor={theme.colors.foregroundMuted}
          editable={!mutation.isPending && !isSubmittedWaitingForDaemon}
        />
      ) : null}

      <AutoGrowInput
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
