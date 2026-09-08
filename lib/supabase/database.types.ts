export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type Database = {
  public: {
    Tables: {
      question_catalog: {
        Row: { question_key: number; code: string };
        Insert: { question_key: number; code: string };
        Update: { question_key?: number; code?: string };
        Relationships: [];
      };
      user_question_progress: {
        Row: {
          user_id: string;
          question_key: number;
          attempts: number;
          statement_correct: number;
          statement_total: number;
          available_at: string;
          interval_minutes: number;
          ease: number;
          last_score: number;
          last_reviewed_at: string;
        };
        Insert: {
          user_id: string;
          question_key: number;
          attempts: number;
          statement_correct: number;
          statement_total: number;
          available_at: string;
          interval_minutes: number;
          ease: number;
          last_score: number;
          last_reviewed_at: string;
        };
        Update: {
          user_id?: string;
          question_key?: number;
          attempts?: number;
          statement_correct?: number;
          statement_total?: number;
          available_at?: string;
          interval_minutes?: number;
          ease?: number;
          last_score?: number;
          last_reviewed_at?: string;
        };
        Relationships: [];
      };
      user_question_attempts: {
        Row: {
          user_id: string;
          attempt_id: string;
          question_key: number;
          answer_mask: number;
          answered_mask: number;
          exam_session_id: string | null;
          score: number;
          source: string;
          skipped: boolean;
          answered_at: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          attempt_id: string;
          question_key: number;
          answer_mask: number;
          answered_mask?: number;
          exam_session_id?: string | null;
          score: number;
          source: string;
          skipped?: boolean;
          answered_at: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          attempt_id?: string;
          question_key?: number;
          answer_mask?: number;
          answered_mask?: number;
          exam_session_id?: string | null;
          score?: number;
          source?: string;
          skipped?: boolean;
          answered_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      user_exam_sessions: {
        Row: {
          id: string;
          user_id: string;
          exam: number;
          started_at: string;
          deadline: string;
          submitted_at: string | null;
          revision: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      user_exam_questions: {
        Row: {
          session_id: string;
          user_id: string;
          question_key: number;
          position: number;
          statement_order: number[];
          answer_mask: number;
          answered_mask: number;
          pinned: boolean;
          attempt_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      user_sync_state: {
        Row: {
          user_id: string;
          initial_local_import_completed_at: string;
          answer_history_import_completed_at: string | null;
        };
        Insert: {
          user_id: string;
          initial_local_import_completed_at: string;
          answer_history_import_completed_at?: string | null;
        };
        Update: {
          initial_local_import_completed_at?: string;
          answer_history_import_completed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      start_practice_exam: {
        Args: { p_exam: number; p_request_id: string };
        Returns: Json;
      };
      sync_practice_exam: {
        Args: {
          p_session: string;
          p_revision: number;
          p_edits: Json;
          p_submitted_at: string | null;
          p_request_id: string;
        };
        Returns: Json;
      };
      import_practice_exam: {
        Args: {
          p_session: string;
          p_exam: number;
          p_started_at: string;
          p_submitted_at: string | null;
          p_items: Json;
        };
        Returns: Json;
      };
      get_practice_exam: { Args: { p_session: string }; Returns: Json };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
