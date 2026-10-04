import type { QuestionProgress } from "./answer-history";
import type { SavedQuestions } from "./saved-questions";

export type PoolStatus = "missed" | "due" | "mastered" | "unseen";
export const POOL_STATUSES: readonly PoolStatus[] = ["missed", "due", "mastered", "unseen"];
export const POOL_STATUS_LABELS: Record<PoolStatus, string> = {
  missed: "Missed",
  due: "Review due",
  mastered: "Mastered",
  unseen: "Unseen",
};

export type PoolQuestion = {
  id: string; exam: number; area: string; domainIndex: number; domain: string;
  groupIndex: number; group: string;
};
export type PoolTile = { index: number; id: string; group: string; status: PoolStatus; saved: boolean };
export type StatusCounts = Record<PoolStatus, number>;
export type PoolDomain = {
  key: string; area: string; domain: string;
  groups: PoolTile[][]; counts: StatusCounts; saved: number; total: number;
};

// Mistakes become due at their retry date; a perfect last answer stays mastered.
export function poolStatus(progress: QuestionProgress | undefined, now: number): PoolStatus {
  if (!progress) return "unseen";
  if (progress.lastScore === 5) return "mastered";
  return progress.nextDue <= now ? "due" : "missed";
}

export function emptyCounts(): StatusCounts {
  return { missed: 0, due: 0, mastered: 0, unseen: 0 };
}

// Domains in pool order (ML 1–10, then QF 1–10), each split into its groups.
export function buildPoolMap(
  questions: readonly PoolQuestion[],
  exam: number,
  progress: Record<string, QuestionProgress>,
  saved: SavedQuestions,
  now: number,
): PoolDomain[] {
  const domains = new Map<string, PoolDomain & { byGroup: Map<number, PoolTile[]> }>();
  questions.forEach((question, index) => {
    if (question.exam !== exam) return;
    const key = `${question.exam}-${question.area}-${question.domainIndex}`;
    let domain = domains.get(key);
    if (!domain) {
      domain = {
        key, area: question.area, domain: question.domain, groups: [],
        counts: emptyCounts(), saved: 0, total: 0, byGroup: new Map(),
      };
      domains.set(key, domain);
    }
    const tile: PoolTile = {
      index, id: question.id, group: question.group,
      status: poolStatus(progress[question.id], now),
      saved: !!saved[question.id]?.saved,
    };
    domain.counts[tile.status]++;
    domain.total++;
    if (tile.saved) domain.saved++;
    const group = domain.byGroup.get(question.groupIndex) ?? [];
    group.push(tile);
    domain.byGroup.set(question.groupIndex, group);
  });
  return [...domains.values()].map(({ byGroup, ...domain }) => ({
    ...domain,
    groups: [...byGroup.entries()].sort(([a], [b]) => a - b).map(([, tiles]) => tiles),
  }));
}

export function totalCounts(domains: readonly PoolDomain[]): StatusCounts {
  const counts = emptyCounts();
  for (const domain of domains)
    for (const status of POOL_STATUSES) counts[status] += domain.counts[status];
  return counts;
}

export function filterPoolDomains(
  domains: readonly PoolDomain[],
  area: string,
  domainKey: string,
) {
  return domains.filter((domain) =>
    (area === "all" || domain.area === area)
    && (domainKey === "all" || domain.key === domainKey),
  );
}

// An empty status filter shows every status.
export function tileMatches(
  tile: PoolTile,
  statuses: ReadonlySet<PoolStatus>,
  savedOnly: boolean,
) {
  return (statuses.size === 0 || statuses.has(tile.status)) && (!savedOnly || tile.saved);
}
