"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ANONYMOUS_ATTEMPT_STORAGE_KEY,
  ATTEMPT_IMPORT_OWNER_KEY,
  SYNC_BATCH_SIZE,
  attemptCloudCacheKey,
  attemptRowsToMap,
  attemptToInsert,
  buildAnswerHistories,
  chunk,
  getMissingAttempts,
  mergeAttempts,
  readAttemptMap,
  writeAttemptMap,
  type AnswerAttempt,
  type AttemptMap,
  type AttemptRow,
  type AttemptSource,
} from "../lib/answer-history";
import {
  ANONYMOUS_STORAGE_KEY,
  IMPORT_OWNER_KEY,
  cloudCacheKey,
  getNewerReviews,
  mergeByNewest,
  progressRowsToReviews,
  readReviewMap,
  reviewToProgressInsert,
  writeReviewMap,
  type ReviewMap,
} from "../lib/progress";
import { createClient } from "../lib/supabase/client";

export type SyncStatus = "device" | "syncing" | "synced" | "offline";

const ATTEMPT_FETCH_PAGE_SIZE = 1_000;

function readStorageValue(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Answer data is already persisted separately; this marker is advisory.
  }
}

export function useAnswerHistorySync(questionKeys: Record<string, number>) {
  const supabase = useMemo(() => createClient(), []);
  const questionKeyByCode = useMemo(
    () => new Map(Object.entries(questionKeys)),
    [questionKeys],
  );
  const codeByQuestionKey = useMemo(
    () => new Map(Object.entries(questionKeys).map(([code, key]) => [key, code])),
    [questionKeys],
  );
  const [attempts, setAttempts] = useState<AttemptMap>({});
  const [legacyReviews, setLegacyReviews] = useState<ReviewMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("device");
  const activeAttemptStorageKey = useRef(ANONYMOUS_ATTEMPT_STORAGE_KEY);
  const activeLegacyStorageKey = useRef(ANONYMOUS_STORAGE_KEY);
  const currentUser = useRef<User | null>(null);
  const pending = useRef(new Map<string, AnswerAttempt>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => Promise<void>>(async () => {});
  const flushing = useRef(false);
  const syncRun = useRef(0);

  const persistAttempts = useCallback((nextAttempts: AttemptMap) => {
    writeAttemptMap(window.localStorage, activeAttemptStorageKey.current, nextAttempts);
  }, []);

  const persistLegacyReviews = useCallback((nextReviews: ReviewMap) => {
    writeReviewMap(window.localStorage, activeLegacyStorageKey.current, nextReviews);
  }, []);

  const insertAttempts = useCallback(async (userId: string, items: AttemptMap) => {
    const rows = Object.values(items).flatMap((attempt) => {
      const questionKey = questionKeyByCode.get(attempt.questionCode);
      return questionKey
        ? [attemptToInsert(userId, questionKey, attempt)]
        : [];
    });

    for (const batch of chunk(rows, SYNC_BATCH_SIZE)) {
      const { error } = await supabase
        .from("user_question_attempts")
        .upsert(batch, {
          onConflict: "user_id,attempt_id",
          ignoreDuplicates: true,
        });
      if (error) throw error;
    }
  }, [questionKeyByCode, supabase]);

  const upsertLegacyReviews = useCallback(async (userId: string, items: ReviewMap) => {
    const rows = Object.entries(items).flatMap(([code, review]) => {
      const questionKey = questionKeyByCode.get(code);
      return questionKey
        ? [reviewToProgressInsert(userId, questionKey, review)]
        : [];
    });

    for (const batch of chunk(rows, SYNC_BATCH_SIZE)) {
      const { error } = await supabase
        .from("user_question_progress")
        .upsert(batch, { onConflict: "user_id,question_key" });
      if (error) throw error;
    }
  }, [questionKeyByCode, supabase]);

  const fetchCloudAttempts = useCallback(async (userId: string) => {
    const rows: AttemptRow[] = [];

    for (let from = 0; ; from += ATTEMPT_FETCH_PAGE_SIZE) {
      const { data, error } = await supabase
        .from("user_question_attempts")
        .select("*")
        .eq("user_id", userId)
        .order("answered_at", { ascending: true })
        .order("attempt_id", { ascending: true })
        .range(from, from + ATTEMPT_FETCH_PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < ATTEMPT_FETCH_PAGE_SIZE) break;
    }

    return rows;
  }, [supabase]);

  const initializeUser = useCallback(async (nextUser: User) => {
    const run = ++syncRun.current;
    const userId = nextUser.id;
    const attemptCacheKey = attemptCloudCacheKey(userId);
    const legacyCacheKey = cloudCacheKey(userId);
    if (currentUser.current?.id !== userId) {
      pending.current.clear();
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    }
    activeAttemptStorageKey.current = attemptCacheKey;
    activeLegacyStorageKey.current = legacyCacheKey;
    currentUser.current = nextUser;
    setUser(nextUser);
    setHydrated(false);
    setSyncStatus("syncing");

    const attemptCache = readAttemptMap(window.localStorage, attemptCacheKey);
    const legacyCache = readReviewMap(window.localStorage, legacyCacheKey);
    let attemptCandidate = attemptCache;
    let legacyCandidate = legacyCache;

    try {
      const [attemptResult, progressResult, markerResult] = await Promise.all([
        fetchCloudAttempts(userId),
        supabase
          .from("user_question_progress")
          .select("*")
          .eq("user_id", userId)
          .order("available_at", { ascending: true }),
        supabase
          .from("user_sync_state")
          .select("initial_local_import_completed_at,answer_history_import_completed_at")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      if (progressResult.error) throw progressResult.error;
      if (markerResult.error) throw markerResult.error;

      const legacyMarkerExists = Boolean(
        markerResult.data?.initial_local_import_completed_at,
      );
      const attemptMarkerExists = Boolean(
        markerResult.data?.answer_history_import_completed_at,
      );
      const legacyImportOwner = readStorageValue(IMPORT_OWNER_KEY);
      const attemptImportOwner = readStorageValue(ATTEMPT_IMPORT_OWNER_KEY);

      if (!legacyMarkerExists && (!legacyImportOwner || legacyImportOwner === userId)) {
        legacyCandidate = mergeByNewest(
          readReviewMap(window.localStorage, ANONYMOUS_STORAGE_KEY),
          legacyCache,
        );
      }
      if (!attemptMarkerExists && (!attemptImportOwner || attemptImportOwner === userId)) {
        attemptCandidate = mergeAttempts(
          readAttemptMap(window.localStorage, ANONYMOUS_ATTEMPT_STORAGE_KEY),
          attemptCache,
        );
      }

      const cloudAttempts = attemptRowsToMap(
        attemptResult,
        codeByQuestionKey,
      );
      const cloudLegacy = progressRowsToReviews(
        progressResult.data ?? [],
        codeByQuestionKey,
      );
      const missingAttempts = getMissingAttempts(attemptCandidate, cloudAttempts);
      const newerLegacy = getNewerReviews(legacyCandidate, cloudLegacy);
      if (Object.keys(missingAttempts).length) {
        await insertAttempts(userId, missingAttempts);
      }
      if (Object.keys(newerLegacy).length) {
        await upsertLegacyReviews(userId, newerLegacy);
      }

      const importedAt = new Date().toISOString();
      if (!markerResult.data) {
        const { error } = await supabase.from("user_sync_state").upsert(
          {
            user_id: userId,
            initial_local_import_completed_at: importedAt,
            answer_history_import_completed_at: importedAt,
          },
          { onConflict: "user_id" },
        );
        if (error) throw error;
      } else if (!attemptMarkerExists) {
        const { error } = await supabase
          .from("user_sync_state")
          .update({ answer_history_import_completed_at: importedAt })
          .eq("user_id", userId);
        if (error) throw error;
      }
      if (!legacyImportOwner) writeStorageValue(IMPORT_OWNER_KEY, userId);
      if (!attemptImportOwner) {
        writeStorageValue(ATTEMPT_IMPORT_OWNER_KEY, userId);
      }

      if (run !== syncRun.current || currentUser.current?.id !== userId) return;
      const mergedAttempts = mergeAttempts(
        readAttemptMap(window.localStorage, attemptCacheKey),
        mergeAttempts(attemptCandidate, cloudAttempts),
      );
      const mergedLegacy = mergeByNewest(legacyCandidate, cloudLegacy);
      setAttempts(mergedAttempts);
      setLegacyReviews(mergedLegacy);
      writeAttemptMap(window.localStorage, attemptCacheKey, mergedAttempts);
      writeReviewMap(window.localStorage, legacyCacheKey, mergedLegacy);
      setHydrated(true);
      setSyncStatus("synced");
    } catch {
      if (run !== syncRun.current || currentUser.current?.id !== userId) return;
      const offlineAttempts = mergeAttempts(
        readAttemptMap(window.localStorage, attemptCacheKey),
        attemptCandidate,
      );
      setAttempts(offlineAttempts);
      setLegacyReviews(legacyCandidate);
      writeAttemptMap(window.localStorage, attemptCacheKey, offlineAttempts);
      writeReviewMap(window.localStorage, legacyCacheKey, legacyCandidate);
      setHydrated(true);
      setSyncStatus("offline");
    }
  }, [codeByQuestionKey, fetchCloudAttempts, insertAttempts, supabase, upsertLegacyReviews]);

  const switchToDevice = useCallback(() => {
    syncRun.current += 1;
    currentUser.current = null;
    activeAttemptStorageKey.current = ANONYMOUS_ATTEMPT_STORAGE_KEY;
    activeLegacyStorageKey.current = ANONYMOUS_STORAGE_KEY;
    pending.current.clear();
    setUser(null);
    setAttempts(readAttemptMap(window.localStorage, ANONYMOUS_ATTEMPT_STORAGE_KEY));
    setLegacyReviews(readReviewMap(window.localStorage, ANONYMOUS_STORAGE_KEY));
    setHydrated(true);
    setSyncStatus("device");
  }, []);

  const flushPending = useCallback(async () => {
    if (flushing.current || !currentUser.current || pending.current.size === 0) return;
    flushing.current = true;
    const activeUser = currentUser.current;
    const queued = Object.fromEntries(pending.current);
    pending.current.clear();

    try {
      await insertAttempts(activeUser.id, queued);
      if (currentUser.current?.id === activeUser.id) setSyncStatus("synced");
    } catch {
      if (currentUser.current?.id === activeUser.id) {
        for (const [id, attempt] of Object.entries(queued)) {
          pending.current.set(id, attempt);
        }
        setSyncStatus("offline");
      }
    } finally {
      flushing.current = false;
      if (pending.current.size && navigator.onLine) {
        flushTimer.current = setTimeout(
          () => void flushPendingRef.current(),
          1_200,
        );
      }
    }
  }, [insertAttempts]);

  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  const saveAttempt = useCallback((
    questionCode: string,
    answerMask: number,
    score: number,
    source: AttemptSource,
    answeredAt = Date.now(),
    skipped = false,
  ) => {
    const attempt: AnswerAttempt = {
      id: crypto.randomUUID(),
      questionCode,
      answerMask,
      score,
      source,
      answeredAt,
      skipped,
    };

    setAttempts((current) => {
      const next = { ...current, [attempt.id]: attempt };
      persistAttempts(next);
      return next;
    });

    if (currentUser.current) {
      pending.current.set(attempt.id, attempt);
      setSyncStatus(navigator.onLine ? "syncing" : "offline");
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flushPendingRef.current(), 900);
    }

    return attempt;
  }, [persistAttempts]);

  const resetHistory = useCallback(async () => {
    setAttempts({});
    setLegacyReviews({});
    persistAttempts({});
    persistLegacyReviews({});
    pending.current.clear();
    const activeUser = currentUser.current;
    if (!activeUser) return;

    setSyncStatus("syncing");
    const [attemptResult, progressResult] = await Promise.all([
      supabase
        .from("user_question_attempts")
        .delete()
        .eq("user_id", activeUser.id),
      supabase
        .from("user_question_progress")
        .delete()
        .eq("user_id", activeUser.id),
    ]);
    setSyncStatus(attemptResult.error || progressResult.error ? "offline" : "synced");
  }, [persistAttempts, persistLegacyReviews, supabase]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        queueMicrotask(() => {
          if (session?.user) void initializeUser(session.user);
          else switchToDevice();
        });
      },
    );

    const handleOnline = () => {
      if (currentUser.current) void initializeUser(currentUser.current);
    };
    window.addEventListener("online", handleOnline);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [initializeUser, supabase, switchToDevice]);

  const requestMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    return error?.message ?? null;
  }, [supabase]);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    return error?.message ?? null;
  }, [supabase]);

  const signOut = useCallback(async () => {
    await flushPendingRef.current();
    const { error } = await supabase.auth.signOut();
    if (!error) switchToDevice();
    return error?.message ?? null;
  }, [supabase, switchToDevice]);

  const histories = useMemo(() => buildAnswerHistories(attempts), [attempts]);

  return {
    histories,
    legacyReviews,
    hydrated,
    user,
    syncStatus,
    saveAttempt,
    resetHistory,
    requestMagicLink,
    signInWithGoogle,
    signOut,
  };
}
