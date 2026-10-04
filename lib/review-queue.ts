import type { QuestionProgress } from "./answer-history";

export const REVIEW_BATCH_SIZE = 10;
export const REVIEW_REFILL_THRESHOLD = 3;

export type ReviewCandidate = { item: { id: string }; index: number };

export function isReviewDue(progress: QuestionProgress | undefined, now: number) {
  return !!progress && progress.lastScore < 5 && progress.nextDue <= now;
}

function questionPriority(progress: QuestionProgress | undefined, now: number, unseenFirst: boolean) {
  if (!progress) return unseenFirst ? 0 : 1;
  if (isReviewDue(progress, now)) return unseenFirst ? 1 : 0;
  return progress.lastScore < 5 ? 2 : 3;
}

// Fresh material first, then due mistakes, other mistakes, and mastered questions.
export function buildQuestionQueue(
  candidates: readonly ReviewCandidate[],
  progress: Record<string, QuestionProgress>,
  now: number,
  unseenFirst = true,
  random: () => number = Math.random,
) {
  return candidates
    .map((candidate) => ({ ...candidate, tie: random() }))
    .sort((a, b) => {
      const left = progress[a.item.id];
      const right = progress[b.item.id];
      return questionPriority(left, now, unseenFirst) - questionPriority(right, now, unseenFirst)
        || (left && right ? left.nextDue - right.nextDue || left.attempts - right.attempts : 0)
        || a.tie - b.tie;
    })
    .map(({ index }) => index);
}

// Keep queued questions unique and favor fresh material before repeating a question.
export function buildReviewBatch(
  candidates: readonly ReviewCandidate[],
  progress: Record<string, QuestionProgress>,
  served: readonly number[],
  pending: readonly number[],
  now: number,
  unseenFirst: boolean,
  random: () => number = Math.random,
) {
  const excluded = new Set(pending);
  const lastSeen = new Map(served.map((index, position) => [index, position]));
  return candidates.filter(({ index }) => !excluded.has(index))
    .map((candidate) => ({ ...candidate, tie: random() }))
    .sort((a, b) => {
      const aSeen = lastSeen.get(a.index) ?? -1;
      const bSeen = lastSeen.get(b.index) ?? -1;
      if ((aSeen === -1) !== (bSeen === -1)) return aSeen === -1 ? -1 : 1;
      return questionPriority(progress[a.item.id], now, unseenFirst) - questionPriority(progress[b.item.id], now, unseenFirst)
        || aSeen - bSeen
        || (progress[a.item.id]?.nextDue ?? 0) - (progress[b.item.id]?.nextDue ?? 0)
        || a.tie - b.tie;
    })
    .slice(0, REVIEW_BATCH_SIZE)
    .map(({ index }) => index);
}
