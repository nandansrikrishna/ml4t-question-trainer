import type { Database } from "./supabase/database.types";
import type { Review as LegacyReview } from "./progress";

export type AttemptSource = "daily" | "practice" | "study_more" | "exam";

export type AnswerAttempt = {
  id: string;
  questionCode: string;
  answerMask: number;
  score: number;
  answeredAt: number;
  source: AttemptSource;
  skipped?: boolean;
};

export type AttemptMap = Record<string, AnswerAttempt>;
export type AnswerHistoryMap = Record<string, AnswerAttempt[]>;
export type LegacyReviewMap = Record<string, LegacyReview>;
export type AttemptRow = Database["public"]["Tables"]["user_question_attempts"]["Row"];
export type AttemptInsert = Database["public"]["Tables"]["user_question_attempts"]["Insert"];

export type QuestionProgress = {
  attempts: number;
  statementCorrect: number;
  statementTotal: number;
  lastScore: number;
  lastAnswered: number;
  nextDue: number;
};

export const ANONYMOUS_ATTEMPT_STORAGE_KEY = "ml4t-recall-answer-history-v2";
export const ATTEMPT_IMPORT_OWNER_KEY = "ml4t-recall-answer-history-v2-import-owner";
export const ATTEMPT_CLOUD_CACHE_PREFIX = "ml4t-recall-answer-history-v2-user";
export const SYNC_BATCH_SIZE = 200;

const DAY = 86_400_000;
const PERFECT_REVIEW_DELAYS = [3, 7, 14, 30, 60, 120] as const;
const ATTEMPT_SOURCES = new Set<AttemptSource>([
  "daily",
  "practice",
  "study_more",
  "exam",
]);

export function attemptCloudCacheKey(userId: string) {
  return `${ATTEMPT_CLOUD_CACHE_PREFIX}:${userId}`;
}

export function selectedIndexesToMask(selected: readonly number[]) {
  return selected.reduce((mask, index) => mask | (1 << index), 0);
}

export function readAttemptMap(storage: Storage, key: string): AttemptMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, AnswerAttempt] => (
        isAnswerAttempt(entry[1]) && entry[0] === entry[1].id
      )),
    );
  } catch {
    return {};
  }
}

export function writeAttemptMap(storage: Storage, key: string, attempts: AttemptMap) {
  try {
    storage.setItem(key, JSON.stringify(attempts));
  } catch {
    // The in-memory state remains authoritative while device storage is unavailable.
  }
}

export function mergeAttempts(primary: AttemptMap, secondary: AttemptMap): AttemptMap {
  return { ...secondary, ...primary };
}

export function getMissingAttempts(candidate: AttemptMap, baseline: AttemptMap) {
  return Object.fromEntries(
    Object.entries(candidate).filter(([id]) => !baseline[id]),
  );
}

export function attemptRowsToMap(
  rows: AttemptRow[],
  codeByQuestionKey: ReadonlyMap<number, string>,
): AttemptMap {
  const attempts: AttemptMap = {};

  for (const row of rows) {
    const questionCode = codeByQuestionKey.get(row.question_key);
    if (!questionCode) continue;
    attempts[row.attempt_id] = {
      id: row.attempt_id,
      questionCode,
      answerMask: row.answer_mask,
      score: row.score,
      answeredAt: Date.parse(row.answered_at),
      source: row.source as AttemptSource,
      skipped: row.skipped,
    };
  }

  return attempts;
}

export function attemptToInsert(
  userId: string,
  questionKey: number,
  attempt: AnswerAttempt,
): AttemptInsert {
  return {
    user_id: userId,
    attempt_id: attempt.id,
    question_key: questionKey,
    answer_mask: attempt.answerMask,
    score: attempt.score,
    source: attempt.source,
    skipped: attempt.skipped ?? false,
    answered_at: new Date(attempt.answeredAt).toISOString(),
  };
}

export function buildAnswerHistories(attempts: AttemptMap): AnswerHistoryMap {
  const histories: AnswerHistoryMap = {};

  for (const attempt of Object.values(attempts)) {
    (histories[attempt.questionCode] ??= []).push(attempt);
  }

  for (const history of Object.values(histories)) {
    history.sort((left, right) => right.answeredAt - left.answeredAt);
  }

  return histories;
}

export function summarizeQuestion(
  history: readonly AnswerAttempt[] | undefined,
  legacy: LegacyReview | undefined,
): QuestionProgress | undefined {
  if ((!history || history.length === 0) && !legacy) return undefined;

  const currentHistory = (history ?? []).filter((attempt) => !attempt.skipped);
  if (currentHistory.length === 0 && !legacy) return undefined;
  const latestAttempt = currentHistory[0];
  const legacyIsLatest = Boolean(
    legacy && (!latestAttempt || legacy.lastReviewed > latestAttempt.answeredAt),
  );
  const lastScore = legacyIsLatest ? legacy!.lastScore : latestAttempt.score;
  const lastAnswered = legacyIsLatest ? legacy!.lastReviewed : latestAttempt.answeredAt;
  const perfectStreak = getPerfectStreak(currentHistory, legacy);

  return {
    attempts: (legacy?.attempts ?? 0) + currentHistory.length,
    statementCorrect: (legacy?.statementCorrect ?? 0)
      + currentHistory.reduce((sum, attempt) => sum + attempt.score, 0),
    statementTotal: (legacy?.statementTotal ?? 0) + currentHistory.length * 5,
    lastScore,
    lastAnswered,
    nextDue: lastAnswered + getReviewDelayDays(lastScore, perfectStreak) * DAY,
  };
}

export function getReviewDelayDays(score: number, perfectStreak: number) {
  if (score < 5) return 1;
  const index = Math.min(
    Math.max(0, perfectStreak - 1),
    PERFECT_REVIEW_DELAYS.length - 1,
  );
  return PERFECT_REVIEW_DELAYS[index];
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function getPerfectStreak(
  history: readonly AnswerAttempt[],
  legacy: LegacyReview | undefined,
) {
  let streak = 0;
  let legacyCounted = false;

  for (const attempt of history) {
    if (legacy && !legacyCounted && legacy.lastReviewed > attempt.answeredAt) {
      if (legacy.lastScore !== 5) return streak;
      streak += 1;
      legacyCounted = true;
    }
    if (attempt.score !== 5) break;
    streak += 1;
  }

  if (legacy && !legacyCounted && streak === history.length && legacy.lastScore === 5) {
    streak += 1;
  }
  return streak;
}

function isAnswerAttempt(value: unknown): value is AnswerAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<AnswerAttempt>;

  return typeof attempt.id === "string"
    && attempt.id.length > 0
    && typeof attempt.questionCode === "string"
    && attempt.questionCode.length > 0
    && Number.isInteger(attempt.answerMask)
    && attempt.answerMask! >= 0
    && attempt.answerMask! <= 31
    && Number.isInteger(attempt.score)
    && attempt.score! >= 0
    && attempt.score! <= 5
    && typeof attempt.answeredAt === "number"
    && Number.isFinite(attempt.answeredAt)
    && typeof attempt.source === "string"
    && ATTEMPT_SOURCES.has(attempt.source as AttemptSource)
    && (attempt.skipped === undefined || typeof attempt.skipped === "boolean");
}
