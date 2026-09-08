export type ExamQuestion = {
  id: string;
  exam: number;
  area: string;
  domainIndex: number;
  domain: string;
  prompt: string;
  negated: boolean;
  statements: {
    label: string;
    text: string;
    answer: boolean;
    explanation: string;
  }[];
};
export type ExamItem = {
  question: ExamQuestion;
  order: number[];
  answers: (boolean | null)[];
  pinned: boolean;
};
export type ExamSession = {
  id: string;
  exam: number;
  startedAt: number;
  deadline: number;
  submittedAt: number | null;
  items: ExamItem[];
};
export const EXAM_DURATION = 90 * 60 * 1000;
export function shuffle<T>(items: readonly T[], random = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
export function createExam(
  pool: ExamQuestion[],
  exam: number,
  now = Date.now(),
): ExamSession {
  const chosen: ExamQuestion[] = [];
  for (const area of ["Machine Learning", "Quantitative Finance"]) {
    for (let domain = 1; domain <= 10; domain++) {
      const candidates = pool.filter(
        (q) => q.exam === exam && q.area === area && q.domainIndex === domain,
      );
      if (candidates.length < 2)
        throw new Error(`Not enough questions in ${area}, domain ${domain}.`);
      chosen.push(...shuffle(candidates).slice(0, 2));
    }
  }
  return {
    id: crypto.randomUUID(),
    exam,
    startedAt: now,
    deadline: now + EXAM_DURATION,
    submittedAt: null,
    items: shuffle(chosen).map((question) => ({
      question,
      order: shuffle(question.statements.map((_, i) => i)),
      answers: question.statements.map(() => null),
      pinned: false,
    })),
  };
}
export function finishExam(
  session: ExamSession,
  now = Date.now(),
): ExamSession {
  return session.submittedAt !== null
    ? session
    : {
        ...session,
        submittedAt: Math.max(
          session.startedAt,
          Math.min(now, session.deadline),
        ),
      };
}
export function scoreExam(session: ExamSession) {
  return session.items.reduce(
    (score, item) =>
      score +
      item.question.statements.filter((s, i) => item.answers[i] === s.answer)
        .length,
    0,
  );
}
export function completeQuestion(item: ExamItem) {
  return item.answers.every((a) => a !== null);
}
export function clockText(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
export function readExams(raw: string | null): ExamSession[] {
  if (!raw) return [];
  const sessions: ExamSession[] = JSON.parse(raw);
  if (
    !Array.isArray(sessions) ||
    !sessions.every(
      (s) =>
        typeof s.id === "string" &&
        [1, 2].includes(s.exam) &&
        Number.isFinite(s.startedAt) &&
        s.deadline === s.startedAt + EXAM_DURATION &&
        (s.submittedAt === null ||
          (Number.isFinite(s.submittedAt) &&
            s.submittedAt >= s.startedAt &&
            s.submittedAt <= s.deadline)) &&
        Array.isArray(s.items) &&
        s.items.length === 40 &&
        s.items.every(
          (i) =>
            i.question?.statements?.length === 5 &&
            i.answers?.length === 5 &&
            i.answers.every((a) => a === null || typeof a === "boolean") &&
            i.order?.length === 5 &&
            new Set(i.order).size === 5 &&
            i.order.every((n) => Number.isInteger(n) && n >= 0 && n < 5),
        ),
    )
  ) {
    throw new Error("Saved exam data could not be read.");
  }
  return sessions;
}
