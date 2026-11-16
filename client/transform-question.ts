import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import {
  ASK_QUESTION_TOOL_NAME,
  computeQuestionId,
  GRILL_QUESTION_ITEM_KIND,
  GRILL_QUESTION_ITEM_VERSION,
  type GrillQuestionItemData,
} from "../shared/grill";

const TOOL_NAME_SUFFIXES = [
  `__${ASK_QUESTION_TOOL_NAME}`,
  `:${ASK_QUESTION_TOOL_NAME}`,
  `/${ASK_QUESTION_TOOL_NAME}`,
];

export function isAskQuestionToolName(name: string): boolean {
  if (name === ASK_QUESTION_TOOL_NAME) return true;
  return TOOL_NAME_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

interface ExtractedFields {
  question: string;
  branch?: string;
  options: string[];
  isMultiSelect: boolean;
}

function extractFromObject(obj: unknown): ExtractedFields | undefined {
  const parsed = tryParseJson(obj);
  if (!isRecord(parsed)) return undefined;

  const rawQuestion = parsed.question;
  if (typeof rawQuestion !== "string") return undefined;
  const question = rawQuestion.trim();
  if (question.length === 0) return undefined;

  const rawOptions = parsed.options;
  if (!Array.isArray(rawOptions)) return undefined;
  const options: string[] = [];
  for (const entry of rawOptions) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length > 0) options.push(trimmed);
  }
  if (options.length === 0) return undefined;

  let branch: string | undefined;
  if (typeof parsed.branch === "string") {
    const trimmedBranch = parsed.branch.trim();
    if (trimmedBranch.length > 0) branch = trimmedBranch;
  }

  const rawMulti =
    typeof parsed.is_multi_select === "boolean"
      ? parsed.is_multi_select
      : typeof parsed.isMultiSelect === "boolean"
        ? parsed.isMultiSelect
        : false;

  return {
    question,
    ...(branch !== undefined ? { branch } : {}),
    options,
    isMultiSelect: rawMulti,
  };
}

function extractFromOutput(output: unknown): ExtractedFields | undefined {
  const parsed = tryParseJson(output);

  if (isRecord(parsed)) {
    if ("structuredContent" in parsed) {
      const fromStructured = extractFromObject(parsed.structuredContent);
      if (fromStructured) return fromStructured;
    }
    const direct = extractFromObject(parsed);
    if (direct) return direct;
  }

  if (Array.isArray(parsed)) {
    for (const block of parsed) {
      if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
        const fromBlock = extractFromObject(block.text);
        if (fromBlock) return fromBlock;
      }
    }
  }

  return undefined;
}

type ToolCallTransform = PluginTimelineTransformerContribution<"tool_call">["transform"];

export const transformQuestion: ToolCallTransform = ({ item }) => {
  try {
    if (!isAskQuestionToolName(item.name)) return undefined;

    const detail = item.detail as unknown;
    let extracted: ExtractedFields | undefined;

    if (isRecord(detail)) {
      if ("input" in detail) {
        extracted = extractFromObject(detail.input);
      }
      if (!extracted && "output" in detail) {
        extracted = extractFromOutput(detail.output);
      }
    }

    if (!extracted) return undefined;

    const questionId = computeQuestionId({
      question: extracted.question,
      branch: extracted.branch,
      options: extracted.options,
    });

    const data: GrillQuestionItemData = {
      questionId,
      ...(item.callId ? { callId: item.callId } : {}),
      ...(item.status ? { toolStatus: item.status } : {}),
      question: extracted.question,
      ...(extracted.branch !== undefined ? { branch: extracted.branch } : {}),
      options: extracted.options,
      isMultiSelect: extracted.isMultiSelect,
    };

    return {
      items: [
        {
          type: "plugin",
          id: item.callId || questionId,
          kind: GRILL_QUESTION_ITEM_KIND,
          version: GRILL_QUESTION_ITEM_VERSION,
          data,
        },
      ],
    };
  } catch {
    return undefined;
  }
};
