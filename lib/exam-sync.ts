import type { ExamItem, ExamQuestion, ExamSession } from "./practice-exam";

export type ExamEdit = {
  id: string;
  position: number;
  kind: "answer" | "pin";
  statement?: number;
  value: boolean | null;
  at: string;
};
export type ExamFlight = {
  id: string;
  revision: number;
  edits: ExamEdit[];
  submittedAt: number | null;
};
export type CachedExam = {
  cloud: ExamSession;
  revision: number;
  edits: ExamEdit[];
  acknowledged: string[];
  submittedAt: number | null;
  flight?: ExamFlight;
  recoveredEdits?: ExamEdit[];
};
export type CloudExam = {
  id: string;
  exam: number;
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  revision: number;
  server_now: string;
  conflict?: boolean;
  acknowledged?: boolean;
  finalizedElsewhere?: boolean;
  items: {
    question_key: number;
    position: number;
    statement_order: number[];
    answer_mask: number;
    answered_mask: number;
    pinned: boolean;
    score: number | null;
  }[];
};
export const EXAM_CACHE_PREFIX = "ml4t-practice-exams-v2:";
export const EXAM_RECOVERY_OWNER = "ml4t-practice-exam-recovery-owner";

export function decodeCloudExam(
  data: CloudExam,
  byKey: Map<number, ExamQuestion>,
): CachedExam {
  if (!data || !Array.isArray(data.items) || data.items.length !== 40)
    throw new Error("The saved exam could not be loaded.");
  const items = [...data.items]
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const question = byKey.get(row.question_key);
      if (!question)
        throw new Error(
          "This exam uses a question pool that is unavailable. Reload the app.",
        );
      return {
        question,
        order: row.statement_order,
        pinned: row.pinned,
        answers: question.statements.map((_, i) =>
          (row.answered_mask & (1 << i)) === 0
            ? null
            : !!(row.answer_mask & (1 << i)),
        ),
        score: row.score ?? undefined,
      };
    });
  return {
    cloud: {
      id: data.id,
      exam: data.exam,
      startedAt: Date.parse(data.started_at),
      deadline: Date.parse(data.deadline),
      submittedAt: data.submitted_at ? Date.parse(data.submitted_at) : null,
      items,
    },
    revision: data.revision,
    edits: [],
    acknowledged: [],
    submittedAt: null,
  };
}
export function applyEdits(
  session: ExamSession,
  edits: ExamEdit[],
): ExamSession {
  if (session.submittedAt !== null) return session;
  const items = session.items.map((item) => ({
    ...item,
    answers: [...item.answers],
  }));
  for (const edit of edits) {
    const item = items[edit.position];
    if (!item) continue;
    if (edit.kind === "pin") item.pinned = edit.value === true;
    else if (edit.statement !== undefined)
      item.answers[edit.statement] = edit.value;
  }
  return { ...session, items };
}
export function visibleExam(record: CachedExam): ExamSession {
  const session = applyEdits(record.cloud, record.edits);
  return { ...session, submittedAt: session.submittedAt ?? record.submittedAt };
}
export function itemEdits(
  before: ExamItem,
  after: ExamItem,
  position: number,
  at: number,
): ExamEdit[] {
  const common = { position, at: new Date(at).toISOString() };
  const edits: ExamEdit[] = [];
  before.answers.forEach((value, statement) => {
    if (value !== after.answers[statement])
      edits.push({
        ...common,
        id: crypto.randomUUID(),
        kind: "answer",
        statement,
        value: after.answers[statement],
      });
  });
  if (before.pinned !== after.pinned)
    edits.push({
      ...common,
      id: crypto.randomUUID(),
      kind: "pin",
      value: after.pinned,
    });
  return edits;
}
// Merge acknowledged event IDs as well as pending events, so another browser tab
// cannot resurrect a request that has already been flushed.
export function mergeExamRecords(a: CachedExam, b: CachedExam): CachedExam {
  const newer = b.revision > a.revision ? b : a;
  const acknowledged = [...new Set([...a.acknowledged, ...b.acknowledged])];
  const ack = new Set(acknowledged);
  const edits = [
    ...new Map([...a.edits, ...b.edits].map((e) => [e.id, e])).values(),
  ]
    .filter((e) => !ack.has(e.id))
    .sort((x, y) => x.at.localeCompare(y.at));
  const pendingFlight = a.flight ?? b.flight;
  return {
    ...newer,
    acknowledged,
    edits: newer.cloud.submittedAt ? [] : edits,
    recoveredEdits:
      newer.cloud.submittedAt && edits.length ? edits : newer.recoveredEdits,
    submittedAt:
      a.submittedAt === null
        ? b.submittedAt
        : b.submittedAt === null
          ? a.submittedAt
          : Math.min(a.submittedAt, b.submittedAt),
    flight:
      newer.cloud.submittedAt !== null ||
      (pendingFlight &&
        pendingFlight.submittedAt === null &&
        pendingFlight.edits.length > 0 &&
        pendingFlight.edits.every((e) => ack.has(e.id)))
        ? undefined
        : pendingFlight,
  };
}
export function acceptCloud(
  record: CachedExam,
  cloud: CachedExam,
  response: CloudExam,
  flight?: ExamFlight,
): CachedExam {
  if (response.conflict)
    return {
      ...record,
      cloud: cloud.cloud,
      revision: cloud.revision,
      flight: undefined,
    };
  const ids =
    response.acknowledged && flight ? flight.edits.map((e) => e.id) : [];
  const acknowledged = [...new Set([...record.acknowledged, ...ids])];
  const remaining = record.edits.filter((e) => !acknowledged.includes(e.id));
  return {
    ...record,
    cloud: cloud.cloud,
    revision: cloud.revision,
    acknowledged,
    flight: undefined,
    edits: cloud.cloud.submittedAt ? [] : remaining,
    recoveredEdits:
      cloud.cloud.submittedAt && remaining.length
        ? remaining
        : record.recoveredEdits,
  };
}
