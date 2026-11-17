import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ASK_QUESTION_TOOL_NAME = "paseo_ask_question";
/** Compact stub that replaces the original `paseo_ask_question` tool-call row. */
export const GRILL_STUB_ITEM_KIND = "grill-question-stub";
export const GRILL_STUB_ITEM_VERSION = 1;
/** Standalone question card the daemon appends at the end of the agent timeline. */
export const GRILL_CARD_ITEM_KIND = "grill-question-card";
export const GRILL_CARD_ITEM_VERSION = 1;
/** Longest quote of a composer reply stored on a locked card. */
export const COMPOSER_QUOTE_MAX_CHARS = 300;
export const APPEND_FAILED_FOLLOW_UP =
  "The question card could not be shown; please ask that question in plain text.";
export const RECOMMENDED_PREFIX = "(Recommended) ";

/** Prompt template shipped before option numbering; kept to migrate v1 settings documents. */
export const DEFAULT_GRILL_PROMPT_TEMPLATE_V1 = `<GRILL_ME>
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

export const DEFAULT_GRILL_PROMPT_TEMPLATE = `<GRILL_ME>
The user has requested that you interview them about every aspect of their task until you have reached a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Guidelines:
- Ask the questions one at a time. Never ask multiple questions in a single turn.
- If a question can be answered by exploring the codebase, explore the codebase instead of asking the user.
- Always use the \`paseo_ask_question\` tool to ask your question. Put your recommended option first, prefixed with \`(Recommended) \`, and include a short \`branch\` label showing which part of the design tree you are resolving (e.g. "Architecture > Storage").
- The question card numbers your options, and the user may answer by number in chat (for example "2"); map a number back to the option in the order you provided it.
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
      "Choices for the user, unnumbered and without an 'Other' option (the UI numbers the choices and adds 'Other' automatically). Put your recommended option first, prefixed with '(Recommended) '. The user may answer by number.",
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
  /** `superseded`: the agent asked a newer question before this one was answered. */
  answeredVia: z.enum(["card", "composer", "superseded"]),
  /** The user's composer reply, truncated to COMPOSER_QUOTE_MAX_CHARS. */
  composerText: z.string().optional(),
  /** Timeline row id of the card shown for this question, when one was appended. */
  cardId: z.string().optional(),
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
  /** Timeline row id of this question's card; unique per ask, even for repeated questions. */
  cardId: z.string().default(""),
  /** True once the card row was appended to the agent timeline. */
  cardAppended: z.boolean().default(false),
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

/** Response of `getGrillStateRpc`: the agent state plus card ids confirmed live in its timeline. */
export const GrillStateResponseSchema = z.object({
  state: GrillAgentStateSchema,
  liveCardIds: z.array(z.string()).default([]),
});

export type GrillStateResponse = z.output<typeof GrillStateResponseSchema>;

/** Parses an unknown value as a state response, falling back to empty state and no live cards. */
export function readGrillStateResponse(raw: unknown): GrillStateResponse {
  const parsed = GrillStateResponseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { state: emptyGrillState(), liveCardIds: [] };
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
  version: 2,
  schema: GrillSettingsSchema,
  migrate(values, fromVersion) {
    // v1 documents saved with the old default template adopt the new default; custom
    // templates are left untouched.
    if (fromVersion < 2) {
      const candidate = values as { promptTemplate?: unknown };
      if (
        typeof candidate.promptTemplate === "string" &&
        candidate.promptTemplate === DEFAULT_GRILL_PROMPT_TEMPLATE_V1
      ) {
        return { ...(values as Record<string, unknown>), promptTemplate: DEFAULT_GRILL_PROMPT_TEMPLATE };
      }
    }
    return values;
  },
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
  /** Full option list, used to prefix each selection with its 1-based card number. */
  options?: readonly string[];
  selectedOptions: readonly string[];
  customText?: string;
  note?: string;
}

/** Formats one selection as `<number> — <label>` when its position in the options is known. */
function formatSelectedOption(
  options: readonly string[] | undefined,
  option: string,
): string {
  const label = parseOptionLabel(option).label;
  const index = options?.indexOf(option) ?? -1;
  return index >= 0 ? `${index + 1} — ${label}` : label;
}

/** Formats the user message sent to the agent after the card's Submit button. */
export function formatAnswerMessage(input: GrillAnswerMessageInput): string {
  const lines: string[] = [];
  const header = input.branch ? `[${input.branch}] ${input.question}` : input.question;
  lines.push(`Answer to: ${header}`);
  const selected = input.selectedOptions.map((option) =>
    formatSelectedOption(input.options, option),
  );
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
    /** Full option list from the card, so the answer message can prefix numbers. */
    options: z.array(z.string()).optional(),
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
  output: GrillStateResponseSchema,
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
// Timeline item data
// ---------------------------------------------------------------------------

/** Stub replacing the tool-call row (client transformer output / renderer schema). */
export const GrillStubItemSchema = z.object({
  questionId: z.string(),
  callId: z.string().optional(),
  toolStatus: z.string().optional(),
  question: z.string(),
  branch: z.string().optional(),
  /** Options from the tool input, so the stub can render the locked card after a restart. */
  options: z.array(z.string()).optional(),
  isMultiSelect: z.boolean().optional(),
});

export type GrillStubItemData = z.output<typeof GrillStubItemSchema>;

/** The appended card. The daemon re-appends it with the same id whenever its status changes. */
export const GrillCardItemSchema = z.object({
  cardId: z.string(),
  questionId: z.string(),
  question: z.string(),
  branch: z.string().optional(),
  options: z.array(z.string()),
  isMultiSelect: z.boolean(),
  status: z.enum(["pending", "answered", "superseded"]),
  answer: GrillQuestionAnswerSchema.optional(),
});

export type GrillCardItemData = z.output<typeof GrillCardItemSchema>;

/** Truncates a composer reply for the locked card quote. */
export function truncateComposerQuote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= COMPOSER_QUOTE_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, COMPOSER_QUOTE_MAX_CHARS - 1).trimEnd()}\u2026`;
}
