"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DAILY_EXAM, getDailyDateKey, getDailyQuestionIndexes } from "../lib/daily-questions";
import type { Review } from "../lib/progress";
import { useProgressSync } from "./use-progress-sync";
import questionKeys from "./data/question-keys.json";
import rawQuestions from "./data/questions.json";

type Statement = { label: string; text: string; answer: boolean; explanation: string };
type Question = {
  id: string; exam: number; area: string; domainIndex: number; domain: string;
  groupIndex: number; group: string; page: number; negated: boolean;
  prompt: string; statements: Statement[];
};
type Tab = "study" | "progress" | "guide";
type Rating = "again" | "hard" | "good" | "easy";

const QUESTIONS = rawQuestions as Question[];
const DAY = 86_400_000;

export default function Home({ dailyDateKey }: { dailyDateKey: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tab: Tab = pathname === "/progress" ? "progress" : pathname === "/learning-guide" ? "guide" : "study";
  const {
    reviews, hydrated, user, syncStatus, saveReview, resetReviews,
    requestMagicLink, signInWithGoogle, signOut,
  } = useProgressSync(questionKeys);
  const dailyQuestionIndexes = useMemo(() => getDailyQuestionIndexes(QUESTIONS, dailyDateKey), [dailyDateKey]);
  const [session, setSession] = useState<number[]>(() => dailyQuestionIndexes);
  const [sessionKind, setSessionKind] = useState<"daily" | "custom">("daily");
  const [dailyReplayStarted, setDailyReplayStarted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionStatements, setSessionStatements] = useState(0);
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

  useEffect(() => {
    if (!hydrated || dailyReplayStarted || sessionKind !== "daily" || sessionDone) return;

    const completedReviews = dailyQuestionIndexes.map((index) => reviews[QUESTIONS[index].id]);
    const completedToday = completedReviews.every((review) => (
      review && getDailyDateKey(new Date(review.lastReviewed)) === dailyDateKey
    ));
    if (!completedToday) return;

    const restoredCorrect = completedReviews.reduce((sum, review) => sum + review.lastScore, 0);
    queueMicrotask(() => {
      setSessionCorrect(restoredCorrect);
      setSessionStatements(dailyQuestionIndexes.length * 5);
      setSessionDone(true);
    });
  }, [dailyDateKey, dailyQuestionIndexes, dailyReplayStarted, hydrated, reviews, sessionDone, sessionKind]);

  const question = QUESTIONS[session[current] ?? 0];
  const result = useMemo(() => question.statements.map((statement, index) => selected.includes(index) === statement.answer), [question, selected]);
  const resultCount = result.filter(Boolean).length;
  const reviewedCount = Object.keys(reviews).length;
  const totalCorrect = Object.values(reviews).reduce((sum, review) => sum + review.statementCorrect, 0);
  const totalStatements = Object.values(reviews).reduce((sum, review) => sum + review.statementTotal, 0);
  const overallAccuracy = totalStatements ? Math.round((totalCorrect / totalStatements) * 100) : 0;
  const dueCount = Object.values(reviews).filter((review) => review.due <= now).length + (QUESTIONS.length - reviewedCount);
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
    const now = Date.now();
    const candidates = QUESTIONS.map((item, index) => ({ item, index }))
      .filter(({ item }) => examFilter === "all" || String(item.exam) === examFilter)
      .filter(({ item }) => areaFilter === "all" || item.area === areaFilter)
      .filter(({ item }) => domainFilter === "all" || `${item.exam}-${item.area}-${item.domainIndex}` === domainFilter)
      .sort((a, b) => {
        const aReview = reviews[a.item.id];
        const bReview = reviews[b.item.id];
        const aDue = aReview?.due ?? 0;
        const bDue = bReview?.due ?? 0;
        if ((aDue <= now) !== (bDue <= now)) return aDue <= now ? -1 : 1;
        return (aReview?.attempts ?? 0) - (bReview?.attempts ?? 0) || Math.random() - 0.5;
      });
    setSession(candidates.slice(0, sessionSize).map(({ index }) => index));
    setSessionKind("custom");
    setDailyReplayStarted(false);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(false);
    setSessionCorrect(0); setSessionStatements(0); setSetupOpen(false); router.push("/");
  };

  const restartDaily = () => {
    setSession(dailyQuestionIndexes);
    setSessionKind("daily");
    setDailyReplayStarted(true);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(false);
    setSessionCorrect(0); setSessionStatements(0); router.push("/");
  };

  const checkAnswer = useCallback(() => {
    if (revealed || sessionDone) return;
    setRevealed(true);
    setSessionCorrect((value) => value + resultCount);
    setSessionStatements((value) => value + 5);
  }, [revealed, resultCount, sessionDone]);

  const rate = useCallback((rating: Rating, score = resultCount) => {
    const previous = reviews[question.id];
    const previousInterval = previous?.interval ?? 0;
    const intervals: Record<Rating, number> = {
      again: 0.0007,
      hard: Math.max(1, previousInterval ? previousInterval * 1.2 : 1),
      good: Math.max(2, previousInterval ? previousInterval * 2.5 : 2),
      easy: Math.max(5, previousInterval ? previousInterval * 3.5 : 5),
    };
    const easeChange: Record<Rating, number> = { again: -0.2, hard: -0.1, good: 0, easy: 0.15 };
    const interval = intervals[rating];
    const reviewedAt = Date.now();
    const review: Review = {
      attempts: (previous?.attempts ?? 0) + 1,
      statementCorrect: (previous?.statementCorrect ?? 0) + score,
      statementTotal: (previous?.statementTotal ?? 0) + 5,
      due: reviewedAt + interval * DAY,
      interval,
      ease: Math.max(1.3, Math.min(3, (previous?.ease ?? 2.5) + easeChange[rating])),
      lastScore: score,
      lastReviewed: reviewedAt,
    };
    saveReview(question.id, review);
    setNow(reviewedAt);
    if (current + 1 >= session.length) setSessionDone(true);
    else { setCurrent((value) => value + 1); setSelected([]); setRevealed(false); }
  }, [current, question.id, resultCount, reviews, saveReview, session.length]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (setupOpen) setSetupOpen(false);
        if (authOpen) setAuthOpen(false);
        return;
      }
      if (setupOpen || authOpen || tab !== "study" || sessionDone) return;
      if (!revealed && /^[1-5]$/.test(event.key)) {
        const index = Number(event.key) - 1;
        setSelected((items) => items.includes(index) ? items.filter((item) => item !== index) : [...items, index]);
      }
      if (!revealed && event.key === "Enter") checkAnswer();
      if (revealed) {
        const keyRatings: Record<string, Rating> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        if (keyRatings[event.key]) rate(keyRatings[event.key]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [authOpen, checkAnswer, rate, revealed, sessionDone, setupOpen, tab]);

  const domainStats = useMemo(() => {
    const rows = new Map<string, { label: string; area: string; reviewed: number; correct: number; total: number; due: number }>();
    QUESTIONS.forEach((item) => {
      const key = `${item.exam}-${item.area}-${item.domainIndex}`;
      const row = rows.get(key) ?? { label: `Exam ${item.exam} · ${item.domain}`, area: item.area, reviewed: 0, correct: 0, total: 0, due: 0 };
      const review = reviews[item.id];
      if (review) { row.reviewed += 1; row.correct += review.statementCorrect; row.total += review.statementTotal; if (review.due <= now) row.due += 1; }
      rows.set(key, row);
    });
    return [...rows.values()].sort((a, b) => (a.total ? a.correct / a.total : -1) - (b.total ? b.correct / b.total : -1));
  }, [reviews, now]);

  const resetProgress = () => {
    const scope = user ? "synced review history on every device" : "device-local review history";
    if (window.confirm(`Reset all ${scope}? This cannot be undone.`)) void resetReviews();
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
    <main className="app-shell">
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
          <span>{reviewedCount}<small>seen</small></span><span>{dueCount}<small>ready</small></span>
        </div>
        <div className="sidebar-note"><span className={`status-dot ${syncStatus}`} /><p><strong>{syncLabel}</strong><br />{QUESTIONS.length} questions in your library</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{tab === "study" ? (sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : "Study session") : tab === "progress" ? "Learning signal" : "How to use the pool"}</span>
            <h1>{tab === "study" ? (sessionKind === "daily" ? "Today’s five are ready." : "Practice with intent.") : tab === "progress" ? "See what needs attention." : "Make every question useful."}</h1>
            <p className="topbar-subtitle">{tab === "study" ? (sessionKind === "daily" ? `The same five Exam ${DAILY_EXAM} questions for every student, refreshed each day.` : "Judge each claim, then learn from the reasoning.") : tab === "progress" ? "Coverage and confidence, organized by domain." : "A simple loop for turning recall into durable understanding."}</p>
          </div>
          <div className="topbar-actions">
            {user ? (
              <div className="account-chip">
                <span><strong>{user.email}</strong><small>{syncLabel}</small></span>
                <button onClick={() => void signOut()}><LogOut aria-hidden="true" /> Sign out</button>
              </div>
            ) : (
              <button className="sync-button" onClick={() => { setAuthMessage(""); setAuthOpen(true); }}><Cloud aria-hidden="true" /> Sync progress</button>
            )}
            <button className="new-session" onClick={() => setSetupOpen(true)}>New session <Plus aria-hidden="true" /></button>
          </div>
        </header>

        {tab === "study" && !sessionDone && (
          <div className="study-layout">
            <article className="question-card">
              <div className="question-meta"><span>EXAM {question.exam} · {question.area.toUpperCase()}</span><span>{question.id} · PDF {question.page}</span></div>
              <div className="progress-line"><span style={{ width: `${((current + 1) / session.length) * 100}%` }} /></div>
              <div className="question-heading">
                <div><p className="counter">Question {current + 1} of {session.length}</p><h2>{question.group}</h2></div>
                {question.negated && <span className="reverse-badge">Reverse-key item</span>}
              </div>
              <p className="scenario">{question.prompt}</p>
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
                        <span className="letter">{statement.label}</span><span>{statement.text}</span>
                        <span className="check">{revealed ? (isCorrect ? <Check aria-hidden="true" /> : <X aria-hidden="true" />) : isSelected ? <Check aria-hidden="true" /> : null}</span>
                      </button>
                      {revealed && <div className="explanation"><strong>{statement.answer ? "TRUE" : "FALSE"}</strong><p>{statement.explanation}</p></div>}
                    </div>
                  );
                })}
              </div>
              {!revealed ? (
                <div className="question-actions"><button className="skip-button" onClick={() => { setSessionStatements((value) => value + 5); rate("again", 0); }}>Skip for now</button><button className="check-button" onClick={checkAnswer}>Check all 5 statements <ArrowRight aria-hidden="true" /></button></div>
              ) : (
                <div className="rating-panel">
                  <div><span className="rating-score">{resultCount}/5</span><p>{resultCount === 5 ? "Exact match. Can you explain each one?" : "Review the reasoning, then schedule the revisit."}</p></div>
                  <div className="rating-buttons">
                    <button onClick={() => rate("again")}><kbd>1</kbd><strong>Again</strong><small>1 min</small></button>
                    <button onClick={() => rate("hard")}><kbd>2</kbd><strong>Hard</strong><small>1 day</small></button>
                    <button onClick={() => rate("good")}><kbd>3</kbd><strong>Good</strong><small>{reviews[question.id]?.interval ? `${Math.ceil(reviews[question.id].interval * 2.5)} days` : "2 days"}</small></button>
                    <button onClick={() => rate("easy")}><kbd>4</kbd><strong>Easy</strong><small>{reviews[question.id]?.interval ? `${Math.ceil(reviews[question.id].interval * 3.5)} days` : "5 days"}</small></button>
                  </div>
                </div>
              )}
            </article>

            <aside className="session-panel">
              <span className="eyebrow">{sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : "This session"}</span>
              <div className="score-ring" style={{ "--score": `${sessionAccuracy || 0}%` } as React.CSSProperties}><strong>{sessionStatements ? `${sessionAccuracy}%` : "—"}</strong><span>accuracy</span></div>
              <dl><div><dt>Remaining</dt><dd>{session.length - current}</dd></div><div><dt>Statements</dt><dd>{sessionStatements}</dd></div><div><dt>Ready to learn</dt><dd>{dueCount}</dd></div></dl>
              <div className="focus-box"><span>Current domain</span><strong>{question.domain}</strong><small>{question.area} · Exam {question.exam}</small></div>
              <p className="key-hint"><kbd>1–5</kbd> toggle · <kbd>Enter</kbd> check</p>
            </aside>
          </div>
        )}

        {tab === "study" && sessionDone && (
          <section className="completion-card">
            <span className="completion-mark"><Check aria-hidden="true" /></span><span className="eyebrow">{sessionKind === "daily" ? "Completed for today" : "Session complete"}</span>
            <h2>{sessionAccuracy}% statement accuracy</h2>
            <p>{sessionKind === "daily" ? `You completed today’s shared Exam ${DAILY_EXAM} set. Your results are saved to your own progress history.` : `You worked through ${session.length} questions and identified which concepts need another look. Revisit the explanations, then connect those ideas back to the course materials.`}</p>
            {sessionKind === "daily" ? (
              <div><button className="check-button" onClick={restartDaily}><RotateCcw aria-hidden="true" /> Do Daily 5 again</button><button className="secondary-button" onClick={() => setSetupOpen(true)}>Build custom session</button><Link className="secondary-button" href="/progress">View progress</Link></div>
            ) : (
              <div><button className="check-button" onClick={() => setSetupOpen(true)}>Build another session <ArrowRight aria-hidden="true" /></button><Link className="secondary-button" href="/progress">View domain progress</Link></div>
            )}
          </section>
        )}

        {tab === "progress" && (
          <section className="progress-view" id="progress">
            <div className="metric-grid">
              <article><span>Questions seen</span><strong>{reviewedCount}</strong><small>of {QUESTIONS.length}</small></article>
              <article><span>Statement accuracy</span><strong>{overallAccuracy || "—"}{overallAccuracy ? "%" : ""}</strong><small>across all attempts</small></article>
              <article><span>Available now</span><strong>{dueCount}</strong><small>new and ready-to-revisit questions</small></article>
              <article><span>Learning coverage</span><strong>{Math.round((reviewedCount / QUESTIONS.length) * 100)}%</strong><small>{user ? "synced across devices" : "device-local progress"}</small></article>
            </div>
            <div className="domain-table-card">
              <div className="section-title"><div><span className="eyebrow">Diagnosis by domain</span><h2>Lowest confidence first</h2></div><button className="text-button" onClick={resetProgress}><RotateCcw aria-hidden="true" /> Reset progress</button></div>
              <div className="domain-table">
                {domainStats.map((row) => {
                  const rowAccuracy = row.total ? Math.round((row.correct / row.total) * 100) : 0;
                  return <div className="domain-row" key={row.label}>
                    <div><span className="area-tag">{row.area === "Machine Learning" ? "ML" : "QF"}</span><strong>{row.label}</strong></div>
                    <div className="bar"><span style={{ width: `${rowAccuracy}%` }} /></div>
                    <span>{row.total ? `${rowAccuracy}%` : "Not started"}</span><small>{row.reviewed} seen · {row.due} available</small>
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

      {setupOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSetupOpen(false); }}>
          <section className="session-modal" role="dialog" aria-modal="true" aria-labelledby="session-title">
            <div className="modal-head"><div><span className="eyebrow">Custom deck</span><h2 id="session-title">Build a focused session</h2></div><button aria-label="Close" onClick={() => setSetupOpen(false)}><X aria-hidden="true" /></button></div>
            <fieldset><legend>Exam</legend><div className="segmented">{[["all","Both"],["1","Exam 1"],["2","Exam 2"]].map(([value,label]) => <button key={value} className={examFilter === value ? "selected" : ""} onClick={() => { setExamFilter(value); setDomainFilter("all"); }}>{label}</button>)}</div></fieldset>
            <fieldset><legend>Knowledge area</legend><div className="segmented">{[["all","Mixed"],["Machine Learning","Machine Learning"],["Quantitative Finance","Quant Finance"]].map(([value,label]) => <button key={value} className={areaFilter === value ? "selected" : ""} onClick={() => { setAreaFilter(value); setDomainFilter("all"); }}>{label}</button>)}</div></fieldset>
            <label className="select-label">Domain<select value={domainFilter} onChange={(event) => setDomainFilter(event.target.value)}><option value="all">All matching domains</option>{domainOptions.map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <fieldset><legend>Questions</legend><div className="segmented compact">{[10,20,50].map((size) => <button key={size} className={sessionSize === size ? "selected" : ""} onClick={() => setSessionSize(size)}>{size}</button>)}</div></fieldset>
            <div className="modal-note"><span><Sparkles aria-hidden="true" /></span><p><strong>Available-first sequencing</strong><br />New and ready-to-revisit questions appear before recently reviewed ones.</p></div>
            <button className="start-button" onClick={startSession}>Start session <ArrowRight aria-hidden="true" /></button>
          </section>
        </div>
      )}

      {authOpen && !user && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div className="modal-head"><div><span className="eyebrow">Optional cloud sync</span><h2 id="auth-title">Study anywhere.</h2></div><button aria-label="Close" onClick={() => setAuthOpen(false)}><X aria-hidden="true" /></button></div>
            <p className="auth-intro">Keep studying without an account, or sign in to merge this device&apos;s progress and sync it across devices.</p>
            <button className="google-button" disabled={authBusy} onClick={() => void continueWithGoogle()}><span>G</span> Continue with Google</button>
            <div className="auth-divider"><span>or use a magic link</span></div>
            <form onSubmit={(event) => void sendMagicLink(event)}>
              <label>Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button className="start-button" disabled={authBusy || !email.trim()}>{authBusy ? "Sending…" : "Email me a sign-in link"}<ArrowRight aria-hidden="true" /></button>
            </form>
            {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
            <p className="auth-footnote">Supabase stores only your account and compact per-question progress. Question text and answer keys stay bundled in this app.</p>
          </section>
        </div>
      )}
    </main>
  );
}
