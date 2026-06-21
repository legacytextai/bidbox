export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      agent_run_logs: {
        Row: {
          artifacts: Json | null
          completed_at: string | null
          id: string
          logs: string | null
          screenshots: Json | null
          started_at: string
          status: string
          task_id: string
        }
        Insert: {
          artifacts?: Json | null
          completed_at?: string | null
          id?: string
          logs?: string | null
          screenshots?: Json | null
          started_at?: string
          status: string
          task_id: string
        }
        Update: {
          artifacts?: Json | null
          completed_at?: string | null
          id?: string
          logs?: string | null
          screenshots?: Json | null
          started_at?: string
          status?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_run_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          candidates_found: number | null
          candidates_new: number | null
          completed_at: string | null
          created_at: string
          errors: number | null
          id: string
          raw_log: string | null
          source_id: string | null
          started_at: string
        }
        Insert: {
          candidates_found?: number | null
          candidates_new?: number | null
          completed_at?: string | null
          created_at?: string
          errors?: number | null
          id?: string
          raw_log?: string | null
          source_id?: string | null
          started_at?: string
        }
        Update: {
          candidates_found?: number | null
          candidates_new?: number | null
          completed_at?: string | null
          created_at?: string
          errors?: number | null
          id?: string
          raw_log?: string | null
          source_id?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "opportunity_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          priority: number
          result: Json | null
          started_at: string | null
          status: string
          task_type: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          task_type: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      bids: {
        Row: {
          bid_item: string | null
          bidder_name: string | null
          company_name: string | null
          email: string | null
          file_name: string
          file_url: string
          id: string
          project_id: string
          submission_id: string | null
          submitted_at: string
        }
        Insert: {
          bid_item?: string | null
          bidder_name?: string | null
          company_name?: string | null
          email?: string | null
          file_name: string
          file_url: string
          id?: string
          project_id: string
          submission_id?: string | null
          submitted_at?: string
        }
        Update: {
          bid_item?: string | null
          bidder_name?: string | null
          company_name?: string | null
          email?: string | null
          file_name?: string
          file_url?: string
          id?: string
          project_id?: string
          submission_id?: string | null
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bids_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      cslb_cache: {
        Row: {
          city: string | null
          classifications: Json | null
          company_name: string | null
          expiration_date: string | null
          expires_at: string | null
          fetched_at: string | null
          license_number: string
          license_status: string | null
          state_code: string | null
        }
        Insert: {
          city?: string | null
          classifications?: Json | null
          company_name?: string | null
          expiration_date?: string | null
          expires_at?: string | null
          fetched_at?: string | null
          license_number: string
          license_status?: string | null
          state_code?: string | null
        }
        Update: {
          city?: string | null
          classifications?: Json | null
          company_name?: string | null
          expiration_date?: string | null
          expires_at?: string | null
          fetched_at?: string | null
          license_number?: string
          license_status?: string | null
          state_code?: string | null
        }
        Relationships: []
      }
      gc_qualification_profiles: {
        Row: {
          created_at: string
          id: string
          licenses_held: string[]
          max_project_value: number | null
          min_project_value: number | null
          naics_codes: string[]
          profile_id: string
          target_counties: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          licenses_held?: string[]
          max_project_value?: number | null
          min_project_value?: number | null
          naics_codes?: string[]
          profile_id: string
          target_counties?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          licenses_held?: string[]
          max_project_value?: number | null
          min_project_value?: number | null
          naics_codes?: string[]
          profile_id?: string
          target_counties?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gc_qualification_profiles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gc_sub_trade_mappings: {
        Row: {
          created_at: string | null
          gc_sub_id: string
          id: string
          trade_type_id: string
        }
        Insert: {
          created_at?: string | null
          gc_sub_id: string
          id?: string
          trade_type_id: string
        }
        Update: {
          created_at?: string | null
          gc_sub_id?: string
          id?: string
          trade_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gc_sub_trade_mappings_gc_sub_id_fkey"
            columns: ["gc_sub_id"]
            isOneToOne: false
            referencedRelation: "gc_subcontractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gc_sub_trade_mappings_trade_type_id_fkey"
            columns: ["trade_type_id"]
            isOneToOne: false
            referencedRelation: "trade_types"
            referencedColumns: ["id"]
          },
        ]
      }
      gc_subcontractors: {
        Row: {
          city: string | null
          company_name: string
          contact_name: string | null
          created_at: string | null
          email: string | null
          gc_id: string
          id: string
          license_expiration: string | null
          license_number: string | null
          license_status: string | null
          notes: string | null
          phone: string | null
          state_code: string | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          gc_id: string
          id?: string
          license_expiration?: string | null
          license_number?: string | null
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          state_code?: string | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          gc_id?: string
          id?: string
          license_expiration?: string | null
          license_number?: string | null
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          state_code?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      opportunity_candidates: {
        Row: {
          agency: string | null
          analysis_completed_at: string | null
          analysis_error: string | null
          analysis_requested_at: string | null
          analysis_requested_by: string | null
          analysis_started_at: string | null
          analysis_status: string
          analysis_task_id: string | null
          auto_status: string | null
          auto_status_reason: string | null
          bid_due_at: string | null
          converted_project_id: string | null
          crawl_data: Json | null
          created_at: string
          document_acquisition_completed_at: string | null
          document_acquisition_error: string | null
          document_acquisition_started_at: string | null
          document_acquisition_status: string
          document_processing_completed_at: string | null
          document_processing_error: string | null
          document_processing_started_at: string | null
          document_processing_status: string
          id: string
          last_crawled_at: string | null
          portal_type: string | null
          qualification_score: number | null
          qualified_at: string | null
          raw_title: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_text: string | null
          source_id: string
          source_url: string
          status: string
          updated_at: string
        }
        Insert: {
          agency?: string | null
          analysis_completed_at?: string | null
          analysis_error?: string | null
          analysis_requested_at?: string | null
          analysis_requested_by?: string | null
          analysis_started_at?: string | null
          analysis_status?: string
          analysis_task_id?: string | null
          auto_status?: string | null
          auto_status_reason?: string | null
          bid_due_at?: string | null
          converted_project_id?: string | null
          crawl_data?: Json | null
          created_at?: string
          document_acquisition_completed_at?: string | null
          document_acquisition_error?: string | null
          document_acquisition_started_at?: string | null
          document_acquisition_status?: string
          document_processing_completed_at?: string | null
          document_processing_error?: string | null
          document_processing_started_at?: string | null
          document_processing_status?: string
          id?: string
          last_crawled_at?: string | null
          portal_type?: string | null
          qualification_score?: number | null
          qualified_at?: string | null
          raw_title?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_text?: string | null
          source_id: string
          source_url: string
          status?: string
          updated_at?: string
        }
        Update: {
          agency?: string | null
          analysis_completed_at?: string | null
          analysis_error?: string | null
          analysis_requested_at?: string | null
          analysis_requested_by?: string | null
          analysis_started_at?: string | null
          analysis_status?: string
          analysis_task_id?: string | null
          auto_status?: string | null
          auto_status_reason?: string | null
          bid_due_at?: string | null
          converted_project_id?: string | null
          crawl_data?: Json | null
          created_at?: string
          document_acquisition_completed_at?: string | null
          document_acquisition_error?: string | null
          document_acquisition_started_at?: string | null
          document_acquisition_status?: string
          document_processing_completed_at?: string | null
          document_processing_error?: string | null
          document_processing_started_at?: string | null
          document_processing_status?: string
          id?: string
          last_crawled_at?: string | null
          portal_type?: string | null
          qualification_score?: number | null
          qualified_at?: string | null
          raw_title?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_text?: string | null
          source_id?: string
          source_url?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_candidates_analysis_requested_by_fkey"
            columns: ["analysis_requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_candidates_analysis_task_id_fkey"
            columns: ["analysis_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_candidates_converted_project_id_fkey"
            columns: ["converted_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_candidates_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_candidates_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "opportunity_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_document_chunks: {
        Row: {
          char_count: number
          chunk_index: number
          citation_label: string | null
          created_at: string
          document_class: string | null
          document_family: string | null
          id: string
          opportunity_candidate_id: string
          opportunity_document_id: string
          page_end: number
          page_start: number
          text: string
          token_estimate: number | null
        }
        Insert: {
          char_count?: number
          chunk_index: number
          citation_label?: string | null
          created_at?: string
          document_class?: string | null
          document_family?: string | null
          id?: string
          opportunity_candidate_id: string
          opportunity_document_id: string
          page_end: number
          page_start: number
          text: string
          token_estimate?: number | null
        }
        Update: {
          char_count?: number
          chunk_index?: number
          citation_label?: string | null
          created_at?: string
          document_class?: string | null
          document_family?: string | null
          id?: string
          opportunity_candidate_id?: string
          opportunity_document_id?: string
          page_end?: number
          page_start?: number
          text?: string
          token_estimate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_document_chunks_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_document_chunks_opportunity_document_id_fkey"
            columns: ["opportunity_document_id"]
            isOneToOne: false
            referencedRelation: "opportunity_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_document_pages: {
        Row: {
          char_count: number
          created_at: string
          extraction_method: string | null
          id: string
          opportunity_candidate_id: string
          opportunity_document_id: string
          page_label: string | null
          page_number: number
          sheet_number: string | null
          sheet_title: string | null
          text: string | null
          text_confidence: number | null
        }
        Insert: {
          char_count?: number
          created_at?: string
          extraction_method?: string | null
          id?: string
          opportunity_candidate_id: string
          opportunity_document_id: string
          page_label?: string | null
          page_number: number
          sheet_number?: string | null
          sheet_title?: string | null
          text?: string | null
          text_confidence?: number | null
        }
        Update: {
          char_count?: number
          created_at?: string
          extraction_method?: string | null
          id?: string
          opportunity_candidate_id?: string
          opportunity_document_id?: string
          page_label?: string | null
          page_number?: number
          sheet_number?: string | null
          sheet_title?: string | null
          text?: string | null
          text_confidence?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_document_pages_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_document_pages_opportunity_document_id_fkey"
            columns: ["opportunity_document_id"]
            isOneToOne: false
            referencedRelation: "opportunity_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_documents: {
        Row: {
          acquisition_error: string | null
          acquisition_status: string
          addendum_number: number | null
          agent_task_id: string | null
          created_at: string
          detected_file_type: string | null
          detected_mime_type: string | null
          document_class: string | null
          document_date: string | null
          document_family: string | null
          document_revision: string | null
          document_sequence: number | null
          document_source_order: number | null
          document_subclass: string | null
          file_name: string
          file_size: number | null
          file_type: string | null
          has_text: boolean
          id: string
          inferred_precedence_rank: number | null
          is_addendum: boolean
          manifest_data: Json | null
          needs_ocr: boolean
          opportunity_candidate_id: string
          processing_completed_at: string | null
          processing_error: string | null
          processing_metadata: Json | null
          processing_started_at: string | null
          processing_status: string
          source_url: string | null
          storage_bucket: string
          storage_path: string | null
          text_char_count: number | null
          text_extraction_method: string | null
          text_page_count: number | null
          updated_at: string
        }
        Insert: {
          acquisition_error?: string | null
          acquisition_status?: string
          addendum_number?: number | null
          agent_task_id?: string | null
          created_at?: string
          detected_file_type?: string | null
          detected_mime_type?: string | null
          document_class?: string | null
          document_date?: string | null
          document_family?: string | null
          document_revision?: string | null
          document_sequence?: number | null
          document_source_order?: number | null
          document_subclass?: string | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          has_text?: boolean
          id?: string
          inferred_precedence_rank?: number | null
          is_addendum?: boolean
          manifest_data?: Json | null
          needs_ocr?: boolean
          opportunity_candidate_id: string
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_metadata?: Json | null
          processing_started_at?: string | null
          processing_status?: string
          source_url?: string | null
          storage_bucket?: string
          storage_path?: string | null
          text_char_count?: number | null
          text_extraction_method?: string | null
          text_page_count?: number | null
          updated_at?: string
        }
        Update: {
          acquisition_error?: string | null
          acquisition_status?: string
          addendum_number?: number | null
          agent_task_id?: string | null
          created_at?: string
          detected_file_type?: string | null
          detected_mime_type?: string | null
          document_class?: string | null
          document_date?: string | null
          document_family?: string | null
          document_revision?: string | null
          document_sequence?: number | null
          document_source_order?: number | null
          document_subclass?: string | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          has_text?: boolean
          id?: string
          inferred_precedence_rank?: number | null
          is_addendum?: boolean
          manifest_data?: Json | null
          needs_ocr?: boolean
          opportunity_candidate_id?: string
          processing_completed_at?: string | null
          processing_error?: string | null
          processing_metadata?: Json | null
          processing_started_at?: string | null
          processing_status?: string
          source_url?: string | null
          storage_bucket?: string
          storage_path?: string | null
          text_char_count?: number | null
          text_extraction_method?: string | null
          text_page_count?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_documents_agent_task_id_fkey"
            columns: ["agent_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_documents_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_sources: {
        Row: {
          created_at: string
          id: string
          last_scanned_at: string | null
          listing_url: string
          name: string
          portal_type: string
          scan_enabled: boolean
          scan_interval_hours: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_scanned_at?: string | null
          listing_url: string
          name: string
          portal_type: string
          scan_enabled?: boolean
          scan_interval_hours?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_scanned_at?: string | null
          listing_url?: string
          name?: string
          portal_type?: string
          scan_enabled?: boolean
          scan_interval_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      portal_drivers: {
        Row: {
          created_at: string
          driver_mode: string
          driver_name: string
          enabled: boolean
          id: string
          portal_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          driver_mode: string
          driver_name: string
          enabled?: boolean
          id?: string
          portal_type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          driver_mode?: string
          driver_name?: string
          enabled?: boolean
          id?: string
          portal_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          company_name: string | null
          created_at: string
          email: string
          estimating_email: string | null
          id: string
          stripe_customer_id: string | null
        }
        Insert: {
          company_name?: string | null
          created_at?: string
          email: string
          estimating_email?: string | null
          id: string
          stripe_customer_id?: string | null
        }
        Update: {
          company_name?: string | null
          created_at?: string
          email?: string
          estimating_email?: string | null
          id?: string
          stripe_customer_id?: string | null
        }
        Relationships: []
      }
      project_bid_readiness: {
        Row: {
          addenda_issued: boolean | null
          addenda_reviewed: boolean | null
          addenda_reviewed_at: string | null
          bid_sheet_complete: boolean | null
          bond_delivery_method: string | null
          bond_in_person_delivered: boolean | null
          bond_online_submitted: boolean | null
          bond_required: boolean | null
          job_walk_attended_by: string | null
          job_walk_completed: boolean | null
          job_walk_mandatory: boolean | null
          project_id: string
          proposal_notarized: boolean | null
          proposal_prepared: boolean | null
          proposal_signed: boolean | null
          updated_at: string | null
        }
        Insert: {
          addenda_issued?: boolean | null
          addenda_reviewed?: boolean | null
          addenda_reviewed_at?: string | null
          bid_sheet_complete?: boolean | null
          bond_delivery_method?: string | null
          bond_in_person_delivered?: boolean | null
          bond_online_submitted?: boolean | null
          bond_required?: boolean | null
          job_walk_attended_by?: string | null
          job_walk_completed?: boolean | null
          job_walk_mandatory?: boolean | null
          project_id: string
          proposal_notarized?: boolean | null
          proposal_prepared?: boolean | null
          proposal_signed?: boolean | null
          updated_at?: string | null
        }
        Update: {
          addenda_issued?: boolean | null
          addenda_reviewed?: boolean | null
          addenda_reviewed_at?: string | null
          bid_sheet_complete?: boolean | null
          bond_delivery_method?: string | null
          bond_in_person_delivered?: boolean | null
          bond_online_submitted?: boolean | null
          bond_required?: boolean | null
          job_walk_attended_by?: string | null
          job_walk_completed?: boolean | null
          job_walk_mandatory?: boolean | null
          project_id?: string
          proposal_notarized?: boolean | null
          proposal_prepared?: boolean | null
          proposal_signed?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_bid_readiness_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          file_url: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          file_url: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          file_url?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_trades: {
        Row: {
          created_at: string | null
          id: string
          project_id: string
          trade_type_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          project_id: string
          trade_type_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          project_id?: string
          trade_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_trades_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_trades_trade_type_id_fkey"
            columns: ["trade_type_id"]
            isOneToOne: false
            referencedRelation: "trade_types"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          agency: string | null
          bid_due_at: string
          county: string | null
          crawl_changes: Json | null
          crawl_snapshot: Json | null
          created_at: string
          documents_accessible: boolean | null
          documents_visible: boolean | null
          eligibility_notes: string | null
          eligibility_restricted: boolean | null
          gc_id: string
          id: string
          instructions: string | null
          is_ready_to_bid: boolean | null
          job_walk_at: string | null
          job_walk_details: string | null
          job_walk_exists: boolean | null
          job_walk_mandatory: boolean | null
          last_crawled_at: string | null
          location: string | null
          name: string
          portal_type: string | null
          public_token: string
          scope_text: string | null
          source_url: string | null
          status: string
          timezone: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          agency?: string | null
          bid_due_at: string
          county?: string | null
          crawl_changes?: Json | null
          crawl_snapshot?: Json | null
          created_at?: string
          documents_accessible?: boolean | null
          documents_visible?: boolean | null
          eligibility_notes?: string | null
          eligibility_restricted?: boolean | null
          gc_id: string
          id?: string
          instructions?: string | null
          is_ready_to_bid?: boolean | null
          job_walk_at?: string | null
          job_walk_details?: string | null
          job_walk_exists?: boolean | null
          job_walk_mandatory?: boolean | null
          last_crawled_at?: string | null
          location?: string | null
          name: string
          portal_type?: string | null
          public_token?: string
          scope_text?: string | null
          source_url?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          agency?: string | null
          bid_due_at?: string
          county?: string | null
          crawl_changes?: Json | null
          crawl_snapshot?: Json | null
          created_at?: string
          documents_accessible?: boolean | null
          documents_visible?: boolean | null
          eligibility_notes?: string | null
          eligibility_restricted?: boolean | null
          gc_id?: string
          id?: string
          instructions?: string | null
          is_ready_to_bid?: boolean | null
          job_walk_at?: string | null
          job_walk_details?: string | null
          job_walk_exists?: boolean | null
          job_walk_mandatory?: boolean | null
          last_crawled_at?: string | null
          location?: string | null
          name?: string
          portal_type?: string | null
          public_token?: string
          scope_text?: string | null
          source_url?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_gc_id_fkey"
            columns: ["gc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sub_trade_mappings: {
        Row: {
          created_at: string | null
          id: string
          sub_id: string
          trade_type_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          sub_id: string
          trade_type_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          sub_id?: string
          trade_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_trade_mappings_sub_id_fkey"
            columns: ["sub_id"]
            isOneToOne: false
            referencedRelation: "subcontractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_trade_mappings_trade_type_id_fkey"
            columns: ["trade_type_id"]
            isOneToOne: false
            referencedRelation: "trade_types"
            referencedColumns: ["id"]
          },
        ]
      }
      subcontractors: {
        Row: {
          city: string | null
          company_name: string
          contact_name: string | null
          county: string | null
          created_at: string | null
          email: string | null
          id: string
          is_verified: boolean | null
          last_cslb_update: string | null
          license_expiration: string | null
          license_number: string | null
          license_status: string | null
          notes: string | null
          phone: string | null
          state_code: string | null
          updated_at: string | null
        }
        Insert: {
          city?: string | null
          company_name: string
          contact_name?: string | null
          county?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
          last_cslb_update?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          state_code?: string | null
          updated_at?: string | null
        }
        Update: {
          city?: string | null
          company_name?: string
          contact_name?: string | null
          county?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_verified?: boolean | null
          last_cslb_update?: string | null
          license_expiration?: string | null
          license_number?: string | null
          license_status?: string | null
          notes?: string | null
          phone?: string | null
          state_code?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_type: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_type?: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_type?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_types: {
        Row: {
          category: string | null
          code: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          notes: string | null
          parent_code: string | null
          source: string | null
          state_code: string | null
        }
        Insert: {
          category?: string | null
          code: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name: string
          notes?: string | null
          parent_code?: string | null
          source?: string | null
          state_code?: string | null
        }
        Update: {
          category?: string | null
          code?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          notes?: string | null
          parent_code?: string | null
          source?: string | null
          state_code?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_active_gcs_30d: { Args: never; Returns: number }
      get_admin_gc_metrics: {
        Args: never
        Returns: {
          bid_count: number
          company_name: string
          created_at: string
          email: string
          id: string
          project_count: number
        }[]
      }
      get_admin_kpi_summary: { Args: never; Returns: Json }
      get_avg_bids_per_project: { Args: never; Returns: number }
      get_avg_projects_per_gc: { Args: never; Returns: number }
      get_conversion_rate: { Args: never; Returns: number }
      get_submission_count: { Args: { p_project_id: string }; Returns: number }
      get_total_bid_room_views: { Args: never; Returns: number }
      get_total_bids: { Args: never; Returns: number }
      get_total_gcs: { Args: never; Returns: number }
      get_total_projects: { Args: never; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_view_count: {
        Args: { p_project_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
