export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          correlation_id: string | null;
          id: number;
          metadata: Json;
          occurred_at: string;
          outcome: Database["public"]["Enums"]["audit_outcome"];
          resource_id: string | null;
          resource_type: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          correlation_id?: string | null;
          id?: never;
          metadata?: Json;
          occurred_at?: string;
          outcome: Database["public"]["Enums"]["audit_outcome"];
          resource_id?: string | null;
          resource_type: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          correlation_id?: string | null;
          id?: never;
          metadata?: Json;
          occurred_at?: string;
          outcome?: Database["public"]["Enums"]["audit_outcome"];
          resource_id?: string | null;
          resource_type?: string;
        };
        Relationships: [];
      };
      consent_records: {
        Row: {
          created_at: string;
          effective_from: string;
          id: string;
          purpose: Database["public"]["Enums"]["consent_purpose"];
          recipient_category: Database["public"]["Enums"]["consent_recipient_category"];
          recipient_id: string | null;
          recorded_by: string;
          scope: Database["public"]["Enums"]["consent_scope"];
          status: Database["public"]["Enums"]["consent_status"];
          subject_id: string;
          withdrawn_at: string | null;
          withdrawn_by: string | null;
        };
        Insert: {
          created_at?: string;
          effective_from?: string;
          id?: string;
          purpose: Database["public"]["Enums"]["consent_purpose"];
          recipient_category: Database["public"]["Enums"]["consent_recipient_category"];
          recipient_id?: string | null;
          recorded_by: string;
          scope: Database["public"]["Enums"]["consent_scope"];
          status?: Database["public"]["Enums"]["consent_status"];
          subject_id: string;
          withdrawn_at?: string | null;
          withdrawn_by?: string | null;
        };
        Update: {
          created_at?: string;
          effective_from?: string;
          id?: string;
          purpose?: Database["public"]["Enums"]["consent_purpose"];
          recipient_category?: Database["public"]["Enums"]["consent_recipient_category"];
          recipient_id?: string | null;
          recorded_by?: string;
          scope?: Database["public"]["Enums"]["consent_scope"];
          status?: Database["public"]["Enums"]["consent_status"];
          subject_id?: string;
          withdrawn_at?: string | null;
          withdrawn_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "consent_records_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_records_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_records_subject_id_fkey";
            columns: ["subject_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consent_records_withdrawn_by_fkey";
            columns: ["withdrawn_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      observations: {
        Row: {
          client_request_id: string;
          id: string;
          note: string | null;
          observed_at: string;
          recorded_at: string;
          recorded_by: string | null;
          schema_version: number;
          senior_id: string;
          source: Database["public"]["Enums"]["data_source"];
          type: Database["public"]["Enums"]["observation_type"];
          unit: string | null;
          value_numeric: number | null;
          value_numeric_2: number | null;
          value_text: string | null;
          verification: Database["public"]["Enums"]["verification_status"];
        };
        Insert: {
          client_request_id: string;
          id?: string;
          note?: string | null;
          observed_at: string;
          recorded_at?: string;
          recorded_by?: string | null;
          schema_version?: number;
          senior_id: string;
          source?: Database["public"]["Enums"]["data_source"];
          type: Database["public"]["Enums"]["observation_type"];
          unit?: string | null;
          value_numeric?: number | null;
          value_numeric_2?: number | null;
          value_text?: string | null;
          verification?: Database["public"]["Enums"]["verification_status"];
        };
        Update: {
          client_request_id?: string;
          id?: string;
          note?: string | null;
          observed_at?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          schema_version?: number;
          senior_id?: string;
          source?: Database["public"]["Enums"]["data_source"];
          type?: Database["public"]["Enums"]["observation_type"];
          unit?: string | null;
          value_numeric?: number | null;
          value_numeric_2?: number | null;
          value_text?: string | null;
          verification?: Database["public"]["Enums"]["verification_status"];
        };
        Relationships: [
          {
            foreignKeyName: "observations_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "observations_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          added_at: string;
          added_by: string | null;
          org_id: string;
          user_id: string;
        };
        Insert: {
          added_at?: string;
          added_by?: string | null;
          org_id: string;
          user_id: string;
        };
        Update: {
          added_at?: string;
          added_by?: string | null;
          org_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"];
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"];
          created_at?: string;
          display_name?: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"];
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      risk_assessments: {
        Row: {
          changed_domains: string[];
          config_fingerprint: string;
          created_at: string;
          created_by: string;
          data_quality: string;
          engine_version: string;
          id: string;
          input_digest: string;
          org_id: string;
          priority: string;
          reference_time: string;
          result: Json;
          ruleset_version: string;
          senior_id: string;
        };
        Insert: {
          changed_domains?: string[];
          config_fingerprint: string;
          created_at?: string;
          created_by: string;
          data_quality: string;
          engine_version: string;
          id?: string;
          input_digest: string;
          org_id: string;
          priority: string;
          reference_time: string;
          result: Json;
          ruleset_version: string;
          senior_id: string;
        };
        Update: {
          changed_domains?: string[];
          config_fingerprint?: string;
          created_at?: string;
          created_by?: string;
          data_quality?: string;
          engine_version?: string;
          id?: string;
          input_digest?: string;
          org_id?: string;
          priority?: string;
          reference_time?: string;
          result?: Json;
          ruleset_version?: string;
          senior_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "risk_assessments_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_assessments_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "risk_assessments_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      review_cases: {
        Row: {
          id: string;
          senior_id: string;
          org_id: string;
          status: Database["public"]["Enums"]["review_case_status"];
          priority_at_open: string;
          opened_by_assessment_id: string;
          latest_assessment_id: string;
          assigned_to: string | null;
          opened_by: string;
          opened_at: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          id?: string;
          senior_id: string;
          org_id: string;
          status?: Database["public"]["Enums"]["review_case_status"];
          priority_at_open: string;
          opened_by_assessment_id: string;
          latest_assessment_id: string;
          assigned_to?: string | null;
          opened_by: string;
          opened_at?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          id?: string;
          senior_id?: string;
          org_id?: string;
          status?: Database["public"]["Enums"]["review_case_status"];
          priority_at_open?: string;
          opened_by_assessment_id?: string;
          latest_assessment_id?: string;
          assigned_to?: string | null;
          opened_by?: string;
          opened_at?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "review_cases_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_cases_latest_assessment_id_fkey";
            columns: ["latest_assessment_id"];
            isOneToOne: false;
            referencedRelation: "risk_assessments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_cases_opened_by_assessment_id_fkey";
            columns: ["opened_by_assessment_id"];
            isOneToOne: false;
            referencedRelation: "risk_assessments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_cases_opened_by_fkey";
            columns: ["opened_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_cases_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_cases_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      review_case_events: {
        Row: {
          id: string;
          case_id: string;
          org_id: string;
          from_status: Database["public"]["Enums"]["review_case_status"] | null;
          to_status: Database["public"]["Enums"]["review_case_status"];
          actor_id: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          case_id: string;
          org_id: string;
          from_status?: Database["public"]["Enums"]["review_case_status"] | null;
          to_status: Database["public"]["Enums"]["review_case_status"];
          actor_id: string;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          case_id?: string;
          org_id?: string;
          from_status?: Database["public"]["Enums"]["review_case_status"] | null;
          to_status?: Database["public"]["Enums"]["review_case_status"];
          actor_id?: string;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "review_case_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_case_events_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "review_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_case_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_up_tasks: {
        Row: {
          id: string;
          senior_id: string;
          org_id: string;
          review_case_id: string | null;
          title: string;
          notes: string | null;
          assigned_to: string | null;
          due_at: string | null;
          status: Database["public"]["Enums"]["follow_up_task_status"];
          outcome_note: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          completed_at: string | null;
          version: number;
        };
        Insert: {
          id?: string;
          senior_id: string;
          org_id: string;
          review_case_id?: string | null;
          title: string;
          notes?: string | null;
          assigned_to?: string | null;
          due_at?: string | null;
          status?: Database["public"]["Enums"]["follow_up_task_status"];
          outcome_note?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          version?: number;
        };
        Update: {
          id?: string;
          senior_id?: string;
          org_id?: string;
          review_case_id?: string | null;
          title?: string;
          notes?: string | null;
          assigned_to?: string | null;
          due_at?: string | null;
          status?: Database["public"]["Enums"]["follow_up_task_status"];
          outcome_note?: string | null;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
          completed_at?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "follow_up_tasks_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_review_case_id_fkey";
            columns: ["review_case_id"];
            isOneToOne: false;
            referencedRelation: "review_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_tasks_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      follow_up_task_events: {
        Row: {
          id: string;
          task_id: string;
          org_id: string;
          from_status: Database["public"]["Enums"]["follow_up_task_status"] | null;
          to_status: Database["public"]["Enums"]["follow_up_task_status"];
          actor_id: string;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          task_id: string;
          org_id: string;
          from_status?: Database["public"]["Enums"]["follow_up_task_status"] | null;
          to_status: Database["public"]["Enums"]["follow_up_task_status"];
          actor_id: string;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          task_id?: string;
          org_id?: string;
          from_status?: Database["public"]["Enums"]["follow_up_task_status"] | null;
          to_status?: Database["public"]["Enums"]["follow_up_task_status"];
          actor_id?: string;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "follow_up_task_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_task_events_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "follow_up_task_events_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "follow_up_tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      senior_baselines: {
        Row: {
          captured_at: string;
          field: Database["public"]["Enums"]["baseline_field"];
          id: string;
          note: string | null;
          recorded_at: string;
          recorded_by: string | null;
          senior_id: string;
          source: Database["public"]["Enums"]["data_source"];
          status: Database["public"]["Enums"]["baseline_status"];
          unit: string | null;
          value_numeric: number | null;
          value_numeric_2: number | null;
          value_text: string | null;
          verification: Database["public"]["Enums"]["verification_status"];
        };
        Insert: {
          captured_at: string;
          field: Database["public"]["Enums"]["baseline_field"];
          id?: string;
          note?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          senior_id: string;
          source?: Database["public"]["Enums"]["data_source"];
          status: Database["public"]["Enums"]["baseline_status"];
          unit?: string | null;
          value_numeric?: number | null;
          value_numeric_2?: number | null;
          value_text?: string | null;
          verification?: Database["public"]["Enums"]["verification_status"];
        };
        Update: {
          captured_at?: string;
          field?: Database["public"]["Enums"]["baseline_field"];
          id?: string;
          note?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          senior_id?: string;
          source?: Database["public"]["Enums"]["data_source"];
          status?: Database["public"]["Enums"]["baseline_status"];
          unit?: string | null;
          value_numeric?: number | null;
          value_numeric_2?: number | null;
          value_text?: string | null;
          verification?: Database["public"]["Enums"]["verification_status"];
        };
        Relationships: [
          {
            foreignKeyName: "senior_baselines_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "senior_baselines_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      seniors: {
        Row: {
          care_context: string | null;
          care_status: Database["public"]["Enums"]["care_status"];
          communication_notes: string | null;
          created_at: string;
          created_by: string | null;
          date_of_birth: string | null;
          display_name: string;
          id: string;
          is_synthetic: boolean;
          org_id: string;
          preferred_language: Database["public"]["Enums"]["preferred_language"];
          record_code: string;
          synthetic_dataset_id: string | null;
          time_zone: string;
          updated_at: string;
          updated_by: string | null;
          version: number;
        };
        Insert: {
          care_context?: string | null;
          care_status?: Database["public"]["Enums"]["care_status"];
          communication_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          display_name: string;
          id?: string;
          is_synthetic?: boolean;
          org_id: string;
          preferred_language?: Database["public"]["Enums"]["preferred_language"];
          record_code: string;
          synthetic_dataset_id?: string | null;
          time_zone?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Update: {
          care_context?: string | null;
          care_status?: Database["public"]["Enums"]["care_status"];
          communication_notes?: string | null;
          created_at?: string;
          created_by?: string | null;
          date_of_birth?: string | null;
          display_name?: string;
          id?: string;
          is_synthetic?: boolean;
          org_id?: string;
          preferred_language?: Database["public"]["Enums"]["preferred_language"];
          record_code?: string;
          synthetic_dataset_id?: string | null;
          time_zone?: string;
          updated_at?: string;
          updated_by?: string | null;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "seniors_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "seniors_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "seniors_synthetic_dataset_id_fkey";
            columns: ["synthetic_dataset_id"];
            isOneToOne: false;
            referencedRelation: "synthetic_datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "seniors_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      synthetic_datasets: {
        Row: {
          config: Json;
          created_at: string;
          generator_version: string;
          id: string;
          manifest_sha256: string;
          org_id: string;
          reference_date: string;
          seed: string;
        };
        Insert: {
          config: Json;
          created_at?: string;
          generator_version: string;
          id: string;
          manifest_sha256: string;
          org_id: string;
          reference_date: string;
          seed: string;
        };
        Update: {
          config?: Json;
          created_at?: string;
          generator_version?: string;
          id?: string;
          manifest_sha256?: string;
          org_id?: string;
          reference_date?: string;
          seed?: string;
        };
        Relationships: [
          {
            foreignKeyName: "synthetic_datasets_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      synthetic_ground_truth: {
        Row: {
          affected_types: string[];
          dataset_id: string;
          details: Json;
          duration_days: number | null;
          onset_day: number | null;
          scenario: string;
          senior_id: string;
        };
        Insert: {
          affected_types?: string[];
          dataset_id: string;
          details?: Json;
          duration_days?: number | null;
          onset_day?: number | null;
          scenario: string;
          senior_id: string;
        };
        Update: {
          affected_types?: string[];
          dataset_id?: string;
          details?: Json;
          duration_days?: number | null;
          onset_day?: number | null;
          scenario?: string;
          senior_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "synthetic_ground_truth_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "synthetic_datasets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "synthetic_ground_truth_senior_id_fkey";
            columns: ["senior_id"];
            isOneToOne: false;
            referencedRelation: "seniors";
            referencedColumns: ["id"];
          },
        ];
      };
      synthetic_ingestion_runs: {
        Row: {
          counts: Json;
          dataset_id: string;
          finished_at: string | null;
          id: string;
          started_at: string;
          status: string;
        };
        Insert: {
          counts?: Json;
          dataset_id: string;
          finished_at?: string | null;
          id?: string;
          started_at?: string;
          status: string;
        };
        Update: {
          counts?: Json;
          dataset_id?: string;
          finished_at?: string | null;
          id?: string;
          started_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "synthetic_ingestion_runs_dataset_id_fkey";
            columns: ["dataset_id"];
            isOneToOne: false;
            referencedRelation: "synthetic_datasets";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          granted_at: string;
          granted_by: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          granted_at?: string;
          granted_by?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_create_org: { Args: { _name: string }; Returns: string };
      admin_set_membership: {
        Args: { _org: string; _user: string };
        Returns: undefined;
      };
      admin_set_role: {
        Args: {
          _grant: boolean;
          _role: Database["public"]["Enums"]["app_role"];
          _target: string;
        };
        Returns: undefined;
      };
      can_access_org: { Args: { _org: string }; Returns: boolean };
      can_access_senior: { Args: { _senior: string }; Returns: boolean };
      current_baselines: {
        Args: { _senior: string };
        Returns: {
          captured_at: string;
          field: Database["public"]["Enums"]["baseline_field"];
          id: string;
          note: string | null;
          recorded_at: string;
          recorded_by: string | null;
          senior_id: string;
          source: Database["public"]["Enums"]["data_source"];
          status: Database["public"]["Enums"]["baseline_status"];
          unit: string | null;
          value_numeric: number | null;
          value_numeric_2: number | null;
          value_text: string | null;
          verification: Database["public"]["Enums"]["verification_status"];
        }[];
        SetofOptions: {
          from: "*";
          to: "senior_baselines";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      current_org: { Args: never; Returns: string };
      grant_consent: {
        Args: {
          _category: Database["public"]["Enums"]["consent_recipient_category"];
          _purpose: Database["public"]["Enums"]["consent_purpose"];
          _recipient: string;
          _scope: Database["public"]["Enums"]["consent_scope"];
          _subject: string;
        };
        Returns: string;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_synthetic_ingest: { Args: { _senior: string }; Returns: boolean };
      latest_observations: {
        Args: { _senior: string };
        Returns: {
          client_request_id: string;
          id: string;
          note: string | null;
          observed_at: string;
          recorded_at: string;
          recorded_by: string | null;
          schema_version: number;
          senior_id: string;
          source: Database["public"]["Enums"]["data_source"];
          type: Database["public"]["Enums"]["observation_type"];
          unit: string | null;
          value_numeric: number | null;
          value_numeric_2: number | null;
          value_text: string | null;
          verification: Database["public"]["Enums"]["verification_status"];
        }[];
        SetofOptions: {
          from: "*";
          to: "observations";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      log_risk_assessment_denied: {
        Args: { _senior: string };
        Returns: undefined;
      };
      my_roles: {
        Args: never;
        Returns: Database["public"]["Enums"]["app_role"][];
      };
      profile_names: {
        Args: { _ids: string[] };
        Returns: {
          display_name: string;
          id: string;
        }[];
      };
      withdraw_consent: { Args: { _consent: string }; Returns: undefined };
      write_audit: {
        Args: {
          _action: string;
          _actor: string;
          _metadata?: Json;
          _outcome: Database["public"]["Enums"]["audit_outcome"];
          _resource_id: string;
          _resource_type: string;
        };
        Returns: undefined;
      };
      open_review_case: {
        Args: { _senior: string; _assessment: string };
        Returns: string;
      };
      transition_review_case: {
        Args: {
          _case: string;
          _to: Database["public"]["Enums"]["review_case_status"];
          _reason?: string;
        };
        Returns: undefined;
      };
      assign_review_case: {
        Args: { _case: string; _assignee: string | null };
        Returns: undefined;
      };
      create_follow_up_task: {
        Args: {
          _senior: string;
          _title: string;
          _notes?: string | null;
          _case?: string | null;
          _assignee?: string | null;
          _due_at?: string | null;
        };
        Returns: string;
      };
      transition_follow_up_task: {
        Args: {
          _task: string;
          _to: Database["public"]["Enums"]["follow_up_task_status"];
          _note?: string | null;
        };
        Returns: undefined;
      };
      assign_follow_up_task: {
        Args: { _task: string; _assignee: string | null };
        Returns: undefined;
      };
      org_assignees: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          display_name: string;
        }[];
      };
    };
    Enums: {
      account_status: "active" | "suspended";
      app_role: "admin" | "coordinator" | "senior" | "family";
      audit_outcome: "success" | "denied" | "error";
      baseline_field:
        | "resting_heart_rate"
        | "blood_pressure"
        | "weight"
        | "mobility"
        | "hearing"
        | "vision";
      baseline_status: "recorded" | "unknown" | "not_applicable";
      care_status: "active" | "paused" | "discharged";
      consent_purpose: "care_coordination" | "family_updates" | "messaging";
      consent_recipient_category: "care_team" | "family_member";
      consent_scope: "wellbeing_summary" | "observations" | "alerts" | "contact_details";
      consent_status: "granted" | "withdrawn";
      data_source:
        | "manual_entry"
        | "reported_by_senior"
        | "reported_by_family"
        | "device"
        | "imported";
      follow_up_task_status: "open" | "in_progress" | "completed" | "cancelled";
      observation_type:
        | "heart_rate"
        | "blood_pressure"
        | "weight"
        | "sleep_duration"
        | "mobility"
        | "appetite"
        | "hydration"
        | "medication_event"
        | "care_note";
      preferred_language: "en" | "hi" | "other";
      review_case_status:
        | "needs_review"
        | "in_review"
        | "follow_up_required"
        | "resolved"
        | "dismissed";
      verification_status: "verified" | "unverified";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      account_status: ["active", "suspended"],
      app_role: ["admin", "coordinator", "senior", "family"],
      audit_outcome: ["success", "denied", "error"],
      baseline_field: [
        "resting_heart_rate",
        "blood_pressure",
        "weight",
        "mobility",
        "hearing",
        "vision",
      ],
      baseline_status: ["recorded", "unknown", "not_applicable"],
      care_status: ["active", "paused", "discharged"],
      consent_purpose: ["care_coordination", "family_updates", "messaging"],
      consent_recipient_category: ["care_team", "family_member"],
      consent_scope: ["wellbeing_summary", "observations", "alerts", "contact_details"],
      consent_status: ["granted", "withdrawn"],
      data_source: [
        "manual_entry",
        "reported_by_senior",
        "reported_by_family",
        "device",
        "imported",
      ],
      follow_up_task_status: ["open", "in_progress", "completed", "cancelled"],
      observation_type: [
        "heart_rate",
        "blood_pressure",
        "weight",
        "sleep_duration",
        "mobility",
        "appetite",
        "hydration",
        "medication_event",
        "care_note",
      ],
      preferred_language: ["en", "hi", "other"],
      review_case_status: [
        "needs_review",
        "in_review",
        "follow_up_required",
        "resolved",
        "dismissed",
      ],
      verification_status: ["verified", "unverified"],
    },
  },
} as const;
