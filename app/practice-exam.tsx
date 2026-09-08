"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
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
import rawQuestions from "./data/questions.json";
import { MathText } from "./math-text";
import {
  clockText,
  completeQuestion,
  createExam,
  finishExam,
  readExams,
  scoreExam,
  type ExamItem,
  type ExamSession,
} from "../lib/practice-exam";

export default function PracticeExam({ owner }: { owner: string }) {
  const storageKey = `ml4t-practice-exams-v1:${owner}`;
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const latest = useRef<ExamSession[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [calculator, setCalculator] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");
  const persist = useCallback(
    (next: ExamSession[]) => {
      latest.current = next;
      setSessions(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setError("");
      } catch {
        setError(
          "Your latest changes could not be saved on this device. Keep this page open to retain this session.",
        );
      }
    },
    [storageKey],
  );
  useEffect(() => {
    const load = () => {
      try {
        const stored = readExams(localStorage.getItem(storageKey));
        const next = stored.map((s) =>
          s.submittedAt === null && Date.now() >= s.deadline
            ? finishExam(s, s.deadline)
            : s,
        );
        latest.current = next;
        setSessions(next);
        setReady(true);
        setNow(Date.now());
        if (JSON.stringify(next) !== JSON.stringify(stored))
          localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        setError(
          "Saved exams could not be loaded. Your stored data has been left intact. Enable browser storage and reload to continue.",
        );
      }
    };
    queueMicrotask(load);
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey) load();
    };
    window.addEventListener("storage", sync);
    const tick = () => {
      const time = Date.now();
      setNow(time);
      const expired = latest.current.some(
        (s) => s.submittedAt === null && time >= s.deadline,
      );
      if (expired) {
        const next = latest.current.map((s) =>
          s.submittedAt === null && time >= s.deadline
            ? finishExam(s, s.deadline)
            : s,
        );
        latest.current = next;
        setSessions(next);
        setNotice("Time is up. Your exam has been submitted automatically.");
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          setError("Your result could not be saved. Keep this page open.");
        }
      }
    };
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("storage", sync);
      window.removeEventListener("focus", tick);
    };
  }, [storageKey]);
  const session = sessions.find((s) => s.id === selected);
  const active = sessions.find((s) => s.submittedAt === null);
  const updateItem = useCallback(
    (index: number, update: (item: ExamItem) => ExamItem) => {
      const current = latest.current.find((s) => s.id === selected);
      if (!current || current.submittedAt !== null) return;
      if (Date.now() >= current.deadline) {
        persist(
          latest.current.map((s) => (s.id === current.id ? finishExam(s) : s)),
        );
        return;
      }
      persist(
        latest.current.map((s) =>
          s.id === current.id
            ? {
                ...s,
                items: s.items.map((item, i) =>
                  i === index ? update(item) : item,
                ),
              }
            : s,
        ),
      );
    },
    [selected, persist],
  );
  const start = (exam: number) => {
    if (latest.current.some((s) => s.submittedAt === null)) return;
    try {
      const next = createExam(rawQuestions, exam);
      persist([next, ...latest.current]);
      setSelected(next.id);
      setNow(next.startedAt);
      setNotice("");
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start exam.");
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
    <div className="exam-root">
      {error && (
        <p className="exam-alert" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="exam-alert" role="status">
          {notice}
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
                  setNotice("");
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
                  disabled={!ready || !!active}
                  onClick={() => start(exam)}
                >
                  Start Exam {exam}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
          </div>
          <p className="exam-storage">
            Answers, pins, and history are saved automatically in this browser
            {owner !== "device" ? " for your account" : ""}; they do not sync
            across devices. Closing the page does not pause the timer. Results
            are revealed only after submission. Each correct statement earns one
            point; unanswered statements earn zero.
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
                    setNotice("");
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
                      persist(
                        latest.current.map((s) =>
                          s.id === session.id ? finishExam(s) : s,
                        ),
                      );
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
  const classify = (statement: number, value: boolean | null) =>
    update(index, (i) => ({
      ...i,
      answers: i.answers.map((a, n) => (n === statement ? value : a)),
    }));
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
        Drag a statement or use its dropdown.
      </p>
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
              {bucket.name}
              <small>
                {item.answers.filter((a) => a === bucket.value).length}
              </small>
            </h4>
            <div className="exam-dropzone">
              {item.order
                .filter((n) => item.answers[n] === bucket.value)
                .map((n) => (
                  <div
                    className="exam-statement"
                    key={n}
                    draggable={!review}
                    onDragStart={(e) => {
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
                    {!review ? (
                      <select
                        aria-label={`Classify question ${index + 1} statement ${item.question.statements[n].label}`}
                        value={
                          item.answers[n] === null
                            ? ""
                            : String(item.answers[n])
                        }
                        onChange={(e) =>
                          classify(
                            n,
                            e.target.value === ""
                              ? null
                              : e.target.value === "true",
                          )
                        }
                      >
                        <option value="">Unclassified</option>
                        <option value="true">True</option>
                        <option value="false">False</option>
                      </select>
                    ) : (
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
