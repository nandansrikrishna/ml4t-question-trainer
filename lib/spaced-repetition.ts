import type { Review, ReviewMap } from "./progress";

export type ReviewRating = "again" | "hard" | "good" | "easy";

type QueueCard = { id: string; index: number };

const DAY = 86_400_000;
const MINUTE_IN_DAYS = 1 / 1_440;
const MAX_INTERVAL_DAYS = 36_500;

export function scheduleReview(
  previous: Review | undefined,
  rating: ReviewRating,
  score: number | null,
  reviewedAt: number,
): Review {
  const interval = getNextInterval(previous, rating);
  const quizScore = score ?? 0;
  const statementTotal = score === null ? 0 : 5;
  const easeChange: Record<ReviewRating, number> = {
    again: -0.2,
    hard: -0.15,
    good: 0,
    easy: 0.15,
  };

  return {
    attempts: (previous?.attempts ?? 0) + 1,
    statementCorrect: (previous?.statementCorrect ?? 0) + quizScore,
    statementTotal: (previous?.statementTotal ?? 0) + statementTotal,
    due: reviewedAt + interval * DAY,
    interval,
    ease: Math.max(1.3, Math.min(3, (previous?.ease ?? 2.5) + easeChange[rating])),
    lastScore: score ?? previous?.lastScore ?? 0,
    lastReviewed: reviewedAt,
  };
}

export function getNextInterval(
  previous: Review | undefined,
  rating: ReviewRating,
) {
  if (rating === "again") return MINUTE_IN_DAYS;
  if (!previous) return rating === "hard" ? 1 : rating === "good" ? 2 : 5;

  const next = rating === "hard"
    ? Math.max(1, previous.interval * 1.2)
    : rating === "good"
      ? Math.max(previous.interval + 1, previous.interval * previous.ease)
      : Math.max(previous.interval + 1, previous.interval * previous.ease * 1.3);

  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(next)));
}

export function formatInterval(interval: number) {
  if (interval < 1) return "1 min";
  const days = Math.round(interval);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} mo`;
  return `${Math.round(months / 12)} yr`;
}

export function buildDeckQueue(
  cards: QueueCard[],
  reviews: ReviewMap,
  now: number,
) {
  const due: QueueCard[] = [];
  const unseen: QueueCard[] = [];
  const future: QueueCard[] = [];

  for (const card of cards) {
    const review = reviews[card.id];
    if (!review) unseen.push(card);
    else if (review.due <= now) due.push(card);
    else future.push(card);
  }

  due.sort((a, b) => reviews[a.id].due - reviews[b.id].due);
  future.sort((a, b) => reviews[a.id].due - reviews[b.id].due);
  unseen.sort((a, b) => seededOrder(a.id, now) - seededOrder(b.id, now));

  return [...due, ...unseen, ...future].map(({ index }) => index);
}

function seededOrder(id: string, now: number) {
  let hash = Math.floor(now / DAY) | 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16_777_619);
  }
  return hash >>> 0;
}
