"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import katex from "katex";
import {
  ArrowRight,
  BookMarked,
  BookOpen,
  ChartBar,
  Check,
  Cloud,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
  Settings,
  X,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  selectedIndexesToMask,
  summarizeQuestion,
  type AttemptSource,
  type QuestionProgress,
} from "../lib/answer-history";
import { DAILY_EXAM, getDailyDateKey, getDailyQuestionIndexes } from "../lib/daily-questions";
import { useAnswerHistorySync } from "./use-answer-history-sync";
import questionKeys from "./data/question-keys.json";
import rawQuestions from "./data/questions.json";
import ThemeToggle from "./theme-toggle";
import StudyDialog from "./study-dialog";
import { parseStudySession, sessionStorageKey, type StudySession } from "../lib/study-session";

type Statement = { label: string; text: string; answer: boolean; explanation: string };
type Question = {
  id: string; exam: number; area: string; domainIndex: number; domain: string;
  groupIndex: number; group: string; page: number; negated: boolean;
  prompt: string; statements: Statement[];
};
type Tab = "study" | "progress" | "guide";
type SessionKind = "daily" | "custom" | "study_more";

const QUESTIONS = rawQuestions as Question[];
const QUESTION_CODES = new Set(QUESTIONS.map((question) => question.id));
const QUESTION_INDEX = new Map(QUESTIONS.map((question, index) => [question.id, index]));
const MATH_DELIMITER = /(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;

const MathText = memo(function MathText({ text }: { text: string }) {
  return text.split(MATH_DELIMITER).map((part, index) => {
    const displayMode = part.startsWith("\\[") && part.endsWith("\\]");
    const inlineMode = part.startsWith("\\(") && part.endsWith("\\)");

    if (!displayMode && !inlineMode) {
      return part;
    }

    const expression = part.slice(2, -2);
    const html = katex.renderToString(expression, {
      displayMode,
      output: "htmlAndMathml",
      strict: "warn",
      throwOnError: false,
      trust: false,
    });

    return (
      <span
        className={displayMode ? "math-display" : "math-inline"}
        // KaTeX escapes untrusted commands and emits accessible MathML alongside HTML.
        dangerouslySetInnerHTML={{ __html: html }}
        key={`${index}-${expression}`}
      />
    );
  });
});

function buildQuestionQueue(
  candidates: { item: Question; index: number }[],
  progressByQuestion: Record<string, QuestionProgress>,
  now: number,
  unseenFirst = false,
) {
  return candidates
    .map((candidate) => ({ ...candidate, tieBreaker: Math.random() }))
    .sort((left, right) => {
      const leftProgress = progressByQuestion[left.item.id];
      const rightProgress = progressByQuestion[right.item.id];
      const priority = (progress: QuestionProgress | undefined) => {
        if (!progress) return unseenFirst ? 0 : 1;
        if (progress.nextDue <= now) return unseenFirst ? 1 : 0;
        return 2;
      };
      const priorityDifference = priority(leftProgress) - priority(rightProgress);
      if (priorityDifference) return priorityDifference;
      if (leftProgress && rightProgress) {
        return leftProgress.nextDue - rightProgress.nextDue
          || leftProgress.attempts - rightProgress.attempts
          || left.tieBreaker - right.tieBreaker;
      }
      return left.tieBreaker - right.tieBreaker;
    })
    .map(({ index }) => index);
}

function getAttemptSource(sessionKind: SessionKind): AttemptSource {
  if (sessionKind === "daily") return "daily";
  if (sessionKind === "study_more") return "study_more";
  return "practice";
}

export default function Home({ dailyDateKey }: { dailyDateKey: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tab: Tab = pathname === "/progress" ? "progress" : pathname === "/learning-guide" ? "guide" : "study";
  const {
    histories, legacyReviews, hydrated, user, syncStatus, saveAttempt, resetHistory,
    requestMagicLink, signInWithGoogle, signOut,
  } = useAnswerHistorySync(questionKeys);
  const dailyQuestionIndexes = useMemo(() => getDailyQuestionIndexes(QUESTIONS, dailyDateKey), [dailyDateKey]);
  const [session, setSession] = useState<number[]>(() => dailyQuestionIndexes);
  const [sessionKind, setSessionKind] = useState<SessionKind>("daily");
  const [dailyReplayStarted, setDailyReplayStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionStatements, setSessionStatements] = useState(0);
  const [sessionSkipped, setSessionSkipped] = useState(0);
  const [sessionDone, setSessionDone] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [examFilter, setExamFilter] = useState("all");
  const [areaFilter, setAreaFilter] = useState("all");
  const [domainFilter, setDomainFilter] = useState("all");
  const [sessionSize, setSessionSize] = useState(20);
  const [now, setNow] = useState(0);
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    if (hydrated) queueMicrotask(() => setNow(Date.now()));
  }, [hydrated]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [textScale, setTextScale] = useState(1);
  const [loadedSessionKey, setLoadedSessionKey] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  const questionHeading = useRef<HTMLHeadingElement>(null);
  const appRoot = useRef<HTMLElement>(null);
  const actionLocked = useRef(false);
  const nextLocked = useRef(false);
  const storageKey = sessionStorageKey(user?.id);
  const sessionContextKey = `${storageKey}:${dailyDateKey}`;
  const ready = hydrated && loadedSessionKey === sessionContextKey;

  useEffect(() => {
    try {
      const scale = Number(localStorage.getItem("ml4t-recall-text-scale"));
      if ([1, 1.15, 1.3].includes(scale)) queueMicrotask(() => setTextScale(scale));
    } catch { /* Reading remains available when storage is blocked. */ }
  }, []);

  useEffect(() => {
    if (!hydrated || loadedSessionKey === sessionContextKey) return;
    let saved: StudySession | null = null;
    try { saved = parseStudySession(localStorage.getItem(storageKey), QUESTION_CODES, dailyDateKey); } catch { /* Start fresh. */ }
    // History can reconstruct a partially completed Daily 5 even without a local
    // session (for example, after signing in on a second device).
    const dailyAttempts = new Map(dailyQuestionIndexes.map((index) => {
      const code = QUESTIONS[index].id;
      const attempt = histories[code]?.find((item) => item.source === "daily" && getDailyDateKey(new Date(item.answeredAt)) === dailyDateKey);
      const legacy = legacyReviews[code];
      return [index, attempt ?? (legacy && getDailyDateKey(new Date(legacy.lastReviewed)) === dailyDateKey ? { score: legacy.lastScore, skipped: false } : undefined)];
    }));
    const completed = dailyQuestionIndexes.filter((index) => dailyAttempts.get(index));
    const remaining = dailyQuestionIndexes.filter((index) => !dailyAttempts.get(index));
    const attempts = completed.map((index) => dailyAttempts.get(index)!);
    queueMicrotask(() => {
      setSession(saved ? saved.questionCodes.map((code) => QUESTION_INDEX.get(code)!) : [...completed, ...remaining]);
      setSessionKind(saved?.kind ?? "daily");
      setCurrent(saved?.current ?? Math.min(completed.length, dailyQuestionIndexes.length - 1));
      setSelected(saved?.selected ?? []);
      setRevealed(saved?.revealed ?? false);
      setSessionDone(saved?.done ?? remaining.length === 0);
      setSessionCorrect(saved?.correct ?? attempts.reduce((total, attempt) => total + (attempt.skipped ? 0 : attempt.score), 0));
      setSessionStatements(saved?.statements ?? attempts.filter((attempt) => !attempt.skipped).length * 5);
      setSessionSkipped(saved?.skipped ?? attempts.filter((attempt) => attempt.skipped).length);
      setDailyReplayStarted(saved?.dailyReplay ?? false);
      setResumed(saved ? !saved.done : completed.length > 0 && remaining.length > 0);
      setLoadedSessionKey(sessionContextKey);
    });
  }, [hydrated, loadedSessionKey, storageKey, sessionContextKey, dailyDateKey, dailyQuestionIndexes, histories, legacyReviews]);

  useEffect(() => {
    if (!ready || !session.length) return;
    const saved: StudySession = {
      version: 1, dateKey: dailyDateKey, questionCodes: session.map((index) => QUESTIONS[index].id),
      kind: sessionKind, current, selected, revealed, done: sessionDone,
      correct: sessionCorrect, statements: sessionStatements, skipped: sessionSkipped, dailyReplay: dailyReplayStarted,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(saved)); } catch { /* The current session remains usable in memory. */ }
  }, [ready, storageKey, dailyDateKey, session, sessionKind, current, selected, revealed, sessionDone, sessionCorrect, sessionStatements, sessionSkipped, dailyReplayStarted]);

  useEffect(() => {
    actionLocked.current = false;
    nextLocked.current = false;
    if (ready && tab === "study" && !sessionDone) {
      questionHeading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [current, session, ready, tab, sessionDone]);

  useEffect(() => {
    const root = appRoot.current;
    if (!root) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const property = entry.target.classList.contains("sidebar") ? "--navigation-height" : "--study-action-height";
        root.style.setProperty(property, `${entry.target.getBoundingClientRect().height}px`);
      }
    });
    root.querySelectorAll(".sidebar, .question-actions, .answer-result").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [revealed, ready, tab, sessionDone]);

  const changeTextScale = (scale: number) => {
    setTextScale(scale);
    try { localStorage.setItem("ml4t-recall-text-scale", String(scale)); } catch { /* Use the selected scale for this visit. */ }
  };

  const question = QUESTIONS[session[current] ?? 0];
  const result = useMemo(() => question.statements.map((statement, index) => selected.includes(index) === statement.answer), [question, selected]);
  const resultCount = result.filter(Boolean).length;
  const progressByQuestion = useMemo(() => Object.fromEntries(
    QUESTIONS.flatMap((item) => {
      const progress = summarizeQuestion(histories[item.id], legacyReviews[item.id]);
      return progress ? [[item.id, progress] as const] : [];
    }),
  ) as Record<string, QuestionProgress>, [histories, legacyReviews]);
  const reviewedCount = Object.keys(progressByQuestion).length;
  const totalCorrect = Object.values(progressByQuestion).reduce((sum, progress) => sum + progress.statementCorrect, 0);
  const totalStatements = Object.values(progressByQuestion).reduce((sum, progress) => sum + progress.statementTotal, 0);
  const overallAccuracy = totalStatements ? Math.round((totalCorrect / totalStatements) * 100) : 0;
  const dueReviewCount = Object.values(progressByQuestion).filter((progress) => progress.nextDue <= now).length;
  const unseenCount = QUESTIONS.length - reviewedCount;
  const sessionAccuracy = sessionStatements ? Math.round((sessionCorrect / sessionStatements) * 100) : 0;

  const domainOptions = useMemo(() => {
    const seen = new Map<string, string>();
    QUESTIONS.forEach((item) => {
      if (examFilter !== "all" && String(item.exam) !== examFilter) return;
      if (areaFilter !== "all" && item.area !== areaFilter) return;
      seen.set(`${item.exam}-${item.area}-${item.domainIndex}`, `Exam ${item.exam} · ${item.domain}`);
    });
    return [...seen.entries()];
  }, [examFilter, areaFilter]);

  const startSession = () => {
    setResumed(false);
    const startedAt = Date.now();
    const candidates = QUESTIONS.map((item, index) => ({ item, index }))
      .filter(({ item }) => examFilter === "all" || String(item.exam) === examFilter)
      .filter(({ item }) => areaFilter === "all" || item.area === areaFilter)
      .filter(({ item }) => domainFilter === "all" || `${item.exam}-${item.area}-${item.domainIndex}` === domainFilter);
    setSession(
      buildQuestionQueue(candidates, progressByQuestion, startedAt).slice(0, sessionSize),
    );
    setSessionKind("custom");
    setDailyReplayStarted(false);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(false);
    setSessionCorrect(0); setSessionStatements(0); setSessionSkipped(0); setSetupOpen(false); router.push("/");
  };

  const startStudyMore = () => {
    setResumed(false);
    const startedAt = Date.now();
    const candidates = QUESTIONS.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.exam === DAILY_EXAM);
    setSession(
      buildQuestionQueue(candidates, progressByQuestion, startedAt, true).slice(0, 10),
    );
    setSessionKind("study_more");
    setDailyReplayStarted(false);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(false);
    setSessionCorrect(0); setSessionStatements(0); setSessionSkipped(0); router.push("/");
  };

  const restartDaily = () => {
    setResumed(false);
    setSession(dailyQuestionIndexes);
    setSessionKind("daily");
    setDailyReplayStarted(true);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(false);
    setSessionCorrect(0); setSessionStatements(0); setSessionSkipped(0); router.push("/");
  };

  const checkAnswer = useCallback(() => {
    if (!ready || revealed || sessionDone || actionLocked.current) return;
    actionLocked.current = true;
    const answeredAt = Date.now();
    saveAttempt(
      question.id,
      selectedIndexesToMask(selected),
      resultCount,
      getAttemptSource(sessionKind),
      answeredAt,
    );
    setNow(answeredAt);
    setRevealed(true);
    setSessionCorrect((value) => value + resultCount);
    setSessionStatements((value) => value + 5);
  }, [question.id, resultCount, revealed, saveAttempt, selected, sessionDone, sessionKind, ready]);

  const nextQuestion = useCallback(() => {
    if (!ready || nextLocked.current) return;
    nextLocked.current = true;
    setResumed(false);
    if (current + 1 >= session.length) setSessionDone(true);
    else { setCurrent((value) => value + 1); setSelected([]); setRevealed(false); }
  }, [current, session.length, ready]);

  const skipQuestion = useCallback(() => {
    if (!ready || revealed || sessionDone || actionLocked.current) return;
    actionLocked.current = true;
    const skippedAt = Date.now();
    saveAttempt(
      question.id,
      0,
      0,
      getAttemptSource(sessionKind),
      skippedAt,
      true,
    );
    setNow(skippedAt);
    setSessionSkipped((value) => value + 1);
    nextQuestion();
  }, [nextQuestion, question.id, revealed, saveAttempt, sessionDone, sessionKind, ready]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (setupOpen) setSetupOpen(false);
        if (authOpen) setAuthOpen(false);
        return;
      }
      if (!ready || settingsOpen || setupOpen || authOpen || tab !== "study" || sessionDone) return;
      if (
        event.key === "Enter"
        && event.target instanceof HTMLElement
        && event.target.closest("button, a, input, select, textarea")
      ) return;
      if (event.repeat) return;
      if (!revealed && /^[1-5]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        setSelected((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index]);
      }
      if (!revealed && event.key === "Enter") checkAnswer();
      if (revealed && event.key === "Enter") nextQuestion();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [authOpen, checkAnswer, nextQuestion, revealed, sessionDone, setupOpen, settingsOpen, tab, ready]);

  const domainStats = useMemo(() => {
    const rows = new Map<string, { label: string; area: string; reviewed: number; correct: number; total: number; due: number }>();
    QUESTIONS.forEach((item) => {
      const key = `${item.exam}-${item.area}-${item.domainIndex}`;
      const row = rows.get(key) ?? { label: `Exam ${item.exam} · ${item.domain}`, area: item.area, reviewed: 0, correct: 0, total: 0, due: 0 };
      const progress = progressByQuestion[item.id];
      if (progress) { row.reviewed += 1; row.correct += progress.statementCorrect; row.total += progress.statementTotal; if (progress.nextDue <= now) row.due += 1; }
      rows.set(key, row);
    });
    return [...rows.values()].sort((a, b) => (a.total ? a.correct / a.total : -1) - (b.total ? b.correct / b.total : -1));
  }, [progressByQuestion, now]);

  const resetProgress = () => {
    if (!hydrated || syncStatus === "syncing") return;
    const scope = user ? "synced answer history on every device" : "device-local answer history";
    if (window.confirm(`Reset all ${scope}? This cannot be undone.`)) {
      void resetHistory();
      restartDaily();
    }
  };

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    const error = await requestMagicLink(email.trim());
    setAuthMessage(error ?? "Check your email for a secure sign-in link.");
    setAuthBusy(false);
  };

  const continueWithGoogle = async () => {
    setAuthBusy(true);
    const error = await signInWithGoogle();
    if (error) { setAuthMessage(error); setAuthBusy(false); }
  };

  const syncLabel = syncStatus === "syncing"
    ? "Syncing"
    : syncStatus === "offline"
      ? "Saved offline"
      : syncStatus === "synced"
        ? "Cloud synced"
        : "On this device";

  return (
    <main ref={appRoot} className={`app-shell ${tab === "study" && !sessionDone ? "studying" : ""}`} style={{ "--study-scale": textScale } as React.CSSProperties}>
      <aside className="sidebar">
        <Link className="brand-lockup" href="/" aria-label="ML4T Recall home">
          <Image className="brand-mark" src="/ml4t-learning-logo.png" alt="" width={48} height={48} />
          <span className="brand-words"><strong>ML4T Recall</strong><small>Concept learning companion</small></span>
        </Link>
        <nav aria-label="Primary navigation">
          <Link className={`nav-item ${tab === "study" ? "active" : ""}`} aria-current={tab === "study" ? "page" : undefined} href="/"><BookOpen aria-hidden="true" /> Study</Link>
          <Link className={`nav-item ${tab === "progress" ? "active" : ""}`} aria-current={tab === "progress" ? "page" : undefined} href="/progress"><ChartBar aria-hidden="true" /> Progress</Link>
          <Link className={`nav-item ${tab === "guide" ? "active" : ""}`} aria-current={tab === "guide" ? "page" : undefined} href="/learning-guide"><BookMarked aria-hidden="true" /> Learning guide</Link>
        </nav>
        <div className="sidebar-stats">
          <span>{reviewedCount}<small>seen</small></span><span>{unseenCount}<small>unseen</small></span>
        </div>
        <div className="sidebar-note"><span className={`status-dot ${syncStatus}`} /><p><strong>{syncLabel}</strong><br />{QUESTIONS.length} questions in your library</p></div>
      </aside>

      <section className="workspace">
        <div className="study-toolbar">
          <div><strong>{sessionKind === "daily" ? "Daily 5" : sessionKind === "study_more" ? "Study more" : "Custom session"}</strong><span>{ready ? `Question ${current + 1} of ${session.length}` : "Loading session…"}</span></div>
          <button className="sync-button" onClick={() => setSettingsOpen(true)} aria-label="Study settings and navigation"><Settings aria-hidden="true" /><span>Settings</span></button>
        </div>
        <header className="topbar">
          <div>
            <span className="eyebrow">{tab === "study" ? (sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : sessionKind === "study_more" ? `Study 10 more · Exam ${DAILY_EXAM}` : "Study session") : tab === "progress" ? "Learning signal" : "How to use the pool"}</span>
            <h1>{tab === "study" ? (sessionKind === "daily" ? "Today’s five are ready." : sessionKind === "study_more" ? "Keep the momentum going." : "Practice with intent.") : tab === "progress" ? "See what needs attention." : "Make every question useful."}</h1>
            <p className="topbar-subtitle">{tab === "study" ? (sessionKind === "daily" ? `The same five Exam ${DAILY_EXAM} questions for every student, refreshed each day.` : sessionKind === "study_more" ? "Ten more questions, with unseen material first." : "Due reviews come first, followed by unseen questions.") : tab === "progress" ? "Coverage and accuracy, organized by domain." : "A simple loop for turning recall into durable understanding."}</p>
          </div>
          <div className="topbar-actions">
            <button className="theme-toggle" onClick={() => setSettingsOpen(true)} aria-label="Study settings"><Settings aria-hidden="true" /></button>
            <ThemeToggle />
            {user ? (
              <div className="account-chip">
                <span><strong>{user.email}</strong><small>{syncLabel}</small></span>
                <button onClick={() => void signOut()}><LogOut aria-hidden="true" /> Sign out</button>
              </div>
            ) : (
              <button className="sync-button" onClick={() => { setAuthMessage(""); setAuthOpen(true); }}><Cloud aria-hidden="true" /> Sync progress</button>
            )}
            <button className="new-session" disabled={!ready} onClick={() => setSetupOpen(true)}>New session <Plus aria-hidden="true" /></button>
          </div>
        </header>

        {tab === "study" && !ready && <p role="status">Restoring your study session…</p>}
        {tab === "study" && ready && !sessionDone && (
          <div className="study-layout">
            <article className="question-card">
              {resumed && <p className="resume-note" role="status">Session restored on this device. Continue where you left off.</p>}
              <div className="question-meta"><span>EXAM {question.exam} · {question.area.toUpperCase()}</span><span>{question.id} · PDF {question.page}</span></div>
              <div className="progress-line" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={session.length} aria-valuenow={sessionDone ? session.length : current}><span style={{ width: `${(current / session.length) * 100}%` }} /></div>
              <div className="question-heading">
                <div><p className="counter">Question {current + 1} of {session.length}</p><h2 ref={questionHeading} tabIndex={-1}>{question.group}</h2></div>
                {question.negated && <span className="reverse-badge">Reverse-key item</span>}
              </div>
              <p className="scenario"><MathText text={question.prompt} /></p>
              {!question.negated && <p className="instruction">Select every statement you judge to be <strong>True</strong>. Unselected statements count as False.</p>}
              {question.negated && <p className="instruction warning">Read carefully: this item asks you to mark inaccurate statements <strong>True</strong>.</p>}
              <div className="statement-list">
                {question.statements.map((statement, index) => {
                  const isSelected = selected.includes(index);
                  const isCorrect = result[index];
                  return (
                    <div className={`statement-wrap ${revealed ? (isCorrect ? "correct" : "incorrect") : ""}`} key={statement.label}>
                      <button
                        className={`statement ${isSelected ? "selected" : ""}`}
                        disabled={revealed}
                        onClick={() => setSelected((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index])}
                        aria-pressed={isSelected}
                      >
                        <span className="letter">{statement.label}</span><span><MathText text={statement.text} /></span>
                        <span className="check">{revealed ? (isCorrect ? <Check aria-hidden="true" /> : <X aria-hidden="true" />) : isSelected ? <Check aria-hidden="true" /> : null}</span>
                      </button>
                      {revealed && <div className="explanation"><strong>{statement.answer ? "TRUE" : "FALSE"}</strong><p><MathText text={statement.explanation} /></p></div>}
                    </div>
                  );
                })}
              </div>
              {!revealed ? (
                <div className="question-actions"><button className="skip-button" onClick={skipQuestion}>Skip for now</button><button className="check-button" key="check-answer" onClick={checkAnswer}>Check answers <ArrowRight aria-hidden="true" /></button></div>
              ) : (
                <div className="answer-result">
                  <div role="status"><span className="answer-score">{resultCount}/5 <small>correct</small></span><p>{syncLabel} · Next review {progressByQuestion[question.id] ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(progressByQuestion[question.id].nextDue) : "scheduled automatically"}</p></div>
                  <button className="check-button" key="next-question" onClick={nextQuestion}>{current + 1 >= session.length ? "Finish session" : "Next question"} <ArrowRight aria-hidden="true" /></button>
                </div>
              )}
            </article>

            <aside className="session-panel">
              <span className="eyebrow">{sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : sessionKind === "study_more" ? "Study 10 more" : "This session"}</span>
              <div className="score-ring" style={{ "--score": `${sessionAccuracy || 0}%` } as React.CSSProperties}><strong>{sessionStatements ? `${sessionAccuracy}%` : "—"}</strong><span>accuracy</span></div>
              <dl><div><dt>Remaining</dt><dd>{session.length - current}</dd></div><div><dt>Statements</dt><dd>{sessionStatements}</dd></div><div><dt>Due reviews</dt><dd>{dueReviewCount}</dd></div></dl>
              <div className="focus-box"><span>Current domain</span><strong>{question.domain}</strong><small>{question.area} · Exam {question.exam}</small></div>
              <p className="key-hint"><kbd>1–5</kbd> toggle · <kbd>Enter</kbd> {revealed ? "next" : "check"}</p>
            </aside>
          </div>
        )}

        {tab === "study" && sessionDone && (
          <section className="completion-card">
            <span className="completion-mark"><Check aria-hidden="true" /></span><span className="eyebrow">{sessionKind === "daily" ? "Completed for today" : sessionKind === "study_more" ? "Extra study complete" : "Session complete"}</span>
            <h2>{sessionStatements ? `${sessionAccuracy}% statement accuracy` : "No questions answered"}</h2>
            <p>{sessionKind === "daily" ? `You completed today’s shared Exam ${DAILY_EXAM} set: ${session.length - sessionSkipped} answered and ${sessionSkipped} skipped. Submitted answers are saved and review timing is updated automatically.` : `You worked through ${session.length} questions: ${session.length - sessionSkipped} answered and ${sessionSkipped} skipped. Submitted answers are saved and imperfect answers will return in the review queue.`}</p>
            {sessionKind === "daily" ? (
              <div><button className="check-button" onClick={startStudyMore}>Study 10 more <ArrowRight aria-hidden="true" /></button><button className="secondary-button" onClick={restartDaily}><RotateCcw aria-hidden="true" /> Replay Daily 5</button><button className="secondary-button" onClick={() => setSetupOpen(true)}>Custom session</button><Link className="secondary-button" href="/progress">View progress</Link></div>
            ) : (
              <div><button className="check-button" onClick={startStudyMore}>Study 10 more <ArrowRight aria-hidden="true" /></button><button className="secondary-button" onClick={() => setSetupOpen(true)}>Build custom session</button><Link className="secondary-button" href="/progress">View domain progress</Link></div>
            )}
          </section>
        )}

        {tab === "progress" && (
          <section className="progress-view" id="progress">
            <div className="metric-grid">
              <article><span>Questions seen</span><strong>{reviewedCount}</strong><small>of {QUESTIONS.length}</small></article>
              <article><span>Statement accuracy</span><strong>{totalStatements ? `${overallAccuracy}%` : "—"}</strong><small>across all saved attempts</small></article>
              <article><span>Due reviews</span><strong>{dueReviewCount}</strong><small>previous answers ready to revisit</small></article>
              <article><span>Learning coverage</span><strong>{Math.round((reviewedCount / QUESTIONS.length) * 100)}%</strong><small>{unseenCount} unseen · {user ? "cloud synced" : "on this device"}</small></article>
            </div>
            <div className="domain-table-card">
              <div className="section-title"><div><span className="eyebrow">Diagnosis by domain</span><h2>Lowest accuracy first</h2></div><button className="text-button" disabled={!hydrated || syncStatus === "syncing"} onClick={resetProgress}><RotateCcw aria-hidden="true" /> Reset progress</button></div>
              <div className="domain-table">
                {domainStats.map((row) => {
                  const rowAccuracy = row.total ? Math.round((row.correct / row.total) * 100) : 0;
                  return <div className="domain-row" key={row.label}>
                    <div><span className="area-tag">{row.area === "Machine Learning" ? "ML" : "QF"}</span><strong>{row.label}</strong></div>
                    <div className="bar"><span style={{ width: `${rowAccuracy}%` }} /></div>
                    <span>{row.total ? `${rowAccuracy}%` : "Not started"}</span><small>{row.reviewed} seen · {row.due} due</small>
                  </div>;
                })}
              </div>
            </div>
          </section>
        )}

        {tab === "guide" && (
          <section className="guide-view" id="pool">
            <article className="guide-hero"><span className="giant-number">05</span><div><span className="eyebrow">The exam item</span><h2>One scenario. Five related claims. Every claim gets a verdict.</h2><p>Select every statement judged True; anything unselected is treated as False. The pool guarantees at least one True and one False statement per question.</p></div></article>
            <div className="guide-grid">
              <article><span>01</span><h3>Attempt unaided</h3><p>Commit to all five answers and articulate the reasoning before seeing the key.</p></article>
              <article><span>02</span><h3>Check disagreements</h3><p>Track guesses and individual statement errors, not only the question-level score.</p></article>
              <article><span>03</span><h3>Diagnose the gap</h3><p>Separate missing knowledge, calculation errors, missed assumptions, and concept confusion.</p></article>
              <article><span>04</span><h3>Return later</h3><p>Use spaced revisits. Immediate recognition after reading an answer is not durable mastery.</p></article>
            </div>
            <div className="authority-grid">
              <article className="authority-card"><span className="eyebrow">Single source of truth</span><h3>The current published wording and keyed answers are authoritative for grading.</h3><p>Exam answer order may change, and some items may appear as direct negations. Suspected errors should be raised through the designated course channel before the exam.</p></article>
              <article className="ai-card"><span>PREP ONLY</span><h3>AI can be a study partner—not an exam partner.</h3><p>Use it to explain, compare, critique, or generate analogous practice. Verify explanations against the course materials and pool. Generative AI is prohibited during an active exam.</p></article>
            </div>
            <p className="source-line">Built from all 938 questions in <strong>ML4T Exam Question Pool</strong>, revision 08.10.2026. This learning companion supports—but does not replace—lectures, readings, projects, or course announcements.</p>
          </section>
        )}
      </section>

      {settingsOpen && (
        <StudyDialog labelId="settings-title" onClose={() => setSettingsOpen(false)}>
          <section className="session-modal settings-modal">
            <div className="modal-head"><h2 id="settings-title">Study settings</h2><button aria-label="Close settings" onClick={() => setSettingsOpen(false)}><X aria-hidden="true" /></button></div>
            <fieldset><legend>Study text size</legend><div className="segmented">
              {[1, 1.15, 1.3].map((scale, index) => <button key={scale} aria-pressed={textScale === scale} className={textScale === scale ? "selected" : ""} onClick={() => changeTextScale(scale)}>{["Standard", "Large", "Extra large"][index]}</button>)}
            </div></fieldset>
            <p className="text-preview" style={{ fontSize: `${textScale}rem` }}>Comfortable reading for every question and explanation.</p>
            <div className="settings-row"><span>Appearance</span><ThemeToggle /></div>
            <p className="settings-status">{syncLabel}. Sessions resume in this browser on mobile and desktop.</p>
            <nav className="settings-links" aria-label="Study navigation">
              <Link href="/" onClick={() => setSettingsOpen(false)}>Study</Link>
              <Link href="/progress" onClick={() => setSettingsOpen(false)}>Progress</Link>
              <Link href="/learning-guide" onClick={() => setSettingsOpen(false)}>Learning guide</Link>
            </nav>
            <button className="start-button" disabled={!ready} onClick={() => { setSettingsOpen(false); setSetupOpen(true); }}>New session <Plus aria-hidden="true" /></button>
            {user ? <button className="secondary-button" onClick={() => { setSettingsOpen(false); void signOut(); }}>Sign out</button> : <button className="secondary-button" onClick={() => { setSettingsOpen(false); setAuthMessage(""); setAuthOpen(true); }}>Sync progress</button>}
          </section>
        </StudyDialog>
      )}

      {setupOpen && (
        <StudyDialog labelId="session-title" onClose={() => setSetupOpen(false)}>
          <section className="session-modal">
            <div className="modal-head"><div><span className="eyebrow">Custom deck</span><h2 id="session-title">Build a focused session</h2></div><button aria-label="Close" onClick={() => setSetupOpen(false)}><X aria-hidden="true" /></button></div>
            <fieldset><legend>Exam</legend><div className="segmented">{[["all","Both"],["1","Exam 1"],["2","Exam 2"]].map(([value,label]) => <button key={value} className={examFilter === value ? "selected" : ""} onClick={() => { setExamFilter(value); setDomainFilter("all"); }}>{label}</button>)}</div></fieldset>
            <fieldset><legend>Knowledge area</legend><div className="segmented">{[["all","Mixed"],["Machine Learning","Machine Learning"],["Quantitative Finance","Quant Finance"]].map(([value,label]) => <button key={value} className={areaFilter === value ? "selected" : ""} onClick={() => { setAreaFilter(value); setDomainFilter("all"); }}>{label}</button>)}</div></fieldset>
            <label className="select-label">Domain<select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}><option value="all">All matching domains</option>{domainOptions.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <fieldset><legend>Questions</legend><div className="segmented compact">{[10,20,50].map((size) => <button key={size} className={sessionSize === size ? "selected" : ""} onClick={() => setSessionSize(size)}>{size}</button>)}</div></fieldset>
            <div className="modal-note"><span><Sparkles aria-hidden="true" /></span><p><strong>Review-first sequencing</strong><br />Due reviews appear first, followed by unseen questions and then future reviews.</p></div>
            <button className="start-button" onClick={startSession}>Start session <ArrowRight aria-hidden="true" /></button>
          </section>
        </StudyDialog>
      )}

      {authOpen && !user && (
        <StudyDialog labelId="auth-title" onClose={() => setAuthOpen(false)}>
          <section className="auth-modal">
            <div className="modal-head"><div><span className="eyebrow">Optional cloud sync</span><h2 id="auth-title">Study anywhere.</h2></div><button aria-label="Close" onClick={() => setAuthOpen(false)}><X aria-hidden="true" /></button></div>
            <p className="auth-intro">Keep studying without an account, or sign in to merge this device&apos;s progress and sync it across devices.</p>
            <button className="google-button" disabled={authBusy} onClick={() => void continueWithGoogle()}><span>G</span> Continue with Google</button>
            <div className="auth-divider"><span>or use a magic link</span></div>
            <form onSubmit={(event) => void sendMagicLink(event)}>
              <label>Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button className="start-button" disabled={authBusy || !email.trim()}>{authBusy ? "Sending…" : "Email me a sign-in link"}<ArrowRight aria-hidden="true" /></button>
            </form>
            {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
            <p className="auth-footnote">Supabase stores only your account and answer history. Question text and answer keys stay bundled in this app.</p>
          </section>
        </StudyDialog>
      )}
    </main>
  );
}
