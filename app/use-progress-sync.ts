"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ANONYMOUS_STORAGE_KEY,
  IMPORT_OWNER_KEY,
  SYNC_BATCH_SIZE,
  chunk,
  cloudCacheKey,
  getNewerReviews,
  mergeByNewest,
  progressRowsToReviews,
  readReviewMap,
  reviewToProgressInsert,
  writeReviewMap,
  type Review,
  type ReviewMap,
} from "../lib/progress";
import { createClient } from "../lib/supabase/client";

export type SyncStatus = "device" | "syncing" | "synced" | "offline";

export function useProgressSync(questionKeys: Record<string, number>) {
  const supabase = useMemo(() => createClient(), []);
  const questionKeyByCode = useMemo(
    () => new Map(Object.entries(questionKeys)),
    [questionKeys],
  );
  const codeByQuestionKey = useMemo(
    () => new Map(Object.entries(questionKeys).map(([code, key]) => [key, code])),
    [questionKeys],
  );
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("device");
  const activeStorageKey = useRef(ANONYMOUS_STORAGE_KEY);
  const currentUser = useRef<User | null>(null);
  const pending = useRef(new Map<string, Review>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushPendingRef = useRef<() => Promise<void>>(async () => {});
  const flushing = useRef(false);
  const syncRun = useRef(0);

  const persist = useCallback((nextReviews: ReviewMap) => {
    writeReviewMap(window.localStorage, activeStorageKey.current, nextReviews);
  }, []);

  const upsertReviews = useCallback(async (userId: string, items: ReviewMap) => {
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

  const initializeUser = useCallback(async (nextUser: User) => {
    const run = ++syncRun.current;
    const userId = nextUser.id;
    const cacheKey = cloudCacheKey(userId);
    activeStorageKey.current = cacheKey;
    currentUser.current = nextUser;
    setUser(nextUser);
    setSyncStatus("syncing");

    const userCache = readReviewMap(window.localStorage, cacheKey);
    let candidate = userCache;

    try {
      const [progressResult, markerResult] = await Promise.all([
        supabase
          .from("user_question_progress")
          .select("*")
          .eq("user_id", userId)
          .order("available_at", { ascending: true }),
        supabase
          .from("user_sync_state")
          .select("initial_local_import_completed_at")
          .eq("user_id", userId)
          .maybeSingle(),
      ]);

      if (progressResult.error) throw progressResult.error;
      if (markerResult.error) throw markerResult.error;

      const markerExists = Boolean(markerResult.data);
      const importOwner = window.localStorage.getItem(IMPORT_OWNER_KEY);
      if (!markerExists && (!importOwner || importOwner === userId)) {
        candidate = mergeByNewest(
          readReviewMap(window.localStorage, ANONYMOUS_STORAGE_KEY),
          userCache,
        );
      }

      const cloud = progressRowsToReviews(
        progressResult.data ?? [],
        codeByQuestionKey,
      );
      const localNewer = getNewerReviews(candidate, cloud);
      if (Object.keys(localNewer).length) await upsertReviews(userId, localNewer);

      if (!markerExists) {
        const { error } = await supabase.from("user_sync_state").upsert(
          {
            user_id: userId,
            initial_local_import_completed_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (error) throw error;
        if (!importOwner) window.localStorage.setItem(IMPORT_OWNER_KEY, userId);
      }

      if (run !== syncRun.current || currentUser.current?.id !== userId) return;
      const merged = mergeByNewest(candidate, cloud);
      setReviews(merged);
      writeReviewMap(window.localStorage, cacheKey, merged);
      setSyncStatus("synced");
    } catch {
      if (run !== syncRun.current || currentUser.current?.id !== userId) return;
      setReviews(candidate);
      writeReviewMap(window.localStorage, cacheKey, candidate);
      setSyncStatus("offline");
    }
  }, [codeByQuestionKey, supabase, upsertReviews]);

  const switchToDevice = useCallback(() => {
    syncRun.current += 1;
    currentUser.current = null;
    activeStorageKey.current = ANONYMOUS_STORAGE_KEY;
    pending.current.clear();
    setUser(null);
    setReviews(readReviewMap(window.localStorage, ANONYMOUS_STORAGE_KEY));
    setSyncStatus("device");
  }, []);

  const flushPending = useCallback(async () => {
    if (flushing.current || !currentUser.current || pending.current.size === 0) return;
    flushing.current = true;
    const activeUser = currentUser.current;
    const queued = Object.fromEntries(pending.current);
    pending.current.clear();

    try {
      await upsertReviews(activeUser.id, queued);
      if (currentUser.current?.id === activeUser.id) setSyncStatus("synced");
    } catch {
      for (const [code, review] of Object.entries(queued)) {
        const newer = pending.current.get(code);
        if (!newer || review.lastReviewed > newer.lastReviewed) {
          pending.current.set(code, review);
        }
      }
      if (currentUser.current?.id === activeUser.id) setSyncStatus("offline");
    } finally {
      flushing.current = false;
      if (pending.current.size && navigator.onLine) {
        flushTimer.current = setTimeout(
          () => void flushPendingRef.current(),
          1_200,
        );
      }
    }
  }, [upsertReviews]);

  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  const saveReview = useCallback((code: string, review: Review) => {
    setReviews((current) => {
      const next = { ...current, [code]: review };
      persist(next);
      return next;
    });

    if (!currentUser.current) return;
    pending.current.set(code, review);
    setSyncStatus(navigator.onLine ? "syncing" : "offline");
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => void flushPendingRef.current(), 900);
  }, [persist]);

  const resetReviews = useCallback(async () => {
    setReviews({});
    persist({});
    pending.current.clear();
    const activeUser = currentUser.current;
    if (!activeUser) return;

    setSyncStatus("syncing");
    const { error } = await supabase
      .from("user_question_progress")
      .delete()
      .eq("user_id", activeUser.id);
    setSyncStatus(error ? "offline" : "synced");
  }, [persist, supabase]);

  useEffect(() => {
    const anonymous = readReviewMap(window.localStorage, ANONYMOUS_STORAGE_KEY);
    queueMicrotask(() => {
      setReviews(anonymous);
      setHydrated(true);
    });

    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) void initializeUser(data.user);
    });

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

  return {
    reviews,
    hydrated,
    user,
    syncStatus,
    saveReview,
    resetReviews,
    requestMagicLink,
    signInWithGoogle,
    signOut,
  };
}
