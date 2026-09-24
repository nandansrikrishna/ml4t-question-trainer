export type SavedQuestion = { saved: boolean; changedAt: number };
export type SavedQuestions = Record<string, SavedQuestion>;

export function savedQuestionsKey(userId: string | null) {
  return `ml4t-saved-questions-v1:${userId ?? "device"}`;
}

// Retain removals so an old/offline device cannot resurrect a bookmark.
// For simultaneous changes, removal wins. The database uses the same rule.
export function mergeSavedQuestions(a: SavedQuestions, b: SavedQuestions): SavedQuestions {
  const merged = { ...a };
  for (const [code, next] of Object.entries(b)) {
    const prev = merged[code];
    if (!prev || next.changedAt > prev.changedAt
      || (next.changedAt === prev.changedAt && !next.saved)) merged[code] = next;
  }
  return merged;
}

export function readSavedQuestions(raw: string | null, keys: Record<string, number>): SavedQuestions {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([code, value]) =>
      Object.hasOwn(keys, code) && value && typeof value === "object"
      && typeof value.saved === "boolean" && Number.isSafeInteger(value.changedAt)
      && value.changedAt >= 0,
    ));
  } catch { return {}; }
}

export function savedQuestionIndexes(
  questions: readonly { id: string }[], saved: SavedQuestions,
): number[] {
  return questions.flatMap((question, index) => saved[question.id]?.saved ? [index] : []);
}
