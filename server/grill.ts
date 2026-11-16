/// <reference types="node" />
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  defineAgentTool,
  type PluginHandlerContext,
  type PluginServerContext,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  APPEND_FAILED_FOLLOW_UP,
  ASK_QUESTION_TOOL_NAME,
  AskQuestionInputSchema,
  DEFAULT_GRILL_SETTINGS,
  GRILL_CARD_ITEM_KIND,
  GRILL_CARD_ITEM_VERSION,
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
  truncateComposerQuote,
  type GrillAgentState,
  type GrillCardItemData,
  type GrillPendingQuestion,
  type GrillQuestionAnswer,
  type GrillSettingsValues,
} from "../shared/grill";

type PaseoApi = PluginHandlerContext["paseo"];

const LOG_PREFIX = "[paseo-grill-me]";
const MAX_ANSWERS_PER_AGENT = 200;
/** Retry delays for re-appending a pending card after an agent (re)opens. */
const REAPPEND_DELAYS_MS = [1500, 5000, 15000];
/** How many recent timeline rows to scan for the user's composer reply. */
const COMPOSER_SCAN_LIMIT = 20;

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
type PersistedAgentEntry = z.output<typeof PersistedAgentEntrySchema>;

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

function newCardId(questionId: string): string {
  return `${questionId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Builds the appended card's data from a question snapshot, its status, and its answer. */
function buildCardData(
  question: GrillPendingQuestion,
  status: GrillCardItemData["status"],
  answer?: GrillQuestionAnswer,
): GrillCardItemData {
  return {
    cardId: question.cardId,
    questionId: question.questionId,
    question: question.question,
    ...(question.branch !== undefined ? { branch: question.branch } : {}),
    options: question.options,
    isMultiSelect: question.isMultiSelect,
    status,
    ...(answer ? { answer } : {}),
  };
}

/** Appends (or, with an existing id, replaces) the question card row in the agent timeline. */
async function appendCard(paseo: PaseoApi, agentId: string, data: GrillCardItemData): Promise<void> {
  await paseo.agents.ref(agentId).timeline.append({
    type: "plugin",
    id: data.cardId,
    kind: GRILL_CARD_ITEM_KIND,
    version: GRILL_CARD_ITEM_VERSION,
    // Round-trip through JSON so optional fields never carry `undefined`.
    data: JSON.parse(JSON.stringify(data)),
  });
}

/**
 * Finds the user's composer reply that started the current turn: the latest user message
 * recorded at or after the question was asked. Returns undefined when it can't be found.
 */
async function readComposerReply(
  paseo: PaseoApi,
  agentId: string,
  askedAt: string,
): Promise<string | undefined> {
  const page = await paseo.agents
    .ref(agentId)
    .timeline.refetch({ direction: "tail", limit: COMPOSER_SCAN_LIMIT });
  for (let index = page.entries.length - 1; index >= 0; index -= 1) {
    const entry = page.entries[index];
    if (!entry || entry.item.type !== "user_message") continue;
    if (entry.timestamp < askedAt) return undefined;
    const text = entry.item.text.trim();
    // A /grill-me restart sends the interview prompt itself; that is not an answer to quote.
    if (!text || text.startsWith("<GRILL_ME>")) return undefined;
    return truncateComposerQuote(text);
  }
  return undefined;
}

export function registerGrill(server: PluginServerContext): () => void {
  const settings = server.registerSettings(grillSettings);
  const paths = getStatePaths();
  const agentLocks = new Map<string, Promise<void>>();
  /** Card ids appended (or re-appended) by this plugin process. */
  const liveCards = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let disposed = false;
  let sweptAfterStart = false;

  let store: PersistedStateFile | null = null;
  let loadPromise: Promise<PersistedStateFile> | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  async function ensureLoaded(): Promise<PersistedStateFile> {
    if (store) return store;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const raw = await readFile(paths.file, "utf8");
        const parsed = PersistedStateFileSchema.safeParse(JSON.parse(raw) as unknown);
        if (!parsed.success) {
          console.error(`${LOG_PREFIX} Invalid state.json, starting empty:`, parsed.error.message);
          store = emptyStateFile();
          return store;
        }
        store = parsed.data;
        return store;
      } catch (error) {
        if (!isEnoentError(error)) {
          console.error(`${LOG_PREFIX} Failed to read state.json, starting empty:`, error);
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
   * Serializes read-modify-write operations per agent so concurrent tool calls, turn hooks,
   * archive events, and RPC answers do not clobber each other.
   */
  async function withAgentLock<T>(agentId: string, fn: () => Promise<T>): Promise<T> {
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
      if (agentLocks.get(agentId) === next) agentLocks.delete(agentId);
    }
  }

  async function readSettings(): Promise<GrillSettingsValues> {
    const state = await settings.read();
    return state.status === "ready" ? state.values : DEFAULT_GRILL_SETTINGS;
  }

  function writeEntry(
    data: PersistedStateFile,
    agentId: string,
    state: GrillAgentState,
    workspaceId: string | null | undefined,
  ): void {
    const existing: PersistedAgentEntry | undefined = data.agents[agentId];
    data.agents[agentId] = {
      workspaceId: workspaceId ?? existing?.workspaceId ?? null,
      updatedAt: new Date().toISOString(),
      state: { pendingQuestion: state.pendingQuestion, answers: pruneAnswers(state.answers) },
    };
  }

  /** Re-appends a card in a new state; failures are logged, never thrown. */
  async function replaceCard(
    paseo: PaseoApi,
    agentId: string,
    data: GrillCardItemData,
  ): Promise<void> {
    try {
      await appendCard(paseo, agentId, data);
      liveCards.add(data.cardId);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to update question card ${data.cardId}:`, error);
    }
  }

  /**
   * Re-appends the agent's pending card if it was shown before but not by this process, which
   * means the daemon restarted (rows are in memory) or the plugin reloaded. Returns whether the
   * card is now live (or nothing needed restoring).
   */
  async function restorePendingCard(paseo: PaseoApi, agentId: string): Promise<boolean> {
    return withAgentLock(agentId, async () => {
      const data = await ensureLoaded();
      const pending = data.agents[agentId]?.state.pendingQuestion;
      if (!pending || !pending.cardAppended || !pending.cardId) return true;
      if (liveCards.has(pending.cardId)) return true;
      try {
        await appendCard(paseo, agentId, buildCardData(pending, "pending"));
        liveCards.add(pending.cardId);
        return true;
      } catch {
        return false;
      }
    });
  }

  /** On the first daemon context after start, restore every pending card that can be appended now. */
  function sweepAfterStart(paseo: PaseoApi): void {
    if (sweptAfterStart) return;
    sweptAfterStart = true;
    void (async () => {
      const data = await ensureLoaded();
      for (const agentId of Object.keys(data.agents)) {
        if (disposed) return;
        // Agents that are not loaded yet fail here and are restored when they open.
        await restorePendingCard(paseo, agentId);
      }
    })().catch((error) => console.error(`${LOG_PREFIX} Card restore sweep failed:`, error));
  }

  /** Restores a pending card shortly after the agent opens, retrying while it finishes loading. */
  function scheduleRestore(paseo: PaseoApi, agentId: string, attempt = 0): void {
    if (disposed || attempt >= REAPPEND_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      timers.delete(timer);
      void restorePendingCard(paseo, agentId)
        .then((restored) => {
          if (!restored) scheduleRestore(paseo, agentId, attempt + 1);
        })
        .catch((error) => console.error(`${LOG_PREFIX} Card restore failed:`, error));
    }, REAPPEND_DELAYS_MS[attempt]);
    timers.add(timer);
  }

  const askQuestionTool = defineAgentTool({
    name: ASK_QUESTION_TOOL_NAME,
    title: "Ask the user a question",
    description:
      "Ask the user exactly one structured multiple-choice question. Put your recommended option first, prefixed with '(Recommended) '. Do not include an 'Other' option (the UI adds 'Other' automatically). End your turn immediately after calling this tool without repeating the question or options in plain text, and wait for the user's answer.",
    input: AskQuestionInputSchema,
    async execute(input, { agent, paseo }) {
      sweepAfterStart(paseo);
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
          const answers = { ...prevState.answers };

          // A newer question supersedes an unanswered older one.
          const previous = prevState.pendingQuestion;
          if (previous) {
            const skipped: GrillQuestionAnswer = {
              selectedOptions: [],
              answeredVia: "superseded",
              answeredAt: now,
            };
            if (!answers[previous.questionId]) answers[previous.questionId] = skipped;
            if (previous.cardAppended && previous.cardId) {
              await replaceCard(paseo, agent.id, buildCardData(previous, "superseded", skipped));
            }
          }

          writeEntry(
            data,
            agent.id,
            {
              pendingQuestion: {
                questionId,
                question: input.question,
                ...(input.branch !== undefined ? { branch: input.branch } : {}),
                options: input.options,
                isMultiSelect: input.is_multi_select,
                askedAt: now,
                cardId: newCardId(questionId),
                cardAppended: false,
              },
              answers,
            },
            agent.workspaceId,
          );
          await flushStore();
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to persist pending question:`, error);
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

  const removeOpenHook = server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    sweepAfterStart(paseo);
    // Do not await writes to the agent being opened; restore its card once the open finishes.
    scheduleRestore(paseo, request.agentId);
    if (request.purpose !== "interactive") return;
    return { ...request, tools: [...request.tools, askQuestionTool] };
  });

  // The card is appended when the turn ends, so it is always the last row of the chat.
  const removeTurnAfterHook = server.addHook("agent.turn.after", async ({ agent }, { paseo }) => {
    sweepAfterStart(paseo);
    let sendFallback = false;
    try {
      await withAgentLock(agent.id, async () => {
        const data = await ensureLoaded();
        const entry = data.agents[agent.id];
        const pending = entry?.state.pendingQuestion;
        if (!entry || !pending || pending.cardAppended) return;

        const question: GrillPendingQuestion = {
          ...pending,
          cardId: pending.cardId || newCardId(pending.questionId),
        };
        try {
          await appendCard(paseo, agent.id, buildCardData(question, "pending"));
          liveCards.add(question.cardId);
          writeEntry(
            data,
            agent.id,
            { ...entry.state, pendingQuestion: { ...question, cardAppended: true } },
            agent.workspaceId,
          );
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to append question card:`, error);
          writeEntry(data, agent.id, { ...entry.state, pendingQuestion: null }, agent.workspaceId);
          sendFallback = true;
        }
        await flushStore();
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to handle turn end:`, error);
    }
    if (sendFallback) {
      try {
        await paseo.agents.ref(agent.id).send(APPEND_FAILED_FOLLOW_UP);
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to send plain-text fallback:`, error);
      }
    }
  });

  // A turn that starts while a question is pending means the user replied in the composer.
  const removeTurnBeforeHook = server.addHook("agent.turn.before", async ({ agent }, { paseo }) => {
    sweepAfterStart(paseo);
    try {
      await withAgentLock(agent.id, async () => {
        const data = await ensureLoaded();
        const entry = data.agents[agent.id];
        const pending = entry?.state.pendingQuestion;
        if (!entry || !pending) return;

        let composerText: string | undefined;
        try {
          composerText = await readComposerReply(paseo, agent.id, pending.askedAt);
        } catch (error) {
          console.error(`${LOG_PREFIX} Failed to read the composer reply:`, error);
        }

        const answer: GrillQuestionAnswer = entry.state.answers[pending.questionId] ?? {
          selectedOptions: [],
          answeredVia: "composer",
          ...(composerText ? { composerText } : {}),
          answeredAt: new Date().toISOString(),
        };
        writeEntry(
          data,
          agent.id,
          {
            pendingQuestion: null,
            answers: { ...entry.state.answers, [pending.questionId]: answer },
          },
          agent.workspaceId,
        );
        await flushStore();
        if (pending.cardAppended && pending.cardId) {
          await replaceCard(paseo, agent.id, buildCardData(pending, "answered", answer));
        }
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to resolve pending question on turn start:`, error);
    }
  });

  const removeArchiveHook = server.addHook("agent.archive.after", async ({ agent }) => {
    try {
      await withAgentLock(agent.id, async () => {
        const data = await ensureLoaded();
        if (!(agent.id in data.agents)) return;
        delete data.agents[agent.id];
        await flushStore();
      });
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to remove archived agent state:`, error);
    }
  });

  server.handle(startGrillRpc, async ({ agentId, args }, { paseo }) => {
    const prompt = composeGrillPrompt(await readSettings(), args);
    await paseo.agents.ref(agentId).send(prompt);
    return { sent: true };
  });

  server.handle(answerGrillQuestionRpc, async (input, { paseo }) => {
    const customText = input.customText?.trim() || undefined;
    const note = input.note?.trim() || undefined;
    if (input.selectedOptions.length === 0 && !customText) {
      throw new Error("Please select at least one option or enter a custom answer.");
    }

    await withAgentLock(input.agentId, async () => {
      const data = await ensureLoaded();
      const entry = data.agents[input.agentId];
      const pending = entry?.state.pendingQuestion;
      if (!entry || !pending || pending.questionId !== input.questionId) {
        throw new Error("This question is no longer waiting for an answer.");
      }
      const answer: GrillQuestionAnswer = {
        selectedOptions: input.selectedOptions,
        ...(customText ? { customText } : {}),
        ...(note ? { note } : {}),
        answeredVia: "card",
        answeredAt: new Date().toISOString(),
      };
      writeEntry(
        data,
        input.agentId,
        { pendingQuestion: null, answers: { ...entry.state.answers, [pending.questionId]: answer } },
        undefined,
      );
      try {
        await flushStore();
      } catch (error) {
        console.error(`${LOG_PREFIX} Failed to persist answer:`, error);
      }
      if (pending.cardAppended && pending.cardId) {
        await replaceCard(paseo, input.agentId, buildCardData(pending, "answered", answer));
      }
    });

    await paseo.agents.ref(input.agentId).send(
      formatAnswerMessage({
        question: input.question,
        branch: input.branch,
        selectedOptions: input.selectedOptions,
        customText,
        note,
      }),
    );
    return { ok: true };
  });

  server.handle(getGrillStateRpc, async ({ agentId }) => {
    const data = await ensureLoaded();
    return data.agents[agentId]?.state ?? emptyGrillState();
  });

  server.handle(listPendingQuestionsRpc, async () => {
    const data = await ensureLoaded();
    const pending = Object.entries(data.agents).flatMap(([agentId, entry]) => {
      const question = entry.state.pendingQuestion;
      return question
        ? [
            {
              agentId,
              workspaceId: entry.workspaceId,
              questionId: question.questionId,
              question: question.question,
            },
          ]
        : [];
    });
    return { pending };
  });

  return () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    removeOpenHook();
    removeTurnAfterHook();
    removeTurnBeforeHook();
    removeArchiveHook();
  };
}
