import type { Database } from "./supabase/database.types";

export type Review = {
  attempts: number;
  statementCorrect: number;
  statementTotal: number;
  due: number;
  interval: number;
  ease: number;
  lastScore: number;
  lastReviewed: number;
};

export type ReviewMap = Record<string, Review>;
export type ProgressRow = Database["public"]["Tables"]["user_question_progress"]["Row"];
export type ProgressInsert = Database["public"]["Tables"]["user_question_progress"]["Insert"];

export const ANONYMOUS_STORAGE_KEY = "ml4t-recall-progress-v1";
export const IMPORT_OWNER_KEY = "ml4t-recall-progress-v1-import-owner";
export const CLOUD_CACHE_PREFIX = "ml4t-recall-progress-v1-user";
export const MAX_INTERVAL_MINUTES = 52_560_000;
export const MINUTES_PER_DAY = 1_440;
export const SYNC_BATCH_SIZE = 200;

export function cloudCacheKey(userId: string) {
  return `${CLOUD_CACHE_PREFIX}:${userId}`;
}

export function readReviewMap(storage: Storage, key: string): ReviewMap {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, Review] =>
        isReview(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

export function writeReviewMap(storage: Storage, key: string, reviews: ReviewMap) {
  try {
    storage.setItem(key, JSON.stringify(reviews));
  } catch {
    // The in-memory state remains authoritative while device storage is unavailable.
  }
}

export function mergeByNewest(primary: ReviewMap, secondary: ReviewMap): ReviewMap {
  const merged = { ...secondary };

  for (const [code, review] of Object.entries(primary)) {
    const other = merged[code];
    if (!other || review.lastReviewed > other.lastReviewed) merged[code] = review;
  }

  return merged;
}

export function getNewerReviews(candidate: ReviewMap, baseline: ReviewMap) {
  return Object.fromEntries(
    Object.entries(candidate).filter(([code, review]) =>
      !baseline[code] || review.lastReviewed > baseline[code].lastReviewed,
    ),
  );
}

export function progressRowsToReviews(
  rows: ProgressRow[],
  codeByQuestionKey: ReadonlyMap<number, string>,
): ReviewMap {
  const reviews: ReviewMap = {};

  for (const row of rows) {
    const code = codeByQuestionKey.get(row.question_key);
    if (!code) continue;
    reviews[code] = {
      attempts: row.attempts,
      statementCorrect: row.statement_correct,
      statementTotal: row.statement_total,
      due: Date.parse(row.available_at),
      interval: row.interval_minutes / MINUTES_PER_DAY,
      ease: row.ease,
      lastScore: row.last_score,
      lastReviewed: Date.parse(row.last_reviewed_at),
    };
  }

  return reviews;
}

export function reviewToProgressInsert(
  userId: string,
  questionKey: number,
  review: Review,
): ProgressInsert {
  return {
    user_id: userId,
    question_key: questionKey,
    attempts: review.attempts,
    statement_correct: review.statementCorrect,
    statement_total: review.statementTotal,
    available_at: new Date(review.due).toISOString(),
    interval_minutes: Math.min(
      MAX_INTERVAL_MINUTES,
      Math.max(1, Math.round(review.interval * MINUTES_PER_DAY)),
    ),
    ease: review.ease,
    last_score: review.lastScore,
    last_reviewed_at: new Date(review.lastReviewed).toISOString(),
  };
}

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isReview(value: unknown): value is Review {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<Review>;
  const finite = (item: unknown) => typeof item === "number" && Number.isFinite(item);

  return finite(review.attempts)
    && review.attempts! >= 0
    && finite(review.statementCorrect)
    && review.statementCorrect! >= 0
    && finite(review.statementTotal)
    && review.statementTotal! >= review.statementCorrect!
    && finite(review.due)
    && finite(review.interval)
    && review.interval! > 0
    && finite(review.ease)
    && review.ease! >= 1.3
    && review.ease! <= 3
    && finite(review.lastScore)
    && review.lastScore! >= 0
    && review.lastScore! <= 5
    && finite(review.lastReviewed);
}
