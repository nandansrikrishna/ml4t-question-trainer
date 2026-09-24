"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import questionKeys from "./data/question-keys.json";
import { createClient } from "../lib/supabase/client";
import { mergeSavedQuestions, readSavedQuestions, savedQuestionsKey, type SavedQuestions } from "../lib/saved-questions";

const keys: Record<string, number> = questionKeys;
const codes = new Map(Object.entries(keys).map(([code, key]) => [key, code]));
type Status = "device" | "syncing" | "synced" | "offline";
type State = { owner: string | null | undefined; items: SavedQuestions; status: Status; storageError: boolean };

export function useSavedQuestions(userId: string | null | undefined) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<State>({ owner: undefined, items: {}, status: "device", storageError: false });
  const controls = useRef<{ owner: string | null; toggle: (code: string) => void; sync: () => void } | null>(null);

  useEffect(() => {
    if (userId === undefined) return;
    const key = savedQuestionsKey(userId);
    let disposed = false;
    let items: SavedQuestions = {};
    let storageError = false;
    let status: Status = userId ? "syncing" : "device";
    let running = false;
    let again = false;
    const read = () => {
      try { return readSavedQuestions(localStorage.getItem(key), keys); }
      catch { storageError = true; return {}; }
    };
    items = read();
    const publish = () => {
      if (disposed) return;
      try { localStorage.setItem(key, JSON.stringify(items)); storageError = false; }
      catch { storageError = true; }
      setState({ owner: userId, items, status, storageError });
    };
    const sync = async () => {
      if (disposed || !userId) return;
      if (running) { again = true; return; }
      running = true;
      status = "syncing";
      publish();
      try {
        do {
          again = false;
          let cloud: SavedQuestions = {};
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase.from("user_saved_questions")
              .select("question_key,saved,changed_at_ms").eq("user_id", userId)
              .order("question_key").range(from, from + 999)
              .abortSignal(AbortSignal.timeout(12000));
            if (error) throw error;
            if (disposed) return;
            for (const row of data ?? []) {
              const code = codes.get(row.question_key);
              if (code) cloud[code] = { saved: row.saved, changedAt: row.changed_at_ms };
            }
            if (!data || data.length < 1000) break;
          }
          items = mergeSavedQuestions(cloud, mergeSavedQuestions(items, read()));
          const changes = Object.entries(items).filter(([code, value]) =>
            !cloud[code] || value.changedAt !== cloud[code].changedAt || value.saved !== cloud[code].saved);
          for (let from = 0; from < changes.length; from += 200) {
            const rows = changes.slice(from, from + 200).map(([code, value]) => ({
              user_id: userId, question_key: keys[code], saved: value.saved, changed_at_ms: value.changedAt,
            }));
            const { data, error } = await supabase.from("user_saved_questions")
              .upsert(rows, { onConflict: "user_id,question_key" }).select("question_key,saved,changed_at_ms")
              .abortSignal(AbortSignal.timeout(12000));
            if (error) throw error;
            if (disposed) return;
            // The database may have rejected an older offline edit. Use its winning state.
            cloud = {};
            for (const row of data ?? []) {
              const code = codes.get(row.question_key);
              if (code) cloud[code] = { saved: row.saved, changedAt: row.changed_at_ms };
            }
            items = mergeSavedQuestions(items, cloud);
          }
        } while (again && !disposed);
        status = "synced";
      } catch { status = "offline"; }
      finally { running = false; publish(); }
    };
    const toggle = (code: string) => {
      if (disposed || !Object.hasOwn(keys, code)) return;
      items = mergeSavedQuestions(items, read());
      const prev = items[code];
      items = { ...items, [code]: { saved: !prev?.saved, changedAt: Math.max(Date.now(), (prev?.changedAt ?? 0) + 1) } };
      publish();
      void sync();
    };
    const refresh = () => {
      if (disposed) return;
      items = mergeSavedQuestions(items, read());
      publish();
      void sync();
    };
    const onStorage = (event: StorageEvent) => { if (event.key === key) refresh(); };
    const control = { owner: userId, toggle, sync: refresh };
    controls.current = control;
    // Defer hydration so the first client render matches the server.
    queueMicrotask(() => { if (!disposed) { publish(); void sync(); } });
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      disposed = true;
      if (controls.current === control) controls.current = null;
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, supabase]);

  const toggle = useCallback((code: string) => {
    if (controls.current && controls.current.owner === userId) controls.current.toggle(code);
  }, [userId]);
  const retry = useCallback(() => {
    if (controls.current && controls.current.owner === userId) controls.current.sync();
  }, [userId]);
  const ready = userId !== undefined && state.owner === userId;
  return { items: ready ? state.items : {}, ready, status: ready ? state.status : "syncing", storageError: ready && state.storageError, toggle, retry };
}
