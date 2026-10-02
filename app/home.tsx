"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { MathText } from "./math-text";
import {
  ArrowRight,
  BookMarked,
  BookOpen,
  ChartBar,
  ClipboardCheck,
  Check,
  Cloud,
  LogOut,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import PracticeExam from "./practice-exam";
import PoolMap from "./pool-map";
import { SaveQuestionButton } from "./save-question-button";
import { useSavedQuestions } from "./use-saved-questions";
import { savedQuestionIndexes } from "../lib/saved-questions";
import { buildReviewBatch, REVIEW_REFILL_THRESHOLD } from "../lib/review-queue";

type Statement = { label: string; text: string; answer: boolean; explanation: string };
type Question = {
  id: string; exam: number; area: string; domainIndex: number; domain: string;
  groupIndex: number; group: string; page: number; negated: boolean;
  prompt: string; statements: Statement[];
};
type Tab = "review" | "study" | "progress" | "guide" | "exam";
type SessionKind = "review" | "daily" | "custom" | "study_more";

const QUESTIONS = rawQuestions as Question[];

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

function useStudySession(dailyQuestionIndexes: number[]) {
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
  return { session, setSession, sessionKind, setSessionKind, dailyReplayStarted, setDailyReplayStarted, current, setCurrent, selected, setSelected, revealed, setRevealed, sessionCorrect, setSessionCorrect, sessionStatements, setSessionStatements, sessionSkipped, setSessionSkipped, sessionDone, setSessionDone };
}

export default function Home({ dailyDateKey }: { dailyDateKey: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const tab: Tab = pathname === "/review" ? "review" : pathname === "/practice-exam" ? "exam" : pathname === "/progress" ? "progress" : pathname === "/learning-guide" ? "guide" : "study";
  const {
    histories, legacyReviews, hydrated, user, syncStatus, saveAttempt, resetHistory,
    requestMagicLink, signInWithGoogle, signOut,
  } = useAnswerHistorySync(questionKeys);
  const bookmarks = useSavedQuestions(hydrated ? (user?.id ?? null) : undefined);
  const savedIndexes = useMemo(() => new Set(savedQuestionIndexes(QUESTIONS, bookmarks.items)), [bookmarks.items]);
  const dailyQuestionIndexes = useMemo(() => getDailyQuestionIndexes(QUESTIONS, dailyDateKey), [dailyDateKey]);
  const studyState = useStudySession(dailyQuestionIndexes);
  const reviewState = useStudySession(dailyQuestionIndexes);
  const {
    session, setSession, sessionKind, setSessionKind, dailyReplayStarted, setDailyReplayStarted, current, setCurrent, selected, setSelected, revealed, setRevealed, sessionCorrect, setSessionCorrect, sessionStatements, setSessionStatements, sessionSkipped, setSessionSkipped, sessionDone, setSessionDone
  } = tab === "review" ? reviewState : studyState;
  const [activeReview, setActiveReview] = useState<string | null>(null);
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

  useEffect(() => { if (user) queueMicrotask(() => setAuthOpen(false)); }, [user]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("authError")) {
      queueMicrotask(() => { setAuthMessage("That sign-in link could not be completed. Please try signing in again. Your saved exam is still available."); setAuthOpen(true); });
    }
  }, []);

  useEffect(() => {
    if (hydrated) queueMicrotask(() => setNow(Date.now()));
  }, [hydrated]);

  useEffect(() => {
    if (
      !hydrated
      || dailyReplayStarted
      || sessionKind !== "daily"
      || sessionDone
      || current !== 0
      || revealed
      || sessionStatements > 0
    ) return;

    const completedAttempts = dailyQuestionIndexes.map((index) => {
      const questionCode = QUESTIONS[index].id;
      const dailyAttempt = histories[questionCode]?.find((attempt) => (
        attempt.source === "daily"
        && getDailyDateKey(new Date(attempt.answeredAt)) === dailyDateKey
      ));
      if (dailyAttempt) return dailyAttempt;

      const legacy = legacyReviews[questionCode];
      return legacy && getDailyDateKey(new Date(legacy.lastReviewed)) === dailyDateKey
        ? { score: legacy.lastScore, skipped: false }
        : null;
    });
    if (completedAttempts.some((attempt) => attempt === null)) return;

    const restoredCorrect = completedAttempts.reduce<number>(
      (sum, attempt) => sum + (attempt?.skipped ? 0 : (attempt?.score ?? 0)),
      0,
    );
    const restoredSkipped = completedAttempts.filter((attempt) => attempt?.skipped).length;
    queueMicrotask(() => {
      setSessionCorrect(restoredCorrect);
      setSessionStatements((dailyQuestionIndexes.length - restoredSkipped) * 5);
      setSessionSkipped(restoredSkipped);
      setSessionDone(true);
    });
  }, [current, dailyDateKey, dailyQuestionIndexes, dailyReplayStarted, histories, hydrated, legacyReviews, revealed, sessionDone, sessionKind, sessionStatements, setSessionCorrect, setSessionDone, setSessionSkipped, setSessionStatements]);

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

  const reviewDecks = useMemo(() => [
    { id: "exam-1", title: "Exam 1 deck", exam: 1, description: "Review Exam 1 material, with unseen questions first." },
    { id: "exam-2", title: "Exam 2 deck", exam: 2, description: "Review Exam 2 material, with unseen questions first." },
    { id: "saved", title: "Saved questions", exam: null, description: "Questions you chose to revisit, even when you got every statement right. Saved until you remove them." },
    { id: "missed", title: "Missed questions", exam: null, description: "Practice questions until you get every statement right. Skipped questions stay in the deck." },
  ].map((deck) => ({
    ...deck,
    candidates: QUESTIONS.map((item, index) => ({ item, index })).filter(({ item, index }) => (
      deck.id === "saved" ? savedIndexes.has(index) : deck.exam !== null ? item.exam === deck.exam : (
        progressByQuestion[item.id] && progressByQuestion[item.id].lastScore < 5
      )
    )),
  })), [progressByQuestion, savedIndexes]);
  const reviewDeck = reviewDecks.find((deck) => deck.title === activeReview);
  const reviewSessionVisible = tab === "review" && sessionKind === "review" && activeReview !== null;
  const studySessionVisible = tab === "study" || reviewSessionVisible;
  const startReview = (deck: typeof reviewDecks[number], startedAt: number) => {
    if (!hydrated) return;
    setSession(deck.id === "saved" ? deck.candidates.map(({ index }) => index) : buildReviewBatch(deck.candidates, progressByQuestion, [], [], startedAt, deck.exam !== null));
    setSessionKind("review");
    setActiveReview(deck.title);
    setDailyReplayStarted(false);
    setCurrent(0); setSelected([]); setRevealed(false); setSessionDone(!deck.candidates.length);
    setSessionCorrect(0); setSessionStatements(0); setSessionSkipped(0);
  };

  useEffect(() => {
    if (tab !== "review" || !hydrated || sessionKind !== "review" || !reviewDeck || reviewDeck.id === "saved" || sessionDone
      || session.length - current - 1 > REVIEW_REFILL_THRESHOLD) return;
    // The catalog is local; prepare the next batch between interactions.
    const timer = window.setTimeout(() => {
      const batch = buildReviewBatch(reviewDeck.candidates, progressByQuestion,
        session.slice(0, current), session.slice(current), Date.now(), reviewDeck.exam !== null);
      if (batch.length) setSession((queue) => [...queue, ...batch]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [current, hydrated, progressByQuestion, reviewDeck, session, sessionDone, sessionKind, setSession, tab]);

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
    const startedAt = Date.now();
    const candidates = QUESTIONS.map((item, index) => ({ item, index }))
      .filter(({ item }) => examFilter === "all" || String(item.exam) === examFilter)
      .filter(({ item }) => areaFilter === "all" || item.area === areaFilter)
      .filter(({ item }) => domainFilter === "all" || `${item.exam}-${item.area}-${item.domainIndex}` === domainFilter);
    studyState.setSession(
      buildQuestionQueue(candidates, progressByQuestion, startedAt).slice(0, sessionSize),
    );
    studyState.setSessionKind("custom");
    studyState.setDailyReplayStarted(false);
    studyState.setCurrent(0); studyState.setSelected([]); studyState.setRevealed(false); studyState.setSessionDone(false);
    studyState.setSessionCorrect(0); studyState.setSessionStatements(0); studyState.setSessionSkipped(0); setSetupOpen(false); router.push("/");
  };

  // Pool map selections, most useful first; sessions cap at 50 like custom decks.
  const practiceQuestions = (indexes: number[]) => {
    const startedAt = Date.now();
    studyState.setSession(
      buildQuestionQueue(indexes.map((index) => ({ item: QUESTIONS[index], index })), progressByQuestion, startedAt).slice(0, 50),
    );
    studyState.setSessionKind("custom");
    studyState.setDailyReplayStarted(false);
    studyState.setCurrent(0); studyState.setSelected([]); studyState.setRevealed(false); studyState.setSessionDone(false);
    studyState.setSessionCorrect(0); studyState.setSessionStatements(0); studyState.setSessionSkipped(0); router.push("/");
  };

  const startStudyMore = () => {
    const startedAt = Date.now();
    const candidates = QUESTIONS.map((item, index) => ({ item, index }))
      .filter(({ item }) => item.exam === DAILY_EXAM);
    studyState.setSession(
      buildQuestionQueue(candidates, progressByQuestion, startedAt, true).slice(0, 10),
    );
    studyState.setSessionKind("study_more");
    studyState.setDailyReplayStarted(false);
    studyState.setCurrent(0); studyState.setSelected([]); studyState.setRevealed(false); studyState.setSessionDone(false);
    studyState.setSessionCorrect(0); studyState.setSessionStatements(0); studyState.setSessionSkipped(0); router.push("/");
  };

  const restartDaily = () => {
    studyState.setSession(dailyQuestionIndexes);
    studyState.setSessionKind("daily");
    studyState.setDailyReplayStarted(true);
    studyState.setCurrent(0); studyState.setSelected([]); studyState.setRevealed(false); studyState.setSessionDone(false);
    studyState.setSessionCorrect(0); studyState.setSessionStatements(0); studyState.setSessionSkipped(0); router.push("/");
  };

  const checkAnswer = useCallback(() => {
    if (revealed || sessionDone) return;
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
  }, [question.id, resultCount, revealed, saveAttempt, selected, sessionDone, sessionKind, setRevealed, setSessionCorrect, setSessionStatements]);

  const nextQuestion = useCallback(() => {
    if (sessionKind === "review" && reviewDeck) {
      // Remove questions mastered since prefetching, then refill synchronously if needed.
      const eligible = new Set(reviewDeck.candidates.map(({ index }) => index));
      let pending = session.slice(current + 1).filter((index) => eligible.has(index));
      if (!pending.length && reviewDeck.id !== "saved") pending = buildReviewBatch(reviewDeck.candidates, progressByQuestion,
        session.slice(0, current + 1), [], Date.now(), reviewDeck.exam !== null);
      if (!pending.length) { setSessionDone(true); return; }
      setSession([...session.slice(0, current + 1), ...pending]);
      setCurrent(current + 1); setSelected([]); setRevealed(false);
      return;
    }
    if (current + 1 >= session.length) setSessionDone(true);
    else { setCurrent((value) => value + 1); setSelected([]); setRevealed(false); }
  }, [current, progressByQuestion, reviewDeck, session, sessionKind, setCurrent, setRevealed, setSelected, setSession, setSessionDone]);

  const skipQuestion = useCallback(() => {
    if (revealed || sessionDone) return;
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
  }, [nextQuestion, question.id, revealed, saveAttempt, sessionDone, sessionKind, setSessionSkipped]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (setupOpen) setSetupOpen(false);
        if (authOpen) setAuthOpen(false);
        return;
      }
      if (setupOpen || authOpen || !studySessionVisible || sessionDone) return;
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
  }, [authOpen, checkAnswer, nextQuestion, revealed, sessionDone, setupOpen, studySessionVisible, setSelected]);

  const resetProgress = () => {
    if (!hydrated || syncStatus === "syncing") return;
    const scope = user ? "synced answer history on every device" : "device-local answer history";
    if (window.confirm(`Reset study practice in ${scope}? Exam history will be preserved. This cannot be undone.`)) void resetHistory();
  };

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthBusy(true);
    const error = await requestMagicLink(email.trim(), tab === "exam" ? "/practice-exam" : pathname);
    setAuthMessage(error ?? "Check your email for a secure sign-in link.");
    setAuthBusy(false);
  };

  const continueWithGoogle = async () => {
    setAuthBusy(true);
    const error = await signInWithGoogle(tab === "exam" ? "/practice-exam" : pathname);
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
          <Link className={`nav-item ${tab === "review" ? "active" : ""}`} aria-current={tab === "review" ? "page" : undefined} href="/review"><RotateCcw aria-hidden="true" /> Review</Link>
          <Link className={`nav-item ${tab === "exam" ? "active" : ""}`} aria-current={tab === "exam" ? "page" : undefined} href="/practice-exam"><ClipboardCheck aria-hidden="true" /> Practice Exam</Link>
          <Link className={`nav-item ${tab === "progress" ? "active" : ""}`} aria-current={tab === "progress" ? "page" : undefined} href="/progress"><ChartBar aria-hidden="true" /> Progress</Link>
          <Link className={`nav-item ${tab === "guide" ? "active" : ""}`} aria-current={tab === "guide" ? "page" : undefined} href="/learning-guide"><BookMarked aria-hidden="true" /> Learning guide</Link>
        </nav>
        <div className="sidebar-stats">
          <span>{reviewedCount}<small>seen</small></span><span>{unseenCount}<small>unseen</small></span>
        </div>
        <div className="sidebar-note"><span className={`status-dot ${syncStatus}`} /><p><strong>{syncLabel}</strong><br />{QUESTIONS.length} questions in your library</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{tab === "study" ? (sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : sessionKind === "study_more" ? `Study 10 more · Exam ${DAILY_EXAM}` : "Study session") : tab === "review" ? "Your review library" : tab === "progress" ? "Learning signal" : tab === "exam" ? "The exam room" : "How to use the pool"}</span>
            <h1>{tab === "study" ? (sessionKind === "daily" ? "Today’s five are ready." : sessionKind === "study_more" ? "Keep the momentum going." : "Practice with intent.") : tab === "review" ? (reviewSessionVisible ? activeReview : "Choose a deck. Keep learning.") : tab === "progress" ? "See what needs attention." : tab === "exam" ? "Put your preparation to the test." : "Make every question useful."}</h1>
            <p className="topbar-subtitle">{tab === "study" ? (sessionKind === "daily" ? `The same five Exam ${DAILY_EXAM} questions for every student, refreshed each day.` : sessionKind === "study_more" ? "Ten more questions, with unseen material first." : "Due reviews come first, followed by unseen questions.") : tab === "review" ? (reviewSessionVisible && reviewDeck?.id === "saved" ? "Work through your saved questions once. Your bookmarks stay saved for next time." : "Keep reviewing at your own pace. Choose a deck or revisit your saved questions.") : tab === "progress" ? "Coverage and confidence, organized by domain." : tab === "exam" ? "A full-length rehearsal, at your own desk." : "A simple loop for turning recall into durable understanding."}</p>
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            {user ? (
              <div className="account-chip">
                <span><strong>{user.email}</strong><small>{syncLabel}</small></span>
                <button onClick={() => void signOut()}><LogOut aria-hidden="true" /> Sign out</button>
              </div>
            ) : (
              <button className="sync-button" onClick={() => { setAuthMessage(""); setAuthOpen(true); }}><Cloud aria-hidden="true" /> Sync progress</button>
            )}
            {tab !== "exam" && <button className="new-session" onClick={() => setSetupOpen(true)}>New session <Plus aria-hidden="true" /></button>}
          </div>
        </header>

        {(bookmarks.status === "offline" || bookmarks.storageError) && (
          <p className="bookmark-status" role="status">
            {bookmarks.storageError ? "Bookmarks could not be saved on this device. Keep this page open until they sync." : "Bookmarks saved on this device. Cloud sync is unavailable."}
            <button className="text-button" onClick={bookmarks.retry}>Retry bookmark sync</button>
          </p>
        )}

        <PracticeExam savedQuestions={bookmarks.items} bookmarksReady={bookmarks.ready} onToggleSaved={bookmarks.toggle} userId={user?.id ?? null} visible={tab === "exam"} onSignIn={() => { setAuthMessage(""); setAuthOpen(true); }} />

        {tab === "review" && !reviewSessionVisible && (
          <section className="review-decks" aria-label="Review decks">
            {reviewDecks.map((deck) => (
              <article className="review-deck" key={deck.id}>
                <span className="eyebrow">{deck.id === "saved" ? "Your collection" : deck.exam ? "Unseen first" : "Learn from mistakes"}</span>
                <h2>{deck.title}</h2>
                <p>{deck.description}</p>
                <small>{(!hydrated || (deck.id === "saved" && !bookmarks.ready)) ? "Loading your history…" : `${deck.candidates.length} questions${deck.exam ? ` · ${deck.candidates.filter(({ item }) => !progressByQuestion[item.id]).length} unseen` : ""}`}</small>
                <button className="check-button" disabled={!hydrated || (deck.id === "saved" && (!bookmarks.ready || !deck.candidates.length))} onClick={() => startReview(deck, Date.now())}>{deck.candidates.length ? "Start reviewing" : deck.id === "saved" ? "No saved questions" : "View completion"} <ArrowRight aria-hidden="true" /></button>
                {hydrated && (deck.id !== "saved" || bookmarks.ready) && !deck.candidates.length && <p>{deck.id === "saved" ? "No saved questions yet. Choose Save for review on any question to add it here." : "All caught up! You have no missed questions to review."}</p>}
              </article>
            ))}
          </section>
        )}
        {reviewSessionVisible && <button className="secondary-button review-back" onClick={() => setActiveReview(null)}>Back to decks</button>}

        {studySessionVisible && !sessionDone && (
          <div className="study-layout">
            <article className="question-card">
              <div className="question-meta"><span>EXAM {question.exam} · {question.area.toUpperCase()}</span><span>{question.id} · PDF {question.page}</span></div>
              {sessionKind !== "review" && <div className="progress-line"><span style={{ width: `${((current + 1) / session.length) * 100}%` }} /></div>}
              <div className="question-heading">
                <div><p className="counter">Question {current + 1}{(sessionKind !== "review" || reviewDeck?.id === "saved") && ` of ${session.length}`}</p><h2>{question.group}</h2></div>
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
                <div className="question-actions">
                  <button className="skip-button" onClick={skipQuestion}>Skip for now</button>
                  <div className="question-action-buttons">
                    <SaveQuestionButton questionId={question.id} saved={!!bookmarks.items[question.id]?.saved} ready={bookmarks.ready} onToggle={bookmarks.toggle} />
                    <button className="check-button" key="check-answer" onClick={checkAnswer}>Check all 5 statements <ArrowRight aria-hidden="true" /></button>
                  </div>
                </div>
              ) : (
                <div className="answer-result">
                  <div><span className="answer-score">{resultCount}/5</span><p>{resultCount === 5 ? "Saved. Your next review was scheduled automatically." : (sessionKind === "review" ? "Saved. You’ll get another chance to practice this question." : "Saved. This question will return tomorrow.")}</p></div>
                  <div className="question-action-buttons">
                    <SaveQuestionButton questionId={question.id} saved={!!bookmarks.items[question.id]?.saved} ready={bookmarks.ready} onToggle={bookmarks.toggle} />
                    <button className="check-button" key="next-question" onClick={nextQuestion}>{sessionKind === "review" ? ((reviewDeck?.id === "saved" ? !session.slice(current + 1).some((index) => savedIndexes.has(index)) : reviewDeck?.candidates.length === 0) ? "Finish review" : "Next question") : current + 1 >= session.length ? "Finish session" : "Next question"} <ArrowRight aria-hidden="true" /></button>
                  </div>
                </div>
              )}
            </article>

            <aside className="session-panel">
              <span className="eyebrow">{sessionKind === "daily" ? `Daily 5 · Exam ${DAILY_EXAM}` : sessionKind === "study_more" ? "Study 10 more" : "This session"}</span>
              <div className="score-ring" style={{ "--score": `${sessionAccuracy || 0}%` } as React.CSSProperties}><strong>{sessionStatements ? `${sessionAccuracy}%` : "—"}</strong><span>accuracy</span></div>
              <dl><div><dt>{sessionKind === "review" ? "Reviewed" : "Remaining"}</dt><dd>{sessionKind === "review" ? sessionStatements / 5 : session.length - current}</dd></div><div><dt>Statements</dt><dd>{sessionStatements}</dd></div><div><dt>Due reviews</dt><dd>{dueReviewCount}</dd></div></dl>
              <div className="focus-box"><span>Current domain</span><strong>{question.domain}</strong><small>{question.area} · Exam {question.exam}</small></div>
              <p className="key-hint"><kbd>1–5</kbd> toggle · <kbd>Enter</kbd> {revealed ? "next" : "check"}</p>
            </aside>
          </div>
        )}

        {studySessionVisible && sessionDone && (
          <section className="completion-card">
            <span className="completion-mark"><Check aria-hidden="true" /></span><span className="eyebrow">{sessionKind === "daily" ? "Completed for today" : sessionKind === "study_more" ? "Extra study complete" : "Session complete"}</span>
            <h2>{reviewSessionVisible ? (reviewDeck?.id === "saved" ? "Saved questions session complete" : "All caught up!") : sessionStatements ? `${sessionAccuracy}% statement accuracy` : "No questions answered"}</h2>
            <p>{reviewSessionVisible ? (reviewDeck?.id === "saved" ? "Your bookmarks stay saved, including questions you answered correctly. Review them again anytime, or remove them when you feel confident." : "You have no missed questions left to review. Come back after more practice to keep building your understanding.") : sessionKind === "daily" ? `You completed today’s shared Exam ${DAILY_EXAM} set: ${session.length - sessionSkipped} answered and ${sessionSkipped} skipped. Submitted answers are saved and review timing is updated automatically.` : `You worked through ${session.length} questions: ${session.length - sessionSkipped} answered and ${sessionSkipped} skipped. Submitted answers are saved and imperfect answers will return in the review queue.`}</p>
            {reviewSessionVisible ? (
              <div><button className="check-button" onClick={() => setActiveReview(null)}>Back to decks <ArrowRight aria-hidden="true" /></button></div>
            ) : sessionKind === "daily" ? (
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
            <PoolMap questions={QUESTIONS} progress={progressByQuestion} saved={bookmarks.items} savedReady={bookmarks.ready} onToggleSaved={bookmarks.toggle} now={now} hydrated={hydrated} onPractice={practiceQuestions} />
            <div className="progress-reset">
              <p>Reset clears study answers {user ? "on every synced device" : "on this device"}. Exam history is kept.</p>
              <button className="text-button" disabled={!hydrated || syncStatus === "syncing"} onClick={resetProgress}><RotateCcw aria-hidden="true" /> Reset progress</button>
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
            <p className="source-line">Built from {QUESTIONS.length} active questions in <strong>ML4T Exam Question Pool</strong>, revision 08.10.2026. Withdrawn questions are excluded. This learning companion supports—but does not replace—lectures, readings, projects, or course announcements.</p>
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
            <div className="modal-note"><span><Sparkles aria-hidden="true" /></span><p><strong>Review-first sequencing</strong><br />Due reviews appear first, followed by unseen questions and then future reviews.</p></div>
            <button className="start-button" onClick={startSession}>Start session <ArrowRight aria-hidden="true" /></button>
          </section>
        </div>
      )}

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <div className="modal-head"><div><span className="eyebrow">{tab === "exam" ? "Practice exam sign-in" : "Optional cloud sync"}</span><h2 id="auth-title">{tab === "exam" ? "Save your exam journey." : "Study anywhere."}</h2></div><button aria-label="Close" onClick={() => setAuthOpen(false)}><X aria-hidden="true" /></button></div>
            <p className="auth-intro">{tab === "exam" ? "Sign in to start exams and sync your history. You’ll return here after signing in; the timer starts only when you choose Start Exam. Study practice remains available without an account." : "Keep studying without an account, or sign in to merge this device’s progress and sync it across devices."}</p>
            <button className="google-button" disabled={authBusy} onClick={() => void continueWithGoogle()}><span>G</span> Continue with Google</button>
            <div className="auth-divider"><span>or use a magic link</span></div>
            <form onSubmit={(event) => void sendMagicLink(event)}>
              <label>Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <button className="start-button" disabled={authBusy || !email.trim()}>{authBusy ? "Sending…" : "Email me a sign-in link"}<ArrowRight aria-hidden="true" /></button>
            </form>
            {authMessage && <p className="auth-message" role="status">{authMessage}</p>}
            <p className="auth-footnote">Your account, answer history, saved questions, and exam sessions are saved so you can continue across devices.</p>
          </section>
        </div>
      )}
    </main>
  );
}
