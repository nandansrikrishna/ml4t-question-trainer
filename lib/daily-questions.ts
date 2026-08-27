// Switch this to 2 when the Exam 1 window closes.
export const DAILY_EXAM = 1;
export const DAILY_QUESTION_COUNT = 5;
export const DAILY_TIME_ZONE = "America/New_York";

type QuestionReference = {
  id: string;
  exam: number;
};

function hashString(value: string) {
  let hash = 2_166_136_261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function seededRandom(seed: number) {
  let state = seed;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function getDailyDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DAILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function getDailyQuestionIndexes<T extends QuestionReference>(
  questions: readonly T[],
  dateKey: string,
  exam = DAILY_EXAM,
  count = DAILY_QUESTION_COUNT,
) {
  const candidates = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => question.exam === exam)
    .sort((left, right) => left.question.id.localeCompare(right.question.id));
  const random = seededRandom(hashString(`daily-5:v1:${dateKey}:exam-${exam}`));

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
  }

  return candidates.slice(0, count).map(({ index }) => index);
}
