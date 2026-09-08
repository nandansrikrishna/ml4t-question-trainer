export type StudySession = {
  version: 1;
  dateKey: string;
  questionCodes: string[];
  kind: "daily" | "custom" | "study_more";
  current: number;
  selected: number[];
  revealed: boolean;
  done: boolean;
  correct: number;
  statements: number;
  skipped: number;
  dailyReplay: boolean;
};

export function sessionStorageKey(userId?: string) {
  return `ml4t-recall-session-v1:${userId ?? "device"}`;
}

// Stored browser data can be outdated or malformed. Never restore unknown questions
// or yesterday's Daily 5; custom sessions remain available across dates.
export function parseStudySession(raw: string | null, knownCodes: ReadonlySet<string>, dateKey: string): StudySession | null {
  try {
    const s = JSON.parse(raw ?? "null") as StudySession | null;
    if (!s || s.version !== 1 || typeof s.dateKey !== "string"
      || !["daily", "custom", "study_more"].includes(s.kind)
      || (s.kind === "daily" && s.dateKey !== dateKey)
      || !Array.isArray(s.questionCodes) || !s.questionCodes.length
      || s.questionCodes.some((code) => !knownCodes.has(code))
      || new Set(s.questionCodes).size !== s.questionCodes.length
      || !Number.isInteger(s.current) || s.current < 0 || s.current >= s.questionCodes.length
      || !Array.isArray(s.selected) || s.selected.some((index) => !Number.isInteger(index) || index < 0 || index > 4)
      || new Set(s.selected).size !== s.selected.length
      || [s.revealed, s.done, s.dailyReplay].some((value) => typeof value !== "boolean")
      || [s.correct, s.statements, s.skipped].some((value) => !Number.isInteger(value) || value < 0)
      || s.correct > s.statements || s.statements % 5 !== 0
      || s.statements / 5 + s.skipped !== (s.done ? s.questionCodes.length : s.current + Number(s.revealed))
      || (s.done && s.current !== s.questionCodes.length - 1)) return null;
    return s;
  } catch {
    return null;
  }
}
