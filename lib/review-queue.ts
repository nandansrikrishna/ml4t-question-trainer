import type { QuestionProgress } from "./answer-history";

export const REVIEW_BATCH_SIZE = 10;
export const REVIEW_REFILL_THRESHOLD = 3;

export type ReviewCandidate = { item: { id: string }; index: number };

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
      const priority = (id: string) => {
        const state = progress[id];
        if (!state) return unseenFirst ? 0 : 1;
        return state.nextDue <= now ? (unseenFirst ? 1 : 0) : 2;
      };
      return priority(a.item.id) - priority(b.item.id)
        || aSeen - bSeen
        || (progress[a.item.id]?.nextDue ?? 0) - (progress[b.item.id]?.nextDue ?? 0)
        || a.tie - b.tie;
    })
    .slice(0, REVIEW_BATCH_SIZE)
    .map(({ index }) => index);
}
