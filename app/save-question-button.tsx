"use client";

import { Bookmark } from "lucide-react";

export function SaveQuestionButton({ questionId, saved, ready, onToggle }: {
  questionId: string; saved: boolean; ready: boolean; onToggle: (code: string) => void;
}) {
  return (
    <button type="button" className="save-question-button" aria-pressed={saved}
      aria-label={`${saved ? "Remove from saved questions" : "Save for review"}: ${questionId}`}
      disabled={!ready} onClick={() => onToggle(questionId)}>
      <Bookmark size={16} aria-hidden="true" fill={saved ? "currentColor" : "none"} />
      {saved ? "Saved for review" : "Save for review"}
    </button>
  );
}
