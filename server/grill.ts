/// <reference types="node" />
import console from "node:console";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  defineAgentTool,
  type PluginServerContext,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  ASK_QUESTION_TOOL_NAME,
  AskQuestionInputSchema,
  DEFAULT_GRILL_SETTINGS,
  GrillAgentStateSchema,
  answerGrillQuestionRpc,
  composeGrillPrompt,
  computeQuestionId,
  emptyGrillState,
  formatAnswerMessage,
  getGrillStateRpc,
  grillSettings,
  listPendingQuestionsRpc,
  startGrillRpc,
  type GrillAgentState,
  type GrillQuestionAnswer,
  type GrillSettingsValues,
} from "../shared/grill";

const MAX_ANSWERS_PER_AGENT = 200;

const PersistedAgentEntrySchema = z.object({
  workspaceId: z.string().nullable().default(null),
  updatedAt: z.string(),
  state: GrillAgentStateSchema,
});

const PersistedStateFileSchema = z.object({
  version: z.literal(1),
  agents: z.record(z.string(), PersistedAgentEntrySchema).default({}),
});

type PersistedStateFile = z.output<typeof PersistedStateFileSchema>;

function emptyStateFile(): PersistedStateFile {
  return { version: 1, agents: {} };
}

function getStatePaths(): { dir: string; file: string; tmp: string } {
  const paseoHome = process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
  const dir = path.join(paseoHome, "plugin-data", "paseo-grill-me");
  return {
    dir,
    file: path.join(dir, "state.json"),
    tmp: path.join(dir, "state.json.tmp"),
  };
}

function pruneAnswers(
  answers: Record<string, GrillQuestionAnswer>,
): Record<string, GrillQuestionAnswer> {
  const entries = Object.entries(answers);
  if (entries.length <= MAX_ANSWERS_PER_AGENT) return answers;
  entries.sort((a, b) => b[1].answeredAt.localeCompare(a[1].answeredAt));
  return Object.fromEntries(entries.slice(0, MAX_ANSWERS_PER_AGENT));
}

function isEnoentError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export function registerGrill(server: PluginServerContext): () => void {
  const settings = server.registerSettings(grillSettings);
  const paths = getStatePaths();
  const agentLocks = new Map<string, Promise<void>>();

  let store: PersistedStateFile | null = null;
  let loadPromise: Promise<PersistedStateFile> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  async function ensureLoaded(): Promise<PersistedStateFile> {
    if (store) return store;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const raw = await readFile(paths.file, "utf8");
        const parsedJson: unknown = JSON.parse(raw);
        const parsed = PersistedStateFileSchema.safeParse(parsedJson);
        if (!parsed.success) {
          console.error(
            "[paseo-grill-me] Invalid state.json schema, starting with empty state:",
            parsed.error.message,
          );
          store = emptyStateFile();
          return store;
        }
        store = parsed.data;
        return store;
      } catch (error) {
        if (!isEnoentError(error)) {
          console.error(
            "[paseo-grill-me] Failed to read state.json, starting with empty state:",
            error,
          );
        }
        store = emptyStateFile();
        return store;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  /**
   * Queues an atomic write of the latest in-memory store. Writes run one at a time; each queued
   * write serializes the store when it starts, so the last write always reflects the newest state.
   * A failed write does not block later ones.
   */
  function flushStore(): Promise<void> {
    const write = writeChain.then(async () => {
      if (!store) return;
      const payload = JSON.stringify(store);
      await mkdir(paths.dir, { recursive: true });
      await writeFile(paths.tmp, payload, "utf8");
      await rename(paths.tmp, paths.file);
    });
    writeChain = write.catch(() => undefined);
    return write;
  }

  /**
   * Serializes state read-modify-write operations per agent so concurrent
   * tool calls, turn hooks, archive events, and RPC answers do not clobber each other.
   */
  async function withAgentLock<T>(
    agentId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev = agentLocks.get(agentId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = prev.then(() => current);
    agentLocks.set(agentId, next);

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (agentLocks.get(agentId) === next) {
        agentLocks.delete(agentId);
      }
    }
  }

  async function readSettings(): Promise<GrillSettingsValues> {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_GRILL_SETTINGS;
  }

  const askQuestionTool = defineAgentTool({
    name: ASK_QUESTION_TOOL_NAME,
    title: "Ask the user a question",
    description:
      "Ask the user exactly one structured multiple-choice question. Put your recommended option first, prefixed with '(Recommended) '. Do not include an 'Other' option (the UI adds 'Other' automatically). End your turn immediately after calling this tool without repeating the question or options in plain text, and wait for the user's answer.",
    input: AskQuestionInputSchema,
    async execute(input, { agent }) {
      const questionId = computeQuestionId({
        question: input.question,
        branch: input.branch,
        options: input.options,
      });

      await withAgentLock(agent.id, async () => {
        try {
          const data = await ensureLoaded();
          const prevState = data.agents[agent.id]?.state ?? emptyGrillState();
          const now = new Date().toISOString();
          const nextState: GrillAgentState = {
            pendingQuestion: {
              questionId,
              question: input.question,
              ...(input.branch !== undefined ? { branch: input.branch } : {}),
              options: input.options,
              isMultiSelect: input.is_multi_select,
              askedAt: now,
            },
            answers: prevState.answers,
          };
          data.agents[agent.id] = {
            workspaceId: agent.workspaceId,
            updatedAt: now,
            state: nextState,
          };
          await flushStore();
        } catch (error) {
          console.error(
            "[paseo-grill-me] Failed to persist pending question state:",
            error,
          );
        }
      });

      return {
        text: "Question presented to the user in the Paseo chat UI. End your turn immediately without repeating the question or options in plain text, and wait for the user's answer.",
        structuredContent: {
          questionId,
          question: input.question,
          ...(input.branch !== undefined ? { branch: input.branch } : {}),
          options: input.options,
          isMultiSelect: input.is_multi_select,
          status: "awaiting_user_answer",
        },
      };
    },
  });

  const removeOpenHook = server.addHook(
    "agent.open.before",
    async ({ request }) => {
      if (request.purpose !== "interactive") return;
      return {
        ...request,
        tools: [...request.tools, askQuestionTool],
      };
    },
  );

  const removeTurnBeforeHook = server.addHook(
    "agent.turn.before",
    async ({ agent }) => {
      try {
        await withAgentLock(agent.id, async () => {
          const data = await ensureLoaded();
          const existing = data.agents[agent.id];
          if (!existing || !existing.state.pendingQuestion) return;

          const { questionId } = existing.state.pendingQuestion;
          const now = new Date().toISOString();
          const existingAnswer = existing.state.answers[questionId];
          const nextAnswers = existingAnswer
            ? existing.state.answers
            : pruneAnswers({
                ...existing.state.answers,
                [questionId]: {
                  selectedOptions: [],
                  answeredVia: "composer",
                  answeredAt: now,
                },
              });

          data.agents[agent.id] = {
            workspaceId: agent.workspaceId ?? existing.workspaceId,
            updatedAt: now,
            state: {
              pendingQuestion: null,
              answers: nextAnswers,
            },
          };
          await flushStore();
        });
      } catch (error) {
        console.error(
          "[paseo-grill-me] Failed to resolve pending question on turn start:",
          error,
        );
      }
    },
  );

  const removeArchiveAfterHook = server.addHook(
    "agent.archive.after",
    async ({ agent }) => {
      try {
        await withAgentLock(agent.id, async () => {
          const data = await ensureLoaded();
          if (!(agent.id in data.agents)) return;
          delete data.agents[agent.id];
          await flushStore();
        });
      } catch (error) {
        console.error(
          "[paseo-grill-me] Failed to remove archived agent state:",
          error,
        );
      }
    },
  );

  server.handle(startGrillRpc, async ({ agentId, args }, { paseo }) => {
    const prompt = composeGrillPrompt(await readSettings(), args);
    await paseo.agents.ref(agentId).send(prompt);
    return { sent: true };
  });

  server.handle(answerGrillQuestionRpc, async (input, { paseo }) => {
    const customText = input.customText?.trim();
    const note = input.note?.trim();
    const hasSelectedOptions = input.selectedOptions.length > 0;
    const hasCustomText = Boolean(customText && customText.length > 0);
    if (!hasSelectedOptions && !hasCustomText) {
      throw new Error(
        "Please select at least one option or enter a custom answer.",
      );
    }

    await withAgentLock(input.agentId, async () => {
      try {
        const data = await ensureLoaded();
        const existing = data.agents[input.agentId];
        const prevState = existing?.state ?? emptyGrillState();
        const now = new Date().toISOString();
        const nextAnswer: GrillQuestionAnswer = {
          selectedOptions: input.selectedOptions,
          ...(customText ? { customText } : {}),
          ...(note ? { note } : {}),
          answeredVia: "card",
          answeredAt: now,
        };
        const nextState: GrillAgentState = {
          pendingQuestion:
            prevState.pendingQuestion?.questionId === input.questionId
              ? null
              : prevState.pendingQuestion,
          answers: pruneAnswers({
            ...prevState.answers,
            [input.questionId]: nextAnswer,
          }),
        };
        data.agents[input.agentId] = {
          workspaceId: existing?.workspaceId ?? null,
          updatedAt: now,
          state: nextState,
        };
        await flushStore();
      } catch (error) {
        console.error(
          "[paseo-grill-me] Failed to persist answer state:",
          error,
        );
      }
    });

    const message = formatAnswerMessage({
      question: input.question,
      branch: input.branch,
      selectedOptions: input.selectedOptions,
      customText: customText || undefined,
      note: note || undefined,
    });
    await paseo.agents.ref(input.agentId).send(message);
    return { ok: true };
  });

  server.handle(getGrillStateRpc, async ({ agentId }) => {
    const data = await ensureLoaded();
    return data.agents[agentId]?.state ?? emptyGrillState();
  });

  server.handle(listPendingQuestionsRpc, async () => {
    const data = await ensureLoaded();
    const pending: Array<{
      agentId: string;
      workspaceId: string | null;
      questionId: string;
      question: string;
    }> = [];

    for (const [agentId, entry] of Object.entries(data.agents)) {
      const pq = entry.state.pendingQuestion;
      if (pq) {
        pending.push({
          agentId,
          workspaceId: entry.workspaceId,
          questionId: pq.questionId,
          question: pq.question,
        });
      }
    }

    return { pending };
  });

  return () => {
    removeOpenHook();
    removeTurnBeforeHook();
    removeArchiveAfterHook();
  };
}
