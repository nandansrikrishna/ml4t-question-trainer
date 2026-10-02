"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { ArrowRight, Bookmark, X } from "lucide-react";
import { MathText } from "./math-text";
import { SaveQuestionButton } from "./save-question-button";
import type { QuestionProgress } from "../lib/answer-history";
import type { SavedQuestions } from "../lib/saved-questions";
import {
  buildPoolMap,
  POOL_STATUS_LABELS,
  POOL_STATUSES,
  tileMatches,
  totalCounts,
  type PoolQuestion,
  type PoolStatus,
  type PoolTile,
} from "../lib/pool-map";

type Question = PoolQuestion & { prompt: string; page: number };

const MAX_PRACTICE = 50;
const DAY = 86_400_000;

function relativeDay(time: number, now: number) {
  const days = Math.round((time - now) / DAY);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export default function PoolMap({
  questions,
  progress,
  saved,
  savedReady,
  onToggleSaved,
  now,
  hydrated,
  onPractice,
}: {
  questions: readonly Question[];
  progress: Record<string, QuestionProgress>;
  saved: SavedQuestions;
  savedReady: boolean;
  onToggleSaved: (code: string) => void;
  now: number;
  hydrated: boolean;
  onPractice: (indexes: number[]) => void;
}) {
  const [exam, setExam] = useState(1);
  const [statuses, setStatuses] = useState<Set<PoolStatus>>(new Set());
  const [savedOnly, setSavedOnly] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const tileRefs = useRef(new Map<number, HTMLButtonElement>());

  const domains = useMemo(
    () => buildPoolMap(questions, exam, progress, saved, now),
    [questions, exam, progress, saved, now],
  );
  const counts = totalCounts(domains);
  const total = domains.reduce((sum, d) => sum + d.total, 0);
  const savedTotal = domains.reduce((sum, d) => sum + d.saved, 0);
  // Domain rows of tiles in display order, for arrow-key navigation.
  const rows = useMemo(() => domains.map((d) => d.groups.flat()), [domains]);
  const filtering = statuses.size > 0 || savedOnly;
  const matching = rows.flat().filter((t) => tileMatches(t, statuses, savedOnly));
  const tabStop = focused ?? selected ?? rows[0]?.[0]?.index;
  const detail = selected === null ? null : questions[selected];
  const detailProgress = detail ? progress[detail.id] : undefined;
  const detailTile = rows.flat().find((t) => t.index === selected);

  const toggleStatus = (status: PoolStatus) =>
    setStatuses((current) => {
      const next = new Set(current);
      if (!next.delete(status)) next.add(status);
      return next;
    });
  const moveFocus = (index: number) => {
    setFocused(index);
    tileRefs.current.get(index)?.focus();
  };
  const handleKey = (event: React.KeyboardEvent, tile: PoolTile) => {
    const row = rows.findIndex((r) => r.some((t) => t.index === tile.index));
    const col = rows[row].findIndex((t) => t.index === tile.index);
    const flat = rows.flat();
    const at = flat.findIndex((t) => t.index === tile.index);
    let target: PoolTile | undefined;
    if (event.key === "ArrowRight") target = flat[at + 1];
    else if (event.key === "ArrowLeft") target = flat[at - 1];
    else if (event.key === "ArrowDown" && rows[row + 1])
      target = rows[row + 1][Math.min(col, rows[row + 1].length - 1)];
    else if (event.key === "ArrowUp" && rows[row - 1])
      target = rows[row - 1][Math.min(col, rows[row - 1].length - 1)];
    else if (event.key === "Home") target = rows[row][0];
    else if (event.key === "End") target = rows[row].at(-1);
    else return;
    event.preventDefault();
    if (target) moveFocus(target.index);
  };

  return (
    <div className="pool-map-card">
      <div className="section-title">
        <div>
          <span className="eyebrow">Pool map</span>
          <h2>Every question at a glance</h2>
        </div>
        <div className="segmented pool-exam-toggle" role="group" aria-label="Exam">
          {[1, 2].map((value) => (
            <button
              key={value}
              className={exam === value ? "selected" : ""}
              aria-pressed={exam === value}
              onClick={() => {
                setExam(value);
                setSelected(null);
                setFocused(null);
              }}
            >
              Exam {value}
            </button>
          ))}
        </div>
      </div>

      <div className="pool-summary" aria-hidden="true">
        {hydrated && POOL_STATUSES.map((status) =>
          counts[status] ? (
            <span
              key={status}
              className={`pool-${status}`}
              style={{ flexGrow: counts[status] }}
            />
          ) : null,
        )}
      </div>

      <div className="pool-filters" role="group" aria-label="Filter questions">
        {POOL_STATUSES.map((status) => (
          <button
            key={status}
            className={`pool-chip ${statuses.has(status) ? "active" : ""}`}
            aria-pressed={statuses.has(status)}
            onClick={() => toggleStatus(status)}
          >
            <span className={`pool-swatch pool-${status}`} aria-hidden="true" />
            {POOL_STATUS_LABELS[status]}
            <b>{hydrated ? counts[status] : "–"}</b>
          </button>
        ))}
        <button
          className={`pool-chip ${savedOnly ? "active" : ""}`}
          aria-pressed={savedOnly}
          onClick={() => setSavedOnly((v) => !v)}
        >
          <Bookmark size={12} aria-hidden="true" />
          Saved
          <b>{hydrated && savedReady ? savedTotal : "–"}</b>
        </button>
        {filtering && (
          <>
            <button
              className="text-button"
              onClick={() => {
                setStatuses(new Set());
                setSavedOnly(false);
              }}
            >
              Clear filters
            </button>
            <button
              className="check-button pool-practice"
              disabled={!hydrated || !matching.length}
              onClick={() => onPractice(matching.map((t) => t.index))}
            >
              {matching.length > MAX_PRACTICE
                ? `Practice ${MAX_PRACTICE} of ${matching.length}`
                : `Practice ${matching.length}`}
              <ArrowRight aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <p className="pool-hint">
        {hydrated
          ? `${total - counts.unseen} of ${total} Exam ${exam} questions seen. Each square is one question, grouped by topic; select one for details. Arrow keys move between squares.`
          : "Loading your history…"}
      </p>

      <div className={`pool-domains${hydrated ? "" : " loading"}`} aria-busy={!hydrated} aria-label={`Exam ${exam} question pool`}>
        {domains.map((domain, row) => {
          const seen = domain.total - domain.counts.unseen;
          const showArea = row === 0 || domains[row - 1].area !== domain.area;
          const holdsDetail = !!detailTile && rows[row].includes(detailTile);
          return (
            <Fragment key={domain.key}>
              {showArea && <h3 className="pool-area">{domain.area}</h3>}
              <div className="pool-domain">
                <div className="pool-domain-label">
                  <strong>{domain.domain}</strong>
                  <small>
                    {seen}/{domain.total} seen
                    {domain.counts.missed ? ` · ${domain.counts.missed} missed` : ""}
                    {domain.counts.due ? ` · ${domain.counts.due} due` : ""}
                  </small>
                </div>
                <div className="pool-tiles">
                  {domain.groups.map((group) => (
                    <div className="pool-group" key={group[0].index}>
                      {group.map((tile) => (
                        <button
                          key={tile.index}
                          ref={(el) => {
                            if (el) tileRefs.current.set(tile.index, el);
                            else tileRefs.current.delete(tile.index);
                          }}
                          className={`pool-tile pool-${tile.status}${tile.saved ? " saved" : ""}${filtering && !tileMatches(tile, statuses, savedOnly) ? " dim" : ""}`}
                          tabIndex={tile.index === tabStop ? 0 : -1}
                          aria-pressed={selected === tile.index}
                          aria-label={`${tile.id}, ${tile.group}: ${POOL_STATUS_LABELS[tile.status]}${tile.saved ? ", saved" : ""}`}
                          title={`${tile.id} · ${tile.group}\n${POOL_STATUS_LABELS[tile.status]}${tile.saved ? " · Saved" : ""}`}
                          onFocus={() => setFocused(tile.index)}
                          onKeyDown={(event) => handleKey(event, tile)}
                          onClick={() =>
                            setSelected((current) => (current === tile.index ? null : tile.index))
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              {holdsDetail && detail && detailTile && (
                <section className="pool-detail" aria-label={`Question ${detail.id}`}>
                  <div className="pool-detail-head">
                    <div>
                      <span className={`pool-pill pool-${detailTile.status}`}>
                        {POOL_STATUS_LABELS[detailTile.status]}
                      </span>
                      <strong>{detail.id}</strong>
                      <small>
                        {detail.group} · PDF {detail.page}
                      </small>
                    </div>
                    <button aria-label="Close question details" onClick={() => setSelected(null)}>
                      <X aria-hidden="true" />
                    </button>
                  </div>
                  <p className="pool-prompt">
                    <MathText text={detail.prompt} />
                  </p>
                  <dl className="pool-stats">
                    {detailProgress ? (
                      <>
                        <div>
                          <dt>Last score</dt>
                          <dd>{detailProgress.lastScore}/5</dd>
                        </div>
                        <div>
                          <dt>Attempts</dt>
                          <dd>{detailProgress.attempts}</dd>
                        </div>
                        <div>
                          <dt>Accuracy</dt>
                          <dd>
                            {Math.round(
                              (detailProgress.statementCorrect / detailProgress.statementTotal) * 100,
                            )}
                            %
                          </dd>
                        </div>
                        <div>
                          <dt>Last answered</dt>
                          <dd>{relativeDay(detailProgress.lastAnswered, now)}</dd>
                        </div>
                        <div>
                          <dt>Next review</dt>
                          <dd>
                            {detailProgress.nextDue <= now
                              ? "now"
                              : relativeDay(detailProgress.nextDue, now)}
                          </dd>
                        </div>
                      </>
                    ) : (
                      <div>
                        <dt>History</dt>
                        <dd>Not answered yet</dd>
                      </div>
                    )}
                  </dl>
                  <div className="question-action-buttons">
                    <SaveQuestionButton
                      questionId={detail.id}
                      saved={!!saved[detail.id]?.saved}
                      ready={savedReady}
                      onToggle={onToggleSaved}
                    />
                    <button
                      className="check-button"
                      disabled={!hydrated}
                      onClick={() => onPractice([detailTile.index])}
                    >
                      Practice this question <ArrowRight aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
