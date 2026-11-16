import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ASK_QUESTION_TOOL_NAME = "paseo_ask_question";
export const GRILL_QUESTION_ITEM_KIND = "grill-question";
export const GRILL_QUESTION_ITEM_VERSION = 1;
export const RECOMMENDED_PREFIX = "(Recommended) ";

export const DEFAULT_GRILL_PROMPT_TEMPLATE = `<GRILL_ME>
The user has requested that you interview them about every aspect of their task until you have reached a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Guidelines:
- Ask the questions one at a time. Never ask multiple questions in a single turn.
- If a question can be answered by exploring the codebase, explore the codebase instead of asking the user.
- Always use the \`paseo_ask_question\` tool to ask your question. Put your recommended option first, prefixed with \`(Recommended) \`, and include a short \`branch\` label showing which part of the design tree you are resolving (e.g. "Architecture > Storage").
- After calling \`paseo_ask_question\`, end your turn immediately without repeating the question or options in plain text, and wait for the user's answer.
- Once all branches of the design tree are resolved and you have reached a shared understanding, output a concise Design Summary of all resolved decisions in chat, and call \`paseo_ask_question\` one final time asking how the user wants to proceed:
  1. "(Recommended) Proceed with implementation now"
  2. "Save the design spec / plan to a Markdown file"
  3. "Keep refining the design"
</GRILL_ME>`;

export const DEFAULT_TOPIC =
  "Interview me about the task or design we are currently discussing in this session (or ask what I want to design if we haven't started yet).";

// ---------------------------------------------------------------------------
// Tool input
// ---------------------------------------------------------------------------

export const AskQuestionInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .describe(
      "The single question to ask the user. Do not include 'select all that apply' or numbered lists.",
    ),
  branch: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Optional design tree branch or category path being resolved (e.g. 'Architecture > Data Model').",
    ),
  options: z
    .array(z.string().trim().min(1))
    .min(2)
    .max(10)
    .describe(
      "Choices for the user, unnumbered and without an 'Other' option (the UI adds 'Other' automatically). Put your recommended option first, prefixed with '(Recommended) '.",
    ),
  is_multi_select: z
    .boolean()
    .optional()
    .default(false)
    .describe("Set to true if the user can select multiple options."),
});

export type AskQuestionInput = z.output<typeof AskQuestionInputSchema>;

// ---------------------------------------------------------------------------
// Per-agent interview state
//
// Paseo 0.15.4 has no agent metadata, so the daemon-side plugin process persists this state
// in a JSON file and serves it through `getGrillStateRpc` / `listPendingQuestionsRpc`.
// ---------------------------------------------------------------------------

export const GrillQuestionAnswerSchema = z.object({
  selectedOptions: z.array(z.string()),
  customText: z.string().optional(),
  note: z.string().optional(),
  answeredVia: z.enum(["card", "composer"]),
  answeredAt: z.string(),
});

export type GrillQuestionAnswer = z.output<typeof GrillQuestionAnswerSchema>;

export const GrillPendingQuestionSchema = z.object({
  questionId: z.string(),
  question: z.string(),
  branch: z.string().optional(),
  options: z.array(z.string()),
  isMultiSelect: z.boolean(),
  askedAt: z.string(),
});

export type GrillPendingQuestion = z.output<typeof GrillPendingQuestionSchema>;

export const GrillAgentStateSchema = z.object({
  pendingQuestion: GrillPendingQuestionSchema.nullable().default(null),
  answers: z.record(z.string(), GrillQuestionAnswerSchema).default({}),
});

export type GrillAgentState = z.output<typeof GrillAgentStateSchema>;

export function emptyGrillState(): GrillAgentState {
  return { pendingQuestion: null, answers: {} };
}

/** Parses an unknown value as agent state, returning an empty state when absent or invalid. */
export function readGrillState(raw: unknown): GrillAgentState {
  if (raw === undefined || raw === null) return emptyGrillState();
  const parsed = GrillAgentStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyGrillState();
}

// ---------------------------------------------------------------------------
// Deterministic question id (shared by the server tool and the client transformer)
// ---------------------------------------------------------------------------

function fnv1a32(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Computes a stable id from the trimmed question, branch, and options. The client transformer
 * sees the raw tool input, so normalization (trim) happens here rather than relying on Zod.
 */
export function computeQuestionId(input: {
  question: string;
  branch?: string | null;
  options: readonly string[];
}): string {
  const branch = input.branch?.trim() ?? "";
  const canonical = JSON.stringify([
    input.question.trim(),
    branch.length > 0 ? branch : null,
    input.options.map((option) => option.trim()),
  ]);
  const high = fnv1a32(canonical, 0x811c9dc5).toString(16).padStart(8, "0");
  const low = fnv1a32(canonical, 0x050c5d1f).toString(16).padStart(8, "0");
  return `q_${high}${low}`;
}

// ---------------------------------------------------------------------------
// Option helpers
// ---------------------------------------------------------------------------

const RECOMMENDED_PATTERN = /^\s*\(recommended\)\s*/i;

/** Splits a leading "(Recommended)" prefix (case-insensitive) from an option label. */
export function parseOptionLabel(option: string): { label: string; recommended: boolean } {
  if (RECOMMENDED_PATTERN.test(option)) {
    return { label: option.replace(RECOMMENDED_PATTERN, ""), recommended: true };
  }
  return { label: option, recommended: false };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const GrillSettingsSchema = z.object({
  promptTemplate: z.string().trim().min(1).default(DEFAULT_GRILL_PROMPT_TEMPLATE),
  customInstructions: z.string().default(""),
  showWorkspaceBadge: z.boolean().default(true),
});

export type GrillSettingsValues = z.output<typeof GrillSettingsSchema>;

export const grillSettings = defineSettings({
  id: "grill-me",
  scope: "host",
  version: 1,
  schema: GrillSettingsSchema,
});

export const DEFAULT_GRILL_SETTINGS: GrillSettingsValues = GrillSettingsSchema.parse({});

// ---------------------------------------------------------------------------
// Prompt composition
// ---------------------------------------------------------------------------

/**
 * Composes the exact prompt `/grill-me <args>` sends: the template, then any custom
 * instructions, then the `Task / Topic:` line. Used by the server and the settings preview.
 */
export function composeGrillPrompt(
  settings: Pick<GrillSettingsValues, "promptTemplate" | "customInstructions">,
  args: string,
): string {
  const template = settings.promptTemplate.trim() || DEFAULT_GRILL_PROMPT_TEMPLATE;
  const custom = settings.customInstructions.trim();
  const topic = args.trim() || DEFAULT_TOPIC;
  const sections = [template];
  if (custom.length > 0) sections.push(`Additional instructions:\n${custom}`);
  sections.push(`Task / Topic: ${topic}`);
  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Answer message formatting
// ---------------------------------------------------------------------------

export interface GrillAnswerMessageInput {
  question: string;
  branch?: string;
  selectedOptions: readonly string[];
  customText?: string;
  note?: string;
}

/** Formats the user message sent to the agent after the card's Submit button. */
export function formatAnswerMessage(input: GrillAnswerMessageInput): string {
  const lines: string[] = [];
  const header = input.branch ? `[${input.branch}] ${input.question}` : input.question;
  lines.push(`Answer to: ${header}`);
  const selected = input.selectedOptions.map((option) => parseOptionLabel(option).label);
  const custom = input.customText?.trim();
  if (selected.length === 1 && !custom) {
    lines.push(`Selected: ${selected[0]}`);
  } else if (selected.length > 0) {
    lines.push("Selected:");
    for (const option of selected) lines.push(`- ${option}`);
  }
  if (custom) lines.push(`Other (custom answer): ${custom}`);
  const note = input.note?.trim();
  if (note) lines.push(`Note: ${note}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// RPC contracts
// ---------------------------------------------------------------------------

export const startGrillRpc = defineRpc({
  name: "grill.start",
  input: z.object({ agentId: z.string().min(1), args: z.string() }),
  output: z.object({ sent: z.boolean() }),
});

export const answerGrillQuestionRpc = defineRpc({
  name: "grill.answer",
  input: z.object({
    agentId: z.string().min(1),
    questionId: z.string().min(1),
    question: z.string(),
    branch: z.string().optional(),
    selectedOptions: z.array(z.string()),
    customText: z.string().optional(),
    note: z.string().optional(),
  }),
  output: z.object({ ok: z.boolean() }),
});

/** Current interview state for one agent (empty state when the agent never asked). */
export const getGrillStateRpc = defineRpc({
  name: "grill.state",
  input: z.object({ agentId: z.string().min(1) }),
  output: GrillAgentStateSchema,
});

/** Every agent on this host with an unanswered question (feeds the workspace badge). */
export const listPendingQuestionsRpc = defineRpc({
  name: "grill.pending",
  input: z.object({}),
  output: z.object({
    pending: z.array(
      z.object({
        agentId: z.string(),
        workspaceId: z.string().nullable(),
        questionId: z.string(),
        question: z.string(),
      }),
    ),
  }),
});

/** React Query keys shared by every client surface so invalidation reaches all of them. */
export const grillQueryKeys = {
  state: (agentId: string) => ["grill-me", "state", agentId] as const,
  pending: () => ["grill-me", "pending"] as const,
};

// ---------------------------------------------------------------------------
// Timeline item data (client transformer output / renderer schema)
// ---------------------------------------------------------------------------

export const GrillQuestionItemSchema = z.object({
  questionId: z.string(),
  callId: z.string().optional(),
  toolStatus: z.string().optional(),
  question: z.string(),
  branch: z.string().optional(),
  options: z.array(z.string()),
  isMultiSelect: z.boolean(),
});

export type GrillQuestionItemData = z.output<typeof GrillQuestionItemSchema>;
