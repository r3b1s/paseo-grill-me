import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  copyText,
  Loading,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import {
  composeGrillPrompt,
  DEFAULT_GRILL_SETTINGS,
  grillSettings,
} from "../shared/grill";

const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "monospace",
});

export function GrillSettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(grillSettings);
  const toast = useToast();

  const [draftTemplate, setDraftTemplate] = useState(DEFAULT_GRILL_SETTINGS.promptTemplate);
  const [draftCustom, setDraftCustom] = useState(DEFAULT_GRILL_SETTINGS.customInstructions);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [previewTopic, setPreviewTopic] = useState("");

  const isReady = settings.status === "ready";
  const savedTemplate = isReady ? settings.values.promptTemplate : "";
  const savedCustom = isReady ? settings.values.customInstructions : "";
  const savedRevision = isReady ? settings.revision : null;

  const dirty =
    isReady &&
    draftRevision !== null &&
    (draftTemplate !== savedTemplate || draftCustom !== savedCustom);

  useEffect(() => {
    if (!isReady || savedRevision === null) return;
    if (draftRevision === null || (!dirty && draftRevision !== savedRevision)) {
      setDraftTemplate(savedTemplate);
      setDraftCustom(savedCustom);
      setDraftRevision(savedRevision);
    }
  }, [isReady, savedRevision, savedTemplate, savedCustom, draftRevision, dirty]);

  const styles = useMemo(() => {
    const pad = layout.compact ? 10 : 12;
    return StyleSheet.create({
      container: {
        gap: 16,
      },
      textArea: {
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: pad,
        color: theme.colors.foreground,
        fontFamily: MONO_FONT,
        fontSize: 13,
        textAlignVertical: "top",
      },
      templateInput: {
        minHeight: 200,
      },
      customInput: {
        minHeight: 100,
      },
      topicInput: {
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: pad,
        paddingVertical: 8,
        color: theme.colors.foreground,
        fontSize: 14,
      },
      previewBox: {
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: pad,
      },
      previewText: {
        color: theme.colors.foreground,
        fontFamily: MONO_FONT,
        fontSize: 12,
        lineHeight: 18,
      },
      errorText: {
        color: theme.colors.statusDanger,
        fontSize: 13,
      },
      mutedText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
    });
  }, [theme, layout.compact]);

  if (settings.status === "loading") {
    return <Loading />;
  }

  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Grill-Me Settings">
        <SettingsCard>
          <SettingsRow label="Failed to load settings">
            <Text style={styles.errorText}>{settings.error}</Text>
          </SettingsRow>
          <SettingsAction
            label="Reload"
            actionLabel="Reload"
            onPress={() => {
              void settings.reload();
            }}
          />
          <SettingsAction
            label="Reset to defaults"
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={() => {
              void settings.reset();
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }

  const templateBlank = draftTemplate.trim().length === 0;
  const previewPrompt = composeGrillPrompt(
    { promptTemplate: draftTemplate, customInstructions: draftCustom },
    previewTopic,
  );

  async function handleSave() {
    if (settings.status !== "ready" || templateBlank || !dirty) return;
    const ok = await settings.save(
      {
        ...settings.values,
        promptTemplate: draftTemplate,
        customInstructions: draftCustom,
      },
      // Merged onto the latest saved values, so use the latest revision. The draft revision
      // would make our own badge toggle look like a conflicting write.
      settings.revision,
    );
    if (ok) {
      toast.show("Settings saved", { variant: "success" });
    }
  }

  function handleDiscard() {
    if (settings.status !== "ready") return;
    setDraftTemplate(settings.values.promptTemplate);
    setDraftCustom(settings.values.customInstructions);
    setDraftRevision(settings.revision);
  }

  async function handleReset() {
    const ok = await settings.reset();
    if (ok) {
      setDraftTemplate(DEFAULT_GRILL_SETTINGS.promptTemplate);
      setDraftCustom(DEFAULT_GRILL_SETTINGS.customInstructions);
      setDraftRevision(null);
      toast.show("Reset to defaults", { variant: "success" });
    }
  }

  async function handleCopyPreview() {
    try {
      await copyText(previewPrompt);
      toast.show("Copied raw prompt", { variant: "success" });
    } catch {
      toast.error("Could not copy raw prompt");
    }
  }

  return (
    <View style={styles.container}>
      <SettingsSection title="Behavior">
        <SettingsCard>
          <SettingsSwitch
            label="Show sidebar workspace badge"
            hint="Only appears on Paseo apps that support workspace row badges."
            value={settings.values.showWorkspaceBadge}
            disabled={settings.saving}
            onValueChange={(value) => {
              void settings.save(
                { ...settings.values, showWorkspaceBadge: value },
                settings.revision,
              );
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Prompt configuration">
        <SettingsCard>
          <SettingsRow
            label="Prompt template"
            error={templateBlank ? "Prompt template cannot be empty." : null}
          >
            <TextInput
              multiline
              style={[styles.textArea, styles.templateInput]}
              value={draftTemplate}
              onChangeText={setDraftTemplate}
              placeholder="Enter prompt template…"
              placeholderTextColor={theme.colors.foregroundMuted}
              editable={!settings.saving}
            />
          </SettingsRow>

          <SettingsRow
            label="Additional custom instructions"
            hint="Appended after the prompt template when non-empty."
          >
            <TextInput
              multiline
              style={[styles.textArea, styles.customInput]}
              value={draftCustom}
              onChangeText={setDraftCustom}
              placeholder="Optional custom instructions…"
              placeholderTextColor={theme.colors.foregroundMuted}
              editable={!settings.saving}
            />
          </SettingsRow>

          {settings.saveError ? (
            <SettingsRow label="Save error">
              <Text style={styles.errorText}>{settings.saveError}</Text>
            </SettingsRow>
          ) : null}

          <SettingsAction
            label="Save prompt configuration"
            actionLabel={settings.saving ? "Saving…" : "Save"}
            disabled={!dirty || templateBlank || settings.saving}
            onPress={() => {
              void handleSave();
            }}
          />
          <SettingsAction
            label="Discard changes"
            actionLabel="Discard"
            disabled={!dirty || settings.saving}
            onPress={handleDiscard}
          />
          <SettingsAction
            label="Reset to defaults"
            actionLabel="Reset"
            disabled={settings.saving}
            onPress={() => {
              void handleReset();
            }}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Raw prompt preview"
        trailing={
          dirty ? <Text style={styles.mutedText}>(includes unsaved changes)</Text> : undefined
        }
      >
        <SettingsCard>
          <SettingsRow
            label="Preview topic"
            hint="Leave empty to preview the no-arguments /grill-me prompt."
          >
            <TextInput
              style={styles.topicInput}
              value={previewTopic}
              onChangeText={setPreviewTopic}
              placeholder="Optional topic for /grill-me <topic>…"
              placeholderTextColor={theme.colors.foregroundMuted}
            />
          </SettingsRow>

          <SettingsRow label="Composed prompt">
            <View style={styles.previewBox}>
              <Text selectable style={styles.previewText}>
                {previewPrompt}
              </Text>
            </View>
          </SettingsRow>

          <SettingsAction
            label="Copy raw prompt"
            actionLabel="Copy"
            onPress={() => {
              void handleCopyPreview();
            }}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
