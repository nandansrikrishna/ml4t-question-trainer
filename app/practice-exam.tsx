"use client";

import { memo, useCallback, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  GripVertical,
  Pin,
  X,
} from "lucide-react";
import { useExamSync } from "./use-exam-sync";
import { MathText } from "./math-text";
import {
  clockText,
  completeQuestion,
  scoreExam,
  type ExamItem,
} from "../lib/practice-exam";

export default function PracticeExam({
  userId,
  visible,
  onSignIn,
}: {
  userId: string | null;
  visible: boolean;
  onSignIn: () => void;
}) {
  const {
    sessions,
    owner,
    ready,
    starting,
    start: startCloud,
    updateItem: updateCloudItem,
    finish,
    now,
    status,
    error,
    pending,
    recovered,
    downloadRecovery,
    retry,
  } = useExamSync(userId);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const session = sessions.find((s) => s.id === selected);
  const active = sessions.find((s) => s.submittedAt === null);
  const updateItem = useCallback(
    (index: number, update: (item: ExamItem) => ExamItem) => {
      if (selected) updateCloudItem(selected, index, update);
    },
    [selected, updateCloudItem],
  );
  const start = async (exam: number) => {
    if (!userId) {
      onSignIn();
      return;
    }
    const id = await startCloud(exam);
    if (id) {
      setSelected(id);
      window.scrollTo(0, 0);
    }
  };
  const jump = (index: number) =>
    document
      .getElementById(`exam-question-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  const review = session?.submittedAt !== null;
  const answered = session?.items.filter(completeQuestion).length ?? 0;
  const history = sessions.filter((s) => s.submittedAt !== null);
  return (
    <div className="exam-root" hidden={!visible}>
      {error && (
        <p className="exam-alert" role="alert">
          {error}
        </p>
      )}
      {status && (
        <div className="exam-sync-status" role="status">
          <span>{status}</span>
          {status !== "Exam history synced" &&
            status !== "Syncing exam…" &&
            (userId === owner && !status.startsWith("Sign in again") ? (
              <button className="text-button" onClick={retry}>
                Retry sync
              </button>
            ) : (
              <button className="text-button" onClick={onSignIn}>
                Sign in to sync
              </button>
            ))}
        </div>
      )}
      {pending && (
        <p className="exam-alert" role="status">
          Your result is saved on this device and waiting to sync. It will be
          confirmed when your account reconnects.
        </p>
      )}
      {recovered && (
        <p className="exam-alert" role="status">
          This exam was submitted on another device. Its cloud result is final;
          any edits that did not reach that submission have been preserved in
          this browser’s recovery data.{" "}
          <button className="text-button" onClick={downloadRecovery}>
            Download saved edits
          </button>
        </p>
      )}
      {!session ? (
        <>
          <div className="exam-intro">
            <span className="eyebrow">
              40 questions. 90 minutes. One focused session.
            </span>
            <h2>Make exam day feel familiar.</h2>
            <p>
              Two questions from each of 10 Machine Learning and 10 Quantitative
              Finance domains. Questions and statements are shuffled for every
              attempt.
            </p>
            <div className="exam-facts">
              <span>
                <Clock3 size={17} /> A continuous 90-minute timer
              </span>
              <span>
                <Check size={17} /> 200 individually graded statements
              </span>
              <span>
                <Pin size={17} /> Pin questions to revisit
              </span>
            </div>
          </div>
          {active && (
            <div className="exam-resume">
              <div>
                <strong>Exam {active.exam} is in progress</strong>
                <p>
                  {clockText(active.deadline - now)} remaining ·{" "}
                  {active.items.filter(completeQuestion).length}/40 answered.
                  The timer continues while you are away.
                </p>
              </div>
              <button
                className="new-session"
                onClick={() => {
                  setSelected(active.id);
                }}
              >
                Resume exam <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="exam-options">
            {[1, 2].map((exam) => (
              <article key={exam}>
                <span className="eyebrow">Full-length practice</span>
                <h2>Exam {exam}</h2>
                <p>Machine Learning + Quantitative Finance</p>
                <div className="exam-option-meta">
                  <span>20 domains</span>
                  <span>40 questions</span>
                  <span>90 minutes</span>
                </div>
                <button
                  className="new-session"
                  disabled={
                    !ready || starting || (!!userId && (!!active || pending))
                  }
                  onClick={() => void start(exam)}
                >
                  {!userId
                    ? "Sign in to start"
                    : starting
                      ? "Starting…"
                      : `Start Exam ${exam}`}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
          <p className="exam-storage">
            Sign in to start a practice exam and sync your sessions and history
            across devices. The timer starts only when you choose Start Exam.
            Answers and pins also autosave in this browser, so an interrupted
            connection or login won’t interrupt an active exam. Closing the page
            does not pause the timer. Each correct statement earns one point;
            unanswered statements earn zero. Ordinary Study practice remains
            available without signing in.
          </p>
          <section className="exam-history">
            <div className="section-title">
              <h2>Exam history</h2>
              <span>{history.length} completed</span>
            </div>
            {!history.length ? (
              <div className="exam-empty">
                Your first rehearsal starts here. Completed exams will appear
                here with scores, timing, and an answer review.
              </div>
            ) : (
              history.map((s) => (
                <button
                  className="exam-history-row"
                  key={s.id}
                  onClick={() => {
                    setSelected(s.id);

                    window.scrollTo(0, 0);
                  }}
                >
                  <span>
                    <strong>Exam {s.exam}</strong>
                    <small>{new Date(s.startedAt).toLocaleString()}</small>
                  </span>
                  <span>
                    <strong>{Math.round(scoreExam(s) / 2)}%</strong>
                    <small>{scoreExam(s)}/200 points</small>
                  </span>
                  <span>
                    <strong>{clockText(s.submittedAt! - s.startedAt)}</strong>
                    <small>
                      {s.submittedAt === s.deadline
                        ? "Time limit reached"
                        : "Submitted"}
                    </small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              ))
            )}
          </section>
        </>
      ) : (
        <>
          <div className="exam-toolbar">
            <button
              className="exam-button"
              onClick={() => {
                setSelected(null);
                setConfirming(false);
              }}
            >
              <ArrowLeft size={16} /> {review ? "History" : "Return"}
            </button>
            <strong>
              Exam {session.exam}
              <small>
                {review ? "Answer review" : `${answered}/40 answered`}
              </small>
            </strong>
            <span
              className={`exam-timer ${!review && session.deadline - now < 300000 ? "urgent" : ""}`}
            >
              <Clock3 size={18} />
              {clockText(
                review
                  ? session.submittedAt! - session.startedAt
                  : session.deadline - now,
              )}
              <small>{review ? "time taken" : "remaining"}</small>
            </span>
            <button
              className="exam-button"
              aria-label="Open calculator"
              onClick={() => setCalculator((v) => !v)}
            >
              <Calculator size={19} />
            </button>
            {!review && (
              <button
                className="new-session"
                onClick={() => setConfirming(true)}
              >
                Submit exam
              </button>
            )}
          </div>
          {review && (
            <section className="exam-result">
              <span className="eyebrow">
                {session.submittedAt === session.deadline
                  ? "Time limit reached"
                  : "Exam complete"}
              </span>
              <h2>
                {Math.round(scoreExam(session) / 2)}%{" "}
                <small>{scoreExam(session)} / 200 points</small>
              </h2>
              <p>
                {answered}/40 fully answered · Time taken{" "}
                {clockText(session.submittedAt! - session.startedAt)}. Review
                your classifications and explanations below.
              </p>
              <div className="exam-facts">
                {["Machine Learning", "Quantitative Finance"].map((area) => (
                  <span key={area}>
                    {area}:{" "}
                    {scoreExam({
                      ...session,
                      items: session.items.filter(
                        (i) => i.question.area === area,
                      ),
                    })}
                    /100
                  </span>
                ))}
              </div>
            </section>
          )}
          <div className={`exam-layout ${expanded ? "expanded" : ""}`}>
            <aside className="exam-navigator" aria-label="Question navigator">
              <button
                className="exam-nav-toggle"
                aria-label={
                  expanded
                    ? "Collapse question navigator"
                    : "Expand question navigator"
                }
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? (
                  <>
                    Questions <ChevronLeft size={18} />
                  </>
                ) : (
                  <ChevronRight size={18} />
                )}
              </button>
              {session.items.some((i) => i.pinned) && (
                <div className="exam-pinned">
                  <span>
                    {expanded ? "Pinned questions" : <Pin size={14} />}
                  </span>
                  {session.items.map(
                    (item, index) =>
                      item.pinned && (
                        <button key={index} onClick={() => jump(index)}>
                          {expanded ? "Question " : ""}
                          {index + 1}
                        </button>
                      ),
                  )}
                </div>
              )}
              {session.items.map((item, index) => (
                <div
                  key={index}
                  className={`exam-nav-row ${completeQuestion(item) ? "answered" : ""}`}
                >
                  <button
                    onClick={() => jump(index)}
                    aria-label={`Question ${index + 1}, ${completeQuestion(item) ? "answered" : "incomplete"}${item.pinned ? ", pinned" : ""}`}
                  >
                    <b>{index + 1}</b>
                    {expanded && (
                      <span>
                        <small>
                          {item.answers.filter((a) => a !== null).length}/5
                          classified ·{" "}
                          {item.question.area === "Machine Learning"
                            ? "ML"
                            : "QF"}
                        </small>
                        <span>{item.question.prompt}</span>
                      </span>
                    )}
                  </button>
                  {expanded && !review && (
                    <button
                      className="exam-pin"
                      aria-label={`Pin question ${index + 1}`}
                      aria-pressed={item.pinned}
                      onClick={() =>
                        updateItem(index, (i) => ({ ...i, pinned: !i.pinned }))
                      }
                    >
                      <Pin
                        size={15}
                        fill={item.pinned ? "currentColor" : "none"}
                      />
                    </button>
                  )}
                </div>
              ))}
            </aside>
            <div className="exam-questions">
              {session.items.map((item, index) => (
                <ExamCard
                  key={item.question.id}
                  item={item}
                  index={index}
                  review={!!review}
                  update={updateItem}
                />
              ))}
              {!review && (
                <button
                  className="new-session exam-bottom-submit"
                  onClick={() => setConfirming(true)}
                >
                  Finish and submit exam <ArrowRight size={17} />
                </button>
              )}
            </div>
          </div>
          {confirming && !review && (
            <div className="modal-backdrop">
              <section
                className="exam-confirm"
                role="dialog"
                aria-modal="true"
                aria-labelledby="submit-title"
                onKeyDown={(e) => {
                  if (e.key === "Escape") setConfirming(false);
                  if (e.key === "Tab") {
                    e.preventDefault();
                    const buttons = e.currentTarget.querySelectorAll("button");
                    (document.activeElement === buttons[0]
                      ? buttons[1]
                      : buttons[0]
                    ).focus();
                  }
                }}
              >
                <span className="eyebrow">Ready to finish?</span>
                <h2 id="submit-title">Submit Exam {session.exam}?</h2>
                <p>
                  {40 - answered > 0
                    ? `${40 - answered} questions are not fully answered. Unclassified statements receive zero points.`
                    : "You have classified every statement."}{" "}
                  Your answers will be locked and your result revealed.
                </p>
                <div>
                  <button
                    autoFocus
                    className="exam-button"
                    onClick={() => setConfirming(false)}
                  >
                    Keep working
                  </button>
                  <button
                    className="new-session"
                    onClick={() => {
                      finish(session.id);
                      setConfirming(false);
                      window.scrollTo(0, 0);
                    }}
                  >
                    Submit and see result
                  </button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      {calculator && <ExamCalculator close={() => setCalculator(false)} />}
    </div>
  );
}

const ExamCard = memo(function ExamCard({
  item,
  index,
  review,
  update,
}: {
  item: ExamItem;
  index: number;
  review: boolean;
  update: (index: number, fn: (item: ExamItem) => ExamItem) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const classify = (statement: number, value: boolean | null) => {
    if (review) return;
    update(index, (i) => ({
      ...i,
      answers: i.answers.map((a, n) => (n === statement ? value : a)),
    }));
    setPicked(null);
    setAnnouncement(
      `Statement ${item.question.statements[statement].label} moved to ${value === null ? "Unclassified" : value ? "True" : "False"}.`,
    );
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `#exam-question-${index} [data-statement="${statement}"]`,
        )
        ?.focus({ preventScroll: true }),
    );
  };
  return (
    <article className="exam-question" id={`exam-question-${index}`}>
      <div className="exam-question-meta">
        <span>
          Question {index + 1} <small>· 5 points · {item.question.area}</small>
        </span>
        <button
          className="exam-pin"
          aria-label={`Pin question ${index + 1}`}
          aria-pressed={item.pinned}
          disabled={review}
          onClick={() => update(index, (i) => ({ ...i, pinned: !i.pinned }))}
        >
          <Pin size={18} fill={item.pinned ? "currentColor" : "none"} />
        </button>
      </div>
      <h3>
        <MathText text={item.question.prompt} />
      </h3>
      <p className="exam-instruction">
        {item.question.negated ? (
          <>
            Read carefully: this item asks you to mark inaccurate statements{" "}
            <strong>True</strong> and accurate statements <strong>False</strong>
            .
          </>
        ) : (
          <>
            Classify each statement as <strong>True</strong> or{" "}
            <strong>False</strong>.
          </>
        )}{" "}
        {!review &&
          "Drag each statement into a section, or select it and then select a section heading."}
      </p>
      {!review && (
        <>
          <span id={`exam-controls-${index}`} className="sr-only">
            Press Enter or Space to select a statement, then choose a section
            heading. You can also press T for True, F for False, or U for
            Unclassified. Escape cancels selection.
          </span>
          <span className="sr-only" role="status">
            {announcement}
          </span>
        </>
      )}
      <div className="exam-buckets">
        {[
          { name: "True", value: true },
          { name: "False", value: false },
          { name: "Unclassified", value: null },
        ].map((bucket) => (
          <section
            key={bucket.name}
            aria-label={`Question ${index + 1} ${bucket.name}`}
            className={`exam-bucket ${bucket.value === null ? "unclassified" : ""} ${dragOver === bucket.name ? "drag-over" : ""}`}
            onDragOver={(e) => {
              if (!review) {
                e.preventDefault();
                setDragOver(bucket.name);
              }
            }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(null);
              if (review) return;
              try {
                const data = JSON.parse(e.dataTransfer.getData("text/plain"));
                if (
                  data.question === item.question.id &&
                  item.order.includes(data.statement)
                )
                  classify(data.statement, bucket.value);
              } catch {
                /* Ignore unrelated drags. */
              }
            }}
          >
            <h4>
              {review ? (
                bucket.name
              ) : (
                <button
                  className="exam-bucket-target"
                  disabled={picked === null}
                  onClick={() => {
                    if (picked !== null) classify(picked, bucket.value);
                  }}
                  aria-label={`Move selected statement to ${bucket.name}`}
                >
                  {bucket.name}
                </button>
              )}
              <small>
                {item.answers.filter((a) => a === bucket.value).length}
              </small>
            </h4>
            <div className="exam-dropzone">
              {item.order
                .filter((n) => item.answers[n] === bucket.value)
                .map((n) => (
                  <div
                    className={`exam-statement ${!review && picked === n ? "picked" : ""}`}
                    key={n}
                    data-statement={n}
                    role={review ? undefined : "button"}
                    tabIndex={review ? undefined : 0}
                    aria-pressed={review ? undefined : picked === n}
                    aria-describedby={
                      review ? undefined : `exam-controls-${index}`
                    }
                    onClick={() => {
                      if (!review) setPicked(picked === n ? null : n);
                    }}
                    onKeyDown={(e) => {
                      if (review) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setPicked(picked === n ? null : n);
                      } else if (
                        ["t", "f", "u"].includes(e.key.toLowerCase()) &&
                        !e.ctrlKey &&
                        !e.metaKey &&
                        !e.altKey
                      ) {
                        e.preventDefault();
                        classify(
                          n,
                          e.key.toLowerCase() === "u"
                            ? null
                            : e.key.toLowerCase() === "t",
                        );
                      } else if (e.key === "Escape") setPicked(null);
                    }}
                    draggable={!review}
                    onDragStart={(e) => {
                      if (review) return;
                      setPicked(null);
                      e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({
                          question: item.question.id,
                          statement: n,
                        }),
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                  >
                    <div>
                      {!review && <GripVertical size={16} aria-hidden="true" />}
                      <span>
                        <MathText text={item.question.statements[n].text} />
                      </span>
                    </div>
                    {review && (
                      <p
                        className={
                          item.answers[n] === item.question.statements[n].answer
                            ? "exam-correct"
                            : "exam-incorrect"
                        }
                      >
                        <strong>
                          {item.answers[n] ===
                          item.question.statements[n].answer
                            ? "Correct"
                            : item.answers[n] === null
                              ? "Unanswered"
                              : "Incorrect"}{" "}
                          · Answer:{" "}
                          {item.question.statements[n].answer
                            ? "True"
                            : "False"}
                        </strong>
                        <br />
                        <MathText
                          text={item.question.statements[n].explanation}
                        />
                      </p>
                    )}
                  </div>
                ))}
              {!item.answers.some((a) => a === bucket.value) && (
                <p className="exam-drop-hint">
                  {review
                    ? "No statements"
                    : bucket.value === null
                      ? "All statements classified"
                      : "Drop statements here"}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
});

function ExamCalculator({ close }: { close: () => void }) {
  const [position, setPosition] = useState({ x: 24, y: 120 });
  const [display, setDisplay] = useState("0");
  const [stored, setStored] = useState<number | null>(null);
  const [operator, setOperator] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const press = (key: string) => {
    if (key === "C") {
      setDisplay("0");
      setStored(null);
      setOperator(null);
      setFresh(true);
      return;
    }
    if (/^[0-9.]$/.test(key)) {
      setDisplay((current) =>
        fresh || current === "Error"
          ? key === "."
            ? "0."
            : key
          : key === "." && current.includes(".")
            ? current
            : current === "0" && key !== "."
              ? key
              : (current + key).slice(0, 16),
      );
      setFresh(false);
      return;
    }
    const value = Number(display);
    const result =
      stored !== null && operator && !fresh
        ? operator === "+"
          ? stored + value
          : operator === "−"
            ? stored - value
            : operator === "×"
              ? stored * value
              : value === 0
                ? NaN
                : stored / value
        : value;
    setDisplay(
      Number.isFinite(result)
        ? String(Number(result.toPrecision(12)))
        : "Error",
    );
    setStored(key === "=" ? null : result);
    setOperator(key === "=" ? null : key);
    setFresh(true);
  };
  return (
    <section
      className="exam-calculator"
      role="dialog"
      aria-label="Calculator"
      style={{ right: position.x, top: position.y }}
      onKeyDown={(e) => {
        const key =
          (
            { "*": "×", "/": "÷", "-": "−", Enter: "=", Escape: "C" } as Record<
              string,
              string
            >
          )[e.key] ?? e.key;
        if (/^[0-9.+×÷−=C]$/.test(key)) {
          e.preventDefault();
          press(key);
        }
      }}
    >
      <div
        className="calculator-handle"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = {
            x: e.clientX + position.x,
            y: e.clientY - position.y,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPosition({
              x: Math.max(
                0,
                Math.min(window.innerWidth - 240, drag.current.x - e.clientX),
              ),
              y: Math.max(
                0,
                Math.min(window.innerHeight - 340, e.clientY - drag.current.y),
              ),
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <span>
          <GripVertical size={15} /> Calculator
        </span>
        <button aria-label="Close calculator" onClick={close}>
          <X size={17} />
        </button>
      </div>
      <output aria-live="polite">{display}</output>
      <div className="calculator-keys">
        {[
          "C",
          "÷",
          "×",
          "−",
          "7",
          "8",
          "9",
          "+",
          "4",
          "5",
          "6",
          "=",
          "1",
          "2",
          "3",
          ".",
          "0",
        ].map((key) => (
          <button key={key} onClick={() => press(key)}>
            {key}
          </button>
        ))}
      </div>
    </section>
  );
}
