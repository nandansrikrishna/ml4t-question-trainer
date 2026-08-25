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
      user_sync_state: {
        Row: { user_id: string; initial_local_import_completed_at: string };
        Insert: { user_id: string; initial_local_import_completed_at: string };
        Update: { initial_local_import_completed_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
