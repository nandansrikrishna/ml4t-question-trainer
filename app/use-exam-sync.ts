"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import type { Json } from "../lib/supabase/database.types";
import rawQuestions from "./data/questions.json";
import questionKeys from "./data/question-keys.json";
import { readExams, type ExamItem } from "../lib/practice-exam";
import {
  acceptCloud,
  decodeCloudExam,
  EXAM_CACHE_PREFIX,
  EXAM_RECOVERY_OWNER,
  itemEdits,
  mergeExamRecords,
  visibleExam,
  type CachedExam,
  type CloudExam,
} from "../lib/exam-sync";

const byCode = new Map(rawQuestions.map((q) => [q.id, q]));
const byKey = new Map(
  Object.entries(questionKeys).map(([code, key]) => [key, byCode.get(code)!]),
);
function readCache(owner: string): CachedExam[] {
  const raw = localStorage.getItem(EXAM_CACHE_PREFIX + owner);
  if (!raw) return [];
  const records: CachedExam[] = JSON.parse(raw);
  if (!Array.isArray(records)) throw Error("Invalid exam cache");
  readExams(JSON.stringify(records.map((r) => r.cloud)));
  if (
    !records.every(
      (r) =>
        Array.isArray(r.edits) &&
        Array.isArray(r.acknowledged) &&
        Number.isInteger(r.revision),
    )
  )
    throw Error("Invalid exam queue");
  return records;
}
function mergeRecords(local: CachedExam[], incoming: CachedExam[]) {
  const map = new Map(local.map((r) => [r.cloud.id, r]));
  for (const record of incoming)
    map.set(
      record.cloud.id,
      map.has(record.cloud.id)
        ? mergeExamRecords(map.get(record.cloud.id)!, record)
        : record,
    );
  return [...map.values()].sort(
    (a, b) => b.cloud.startedAt - a.cloud.startedAt,
  );
}

export function useExamSync(userId: string | null) {
  const supabase = useMemo(() => createClient(), []);
  const [records, setRecords] = useState<CachedExam[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [starting, setStarting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const current = useRef<CachedExam[]>([]);
  const ownerRef = useRef<string | null>(null);
  const authRef = useRef(userId);
  const offset = useRef(0);
  const syncing = useRef(false);
  const startingRef = useRef(false);
  const runSync = useRef<() => Promise<void>>(async () => {});
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useCallback((next: CachedExam[], merge = true) => {
    const currentOwner = ownerRef.current;
    if (!currentOwner) return;
    let result = next;
    try {
      if (merge) result = mergeRecords(next, readCache(currentOwner));
    } catch {
      /* Keep in-memory work if the storage read fails. */
    }
    current.current = result;
    setRecords(result);
    try {
      try {
        localStorage.setItem(
          EXAM_CACHE_PREFIX + currentOwner,
          JSON.stringify(result),
        );
      } catch {
        // Preserve every pending/recovery record before retaining older, already
        // synced history. The latter can always be fetched again from Supabase.
        const essential = result.filter(
          (r) => r.cloud.submittedAt === null || r.recoveredEdits?.length,
        );
        const recent = result
          .filter(
            (r) => r.cloud.submittedAt !== null && !r.recoveredEdits?.length,
          )
          .slice(0, 5);
        localStorage.setItem(
          EXAM_CACHE_PREFIX + currentOwner,
          JSON.stringify([...essential, ...recent]),
        );
      }
      localStorage.setItem(
        EXAM_CACHE_PREFIX + currentOwner + ":clock",
        String(offset.current),
      );
      if (result.some((r) => r.cloud.submittedAt === null))
        localStorage.setItem(EXAM_RECOVERY_OWNER, currentOwner);
      setError("");
    } catch {
      setError(
        "Browser autosave is unavailable. Keep this page open; cloud sync will still retry.",
      );
    }
  }, []);
  const schedule = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSync.current(), 700);
  }, []);
  const finish = useCallback(
    (id: string) => {
      const time = Date.now() + offset.current;
      write(
        current.current.map((r) =>
          r.cloud.id === id &&
          r.cloud.submittedAt === null &&
          r.submittedAt === null
            ? {
                ...r,
                submittedAt: Math.max(
                  r.cloud.startedAt,
                  Math.min(time, r.cloud.deadline),
                ),
              }
            : r,
        ),
      );
      setStatus("Saved on this device · submission queued");
      schedule();
    },
    [write, schedule],
  );
  const synchronize = useCallback(async () => {
    const own = ownerRef.current;
    if (!own || authRef.current !== own || syncing.current) return;
    syncing.current = true;
    const stillOwn = () => ownerRef.current === own && authRef.current === own;
    try {
      if (!navigator.onLine) throw Error("Offline");
      setStatus("Syncing exam…");
      // Flush local edits before reading cloud state, including late delivery of
      // edits made before the deadline while offline. No background start calls.
      for (const original of [...current.current]) {
        for (let retry = 0; retry < 4; retry++) {
          const record = current.current.find(
            (r) => r.cloud.id === original.cloud.id,
          );
          if (!record || record.cloud.submittedAt !== null) break;
          const time = Date.now() + offset.current;
          if (
            !record.edits.length &&
            !record.flight &&
            record.submittedAt === null &&
            time < record.cloud.deadline
          )
            break;
          const edits = record.edits.slice(0, 1000);
          const flight = record.flight ?? {
            id: crypto.randomUUID(),
            revision: record.revision,
            edits,
            submittedAt:
              record.edits.length <= 1000
                ? (record.submittedAt ??
                  (time >= record.cloud.deadline
                    ? record.cloud.deadline
                    : null))
                : null,
          };
          write(
            current.current.map((r) =>
              r.cloud.id === record.cloud.id ? { ...r, flight } : r,
            ),
            false,
          );
          const { data, error: rpcError } = await supabase
            .rpc("sync_practice_exam", {
              p_session: record.cloud.id,
              p_revision: flight.revision,
              p_edits: flight.edits as unknown as Json,
              p_submitted_at:
                flight.submittedAt === null
                  ? null
                  : new Date(flight.submittedAt).toISOString(),
              p_request_id: flight.id,
            })
            .abortSignal(AbortSignal.timeout(12000));
          if (rpcError) throw rpcError;
          if (!stillOwn()) return;
          const response = data as unknown as CloudExam;
          const cloud = decodeCloudExam(response, byKey);
          offset.current = Date.parse(response.server_now) - Date.now();
          const latest = current.current.find(
            (r) => r.cloud.id === record.cloud.id,
          )!;
          // Incorporate other tabs before acknowledging this exact request.
          let merged = latest;
          try {
            const disk = readCache(own).find(
              (r) => r.cloud.id === record.cloud.id,
            );
            if (disk) merged = mergeExamRecords(latest, disk);
          } catch {}
          const accepted = acceptCloud(merged, cloud, response, flight);
          write(
            current.current.map((r) =>
              r.cloud.id === record.cloud.id ? accepted : r,
            ),
            false,
          );
          if (cloud.cloud.submittedAt)
            window.dispatchEvent(new Event("ml4t-exam-submitted"));
          if (response.conflict) continue;
          if (!accepted.edits.length) break;
        }
      }
      // Upgrade only this account's earlier local exams. Keep v1 storage intact
      // until all imports succeed, and never claim another account's history.
      const legacyKey = `ml4t-practice-exams-v1:${own}`;
      const importedKey = EXAM_CACHE_PREFIX + own + ":legacy-imported";
      let legacy: ReturnType<typeof readExams> = [];
      try {
        if (localStorage.getItem(importedKey) !== "true")
          legacy = readExams(localStorage.getItem(legacyKey));
      } catch {
        /* Preserve unreadable legacy data. */
      }
      for (const session of legacy) {
        if (current.current.some((r) => r.cloud.id === session.id)) continue;
        const { data, error: importError } = await supabase
          .rpc("import_practice_exam", {
            p_session: session.id,
            p_exam: session.exam,
            p_started_at: new Date(session.startedAt).toISOString(),
            p_submitted_at:
              session.submittedAt === null
                ? null
                : new Date(session.submittedAt).toISOString(),
            p_items: session.items.map((item) => ({
              question_key:
                questionKeys[item.question.id as keyof typeof questionKeys],
              order: item.order,
              answers: item.answers,
              pinned: item.pinned,
            })),
          })
          .abortSignal(AbortSignal.timeout(12000));
        if (importError) throw importError;
        if (!stillOwn()) return;
        const imported = decodeCloudExam(data as unknown as CloudExam, byKey);
        write([imported, ...current.current], false);
        if (imported.cloud.submittedAt)
          window.dispatchEvent(new Event("ml4t-exam-submitted"));
      }
      try {
        localStorage.setItem(importedKey, "true");
      } catch {}
      // Page the session list; fetch a snapshot only when a revision changed.
      for (let from = 0; ; from += 200) {
        const { data, error: fetchError } = await supabase
          .from("user_exam_sessions")
          .select("*")
          .eq("user_id", own)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + 199)
          .abortSignal(AbortSignal.timeout(12000));
        if (fetchError) throw fetchError;
        if (!stillOwn()) return;
        for (const row of data ?? []) {
          const existing = current.current.find((r) => r.cloud.id === row.id);
          if (existing && existing.revision === row.revision) continue;
          const { data: snapshot, error: readError } = await supabase
            .rpc("get_practice_exam", { p_session: row.id })
            .abortSignal(AbortSignal.timeout(12000));
          if (readError) throw readError;
          if (!stillOwn()) return;
          const response = snapshot as unknown as CloudExam;
          const cloud = decodeCloudExam(response, byKey);
          offset.current = Date.parse(response.server_now) - Date.now();
          const latest = current.current.find((r) => r.cloud.id === row.id);
          const next = latest ? acceptCloud(latest, cloud, response) : cloud;
          write(
            [next, ...current.current.filter((r) => r.cloud.id !== row.id)],
            false,
          );
        }
        if (!data || data.length < 200) break;
      }
      if (stillOwn())
        setStatus(
          current.current.some(
            (r) =>
              r.edits.length ||
              r.flight ||
              (r.submittedAt !== null && r.cloud.submittedAt === null),
          )
            ? "Saved on this device · changes queued"
            : "Exam history synced",
        );
    } catch (e) {
      if (stillOwn()) {
        const message =
          e && typeof e === "object" && "message" in e ? String(e.message) : "";
        setStatus(
          /jwt|token|sign in|session|permission/i.test(message)
            ? "Sign in again to sync. Your active exam is still saved on this device."
            : "Saved on this device · waiting for connection",
        );
      }
    } finally {
      syncing.current = false;
    }
  }, [supabase, write]);
  useEffect(() => {
    runSync.current = synchronize;
  }, [synchronize]);
  useEffect(() => {
    authRef.current = userId;
    queueMicrotask(() => {
      let nextOwner = userId ?? ownerRef.current;
      if (!nextOwner) {
        try {
          nextOwner = localStorage.getItem(EXAM_RECOVERY_OWNER);
        } catch {}
      }
      if (nextOwner && nextOwner !== ownerRef.current) {
        ownerRef.current = nextOwner;
        setOwner(nextOwner);
        try {
          const cached = readCache(nextOwner);
          current.current = cached;
          setRecords(cached);
          offset.current =
            Number(
              localStorage.getItem(EXAM_CACHE_PREFIX + nextOwner + ":clock") ??
                0,
            ) || 0;
        } catch {
          current.current = [];
          setRecords([]);
          setError(
            "Saved exam data could not be read. The original browser data has been left intact.",
          );
        }
      }
      setReady(true);
      setNow(Date.now() + offset.current);
      if (userId) void runSync.current();
      else if (nextOwner)
        setStatus(
          "Sign in again to sync. Your active exam is still saved on this device.",
        );
    });
  }, [userId]);
  useEffect(() => {
    const tick = () => {
      const time = Date.now() + offset.current;
      setNow(time);
      for (const record of current.current)
        if (
          record.cloud.submittedAt === null &&
          record.submittedAt === null &&
          time >= record.cloud.deadline
        )
          finish(record.cloud.id);
    };
    const timer = setInterval(tick, 1000);
    const retry = setInterval(() => void runSync.current(), 15000);
    const online = () => void runSync.current();
    const storage = (event: StorageEvent) => {
      if (
        ownerRef.current &&
        event.key === EXAM_CACHE_PREFIX + ownerRef.current
      ) {
        try {
          const next = mergeRecords(
            current.current,
            readCache(ownerRef.current),
          );
          current.current = next;
          setRecords(next);
          schedule();
        } catch {}
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("focus", online);
    window.addEventListener("storage", storage);
    return () => {
      clearInterval(timer);
      clearInterval(retry);
      if (debounce.current) clearTimeout(debounce.current);
      window.removeEventListener("online", online);
      window.removeEventListener("focus", online);
      window.removeEventListener("storage", storage);
    };
  }, [finish, schedule]);
  const updateItem = useCallback(
    (id: string, index: number, update: (item: ExamItem) => ExamItem) => {
      const record = current.current.find((r) => r.cloud.id === id);
      if (
        !record ||
        record.cloud.submittedAt !== null ||
        record.submittedAt !== null
      )
        return;
      const time = Date.now() + offset.current;
      if (time >= record.cloud.deadline) {
        finish(id);
        return;
      }
      const session = visibleExam(record);
      const before = session.items[index];
      const edits = itemEdits(
        before,
        update(before),
        index,
        Math.max(record.cloud.startedAt, time),
      );
      write(
        current.current.map((r) =>
          r.cloud.id === id ? { ...r, edits: [...r.edits, ...edits] } : r,
        ),
      );
      setStatus("Saved on this device · syncing changes");
      schedule();
    },
    [finish, write, schedule],
  );
  const start = useCallback(
    async (exam: number) => {
      const own = authRef.current;
      if (!own || own !== ownerRef.current || startingRef.current) return null;
      startingRef.current = true;
      setStarting(true);
      setError("");
      try {
        // Persist the start request before sending it. A failed response must never
        // create a second exam (or a second deadline) when the user retries.
        let request = localStorage.getItem(EXAM_CACHE_PREFIX + own + ":start");
        if (!request) {
          request = crypto.randomUUID();
          localStorage.setItem(EXAM_CACHE_PREFIX + own + ":start", request);
        }
        const { data, error: rpcError } = await supabase
          .rpc("start_practice_exam", { p_exam: exam, p_request_id: request })
          .abortSignal(AbortSignal.timeout(12000));
        if (rpcError) throw rpcError;
        if (ownerRef.current !== own || authRef.current !== own) return null;
        const response = data as unknown as CloudExam;
        const next = decodeCloudExam(response, byKey);
        offset.current = Date.parse(response.server_now) - Date.now();
        const existing = current.current.find(
          (r) => r.cloud.id === next.cloud.id,
        );
        write([
          existing ? mergeExamRecords(existing, next) : next,
          ...current.current.filter((r) => r.cloud.id !== next.cloud.id),
        ]);
        localStorage.removeItem(EXAM_CACHE_PREFIX + own + ":start");
        setNow(Date.now() + offset.current);
        setStatus("Exam history synced");
        return next.cloud.id;
      } catch (e) {
        setError(
          e && typeof e === "object" && "message" in e
            ? `Could not start exam: ${String(e.message)}. Reconnect or sign in, then retry.`
            : "Could not start exam. Reconnect and retry.",
        );
        return null;
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [supabase, write],
  );
  const downloadRecovery = () => {
    const recovery = current.current
      .filter((r) => r.recoveredEdits?.length)
      .map((r) => ({
        exam: r.cloud.exam,
        sessionId: r.cloud.id,
        submittedAt: r.cloud.submittedAt,
        edits: r.recoveredEdits!.map((edit) => ({
          ...edit,
          question: r.cloud.items[edit.position].question.id,
          statementText:
            edit.statement === undefined
              ? undefined
              : r.cloud.items[edit.position].question.statements[edit.statement]
                  .text,
        })),
      }));
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(recovery, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "exam-recovered-edits.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const sessions = records
    .filter((r) => userId === owner || r.cloud.submittedAt === null)
    .map(visibleExam);
  return {
    sessions,
    owner,
    ready,
    starting,
    start,
    updateItem,
    finish,
    now,
    status,
    error,
    pending: records.some(
      (r) => r.cloud.submittedAt === null && r.submittedAt !== null,
    ),
    downloadRecovery,
    recovered: records.some((r) => r.recoveredEdits?.length),
    retry: () => void runSync.current(),
  };
}
