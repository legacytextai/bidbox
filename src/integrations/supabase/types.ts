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
          refresh_window: string | null
          result: Json | null
          started_at: string | null
          status: string
          task_type: string
          trigger_reason: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          priority?: number
          refresh_window?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          task_type: string
          trigger_reason?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          priority?: number
          refresh_window?: string | null
          result?: Json | null
          started_at?: string | null
          status?: string
          task_type?: string
          trigger_reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
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
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          profile_id: string
          role: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          profile_id: string
          role?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          profile_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
      opportunity_bid_items: {
        Row: {
          created_at: string
          description: string
          extracted_at: string
          extraction_method: string
          extraction_status: string
          id: string
          item_code: string | null
          item_number: string | null
          metadata: Json
          opportunity_candidate_id: string
          opportunity_document_id: string | null
          quantity: number | null
          quantity_raw: string | null
          raw_text: string | null
          reference: string | null
          section_name: string | null
          section_number: string | null
          source_opportunity_id: string | null
          source_order: number
          source_portal: string | null
          source_url: string | null
          unit_of_measure: string | null
          unit_price: number | null
          unit_price_raw: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          extracted_at?: string
          extraction_method: string
          extraction_status?: string
          id?: string
          item_code?: string | null
          item_number?: string | null
          metadata?: Json
          opportunity_candidate_id: string
          opportunity_document_id?: string | null
          quantity?: number | null
          quantity_raw?: string | null
          raw_text?: string | null
          reference?: string | null
          section_name?: string | null
          section_number?: string | null
          source_opportunity_id?: string | null
          source_order?: number
          source_portal?: string | null
          source_url?: string | null
          unit_of_measure?: string | null
          unit_price?: number | null
          unit_price_raw?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          extracted_at?: string
          extraction_method?: string
          extraction_status?: string
          id?: string
          item_code?: string | null
          item_number?: string | null
          metadata?: Json
          opportunity_candidate_id?: string
          opportunity_document_id?: string | null
          quantity?: number | null
          quantity_raw?: string | null
          raw_text?: string | null
          reference?: string | null
          section_name?: string | null
          section_number?: string | null
          source_opportunity_id?: string | null
          source_order?: number
          source_portal?: string | null
          source_url?: string | null
          unit_of_measure?: string | null
          unit_price?: number | null
          unit_price_raw?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_bid_items_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_bid_items_opportunity_document_id_fkey"
            columns: ["opportunity_document_id"]
            isOneToOne: false
            referencedRelation: "opportunity_documents"
            referencedColumns: ["id"]
          },
        ]
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
          county: string | null
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
          estimated_value: number | null
          estimated_value_high: number | null
          estimated_value_low: number | null
          id: string
          last_crawled_at: string | null
          last_metadata_changed_at: string | null
          last_metadata_refreshed_at: string | null
          metadata_refresh_count: number
          metadata_refresh_source: string | null
          metadata_refresh_trigger: string | null
          opportunity_intelligence_error: string | null
          opportunity_intelligence_ready_at: string | null
          opportunity_intelligence_status: string
          opportunity_intelligence_task_id: string | null
          opportunity_lifecycle_status: string
          portal_bid_id: string | null
          portal_department: string | null
          portal_summary: string | null
          portal_summary_at: string | null
          portal_type: string | null
          project_address: string | null
          qualification_score: number | null
          qualified_at: string | null
          raw_title: string | null
          required_licenses: string[] | null
          required_naics: string[] | null
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
          county?: string | null
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
          estimated_value?: number | null
          estimated_value_high?: number | null
          estimated_value_low?: number | null
          id?: string
          last_crawled_at?: string | null
          last_metadata_changed_at?: string | null
          last_metadata_refreshed_at?: string | null
          metadata_refresh_count?: number
          metadata_refresh_source?: string | null
          metadata_refresh_trigger?: string | null
          opportunity_intelligence_error?: string | null
          opportunity_intelligence_ready_at?: string | null
          opportunity_intelligence_status?: string
          opportunity_intelligence_task_id?: string | null
          opportunity_lifecycle_status?: string
          portal_bid_id?: string | null
          portal_department?: string | null
          portal_summary?: string | null
          portal_summary_at?: string | null
          portal_type?: string | null
          project_address?: string | null
          qualification_score?: number | null
          qualified_at?: string | null
          raw_title?: string | null
          required_licenses?: string[] | null
          required_naics?: string[] | null
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
          county?: string | null
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
          estimated_value?: number | null
          estimated_value_high?: number | null
          estimated_value_low?: number | null
          id?: string
          last_crawled_at?: string | null
          last_metadata_changed_at?: string | null
          last_metadata_refreshed_at?: string | null
          metadata_refresh_count?: number
          metadata_refresh_source?: string | null
          metadata_refresh_trigger?: string | null
          opportunity_intelligence_error?: string | null
          opportunity_intelligence_ready_at?: string | null
          opportunity_intelligence_status?: string
          opportunity_intelligence_task_id?: string | null
          opportunity_lifecycle_status?: string
          portal_bid_id?: string | null
          portal_department?: string | null
          portal_summary?: string | null
          portal_summary_at?: string | null
          portal_type?: string | null
          project_address?: string | null
          qualification_score?: number | null
          qualified_at?: string | null
          raw_title?: string | null
          required_licenses?: string[] | null
          required_naics?: string[] | null
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
            foreignKeyName: "opportunity_candidates_opportunity_intelligence_task_id_fkey"
            columns: ["opportunity_intelligence_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
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
      opportunity_intelligence_citations: {
        Row: {
          citation_label: string | null
          created_at: string
          finding_id: string
          id: string
          opportunity_document_chunk_id: string
          opportunity_document_id: string
          opportunity_document_page_id: string | null
          page_label: string | null
          page_number: number | null
          report_id: string
          source_document_name: string
          source_excerpt: string
        }
        Insert: {
          citation_label?: string | null
          created_at?: string
          finding_id: string
          id?: string
          opportunity_document_chunk_id: string
          opportunity_document_id: string
          opportunity_document_page_id?: string | null
          page_label?: string | null
          page_number?: number | null
          report_id: string
          source_document_name: string
          source_excerpt: string
        }
        Update: {
          citation_label?: string | null
          created_at?: string
          finding_id?: string
          id?: string
          opportunity_document_chunk_id?: string
          opportunity_document_id?: string
          opportunity_document_page_id?: string | null
          page_label?: string | null
          page_number?: number | null
          report_id?: string
          source_document_name?: string
          source_excerpt?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_intelligence_cita_opportunity_document_chunk_i_fkey"
            columns: ["opportunity_document_chunk_id"]
            isOneToOne: false
            referencedRelation: "opportunity_document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_cita_opportunity_document_page_id_fkey"
            columns: ["opportunity_document_page_id"]
            isOneToOne: false
            referencedRelation: "opportunity_document_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_citations_finding_id_fkey"
            columns: ["finding_id"]
            isOneToOne: false
            referencedRelation: "opportunity_intelligence_findings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_citations_opportunity_document_id_fkey"
            columns: ["opportunity_document_id"]
            isOneToOne: false
            referencedRelation: "opportunity_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_citations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "opportunity_intelligence_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_intelligence_findings: {
        Row: {
          category: string
          confidence: string
          created_at: string
          field_key: string
          id: string
          is_critical: boolean
          label: string
          notes: string | null
          opportunity_candidate_id: string
          report_id: string
          sort_order: number
          status: string
          value_jsonb: Json | null
          value_text: string | null
        }
        Insert: {
          category: string
          confidence?: string
          created_at?: string
          field_key: string
          id?: string
          is_critical?: boolean
          label: string
          notes?: string | null
          opportunity_candidate_id: string
          report_id: string
          sort_order?: number
          status: string
          value_jsonb?: Json | null
          value_text?: string | null
        }
        Update: {
          category?: string
          confidence?: string
          created_at?: string
          field_key?: string
          id?: string
          is_critical?: boolean
          label?: string
          notes?: string | null
          opportunity_candidate_id?: string
          report_id?: string
          sort_order?: number
          status?: string
          value_jsonb?: Json | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_intelligence_findings_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_findings_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "opportunity_intelligence_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      opportunity_intelligence_reports: {
        Row: {
          addenda_summary: Json
          agent_task_id: string | null
          bid_requirements: Json
          completed_at: string | null
          confidence_score: number | null
          created_at: string
          error: string | null
          executive_summary: Json
          generation_metadata: Json | null
          id: string
          key_dates: Json
          opportunity_candidate_id: string
          overview: Json
          report_schema_version: string
          report_version: number
          risk_flags: Json
          scope_summary: Json
          started_at: string | null
          status: string
          title: string | null
          trade_breakdown: Json
          unknowns: Json
          updated_at: string
        }
        Insert: {
          addenda_summary?: Json
          agent_task_id?: string | null
          bid_requirements?: Json
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          error?: string | null
          executive_summary?: Json
          generation_metadata?: Json | null
          id?: string
          key_dates?: Json
          opportunity_candidate_id: string
          overview?: Json
          report_schema_version?: string
          report_version?: number
          risk_flags?: Json
          scope_summary?: Json
          started_at?: string | null
          status?: string
          title?: string | null
          trade_breakdown?: Json
          unknowns?: Json
          updated_at?: string
        }
        Update: {
          addenda_summary?: Json
          agent_task_id?: string | null
          bid_requirements?: Json
          completed_at?: string | null
          confidence_score?: number | null
          created_at?: string
          error?: string | null
          executive_summary?: Json
          generation_metadata?: Json | null
          id?: string
          key_dates?: Json
          opportunity_candidate_id?: string
          overview?: Json
          report_schema_version?: string
          report_version?: number
          risk_flags?: Json
          scope_summary?: Json
          started_at?: string | null
          status?: string
          title?: string | null
          trade_breakdown?: Json
          unknowns?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunity_intelligence_reports_agent_task_id_fkey"
            columns: ["agent_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunity_intelligence_reports_opportunity_candidate_id_fkey"
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
          last_refresh_completed_at: string | null
          last_refresh_error: string | null
          last_refresh_failed_at: string | null
          last_refresh_queued_at: string | null
          last_refresh_started_at: string | null
          last_refresh_status: string
          last_scanned_at: string | null
          listing_url: string
          name: string
          portal_type: string
          refresh_cadence_hours: number
          refresh_enabled: boolean
          scan_enabled: boolean
          scan_interval_hours: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_refresh_completed_at?: string | null
          last_refresh_error?: string | null
          last_refresh_failed_at?: string | null
          last_refresh_queued_at?: string | null
          last_refresh_started_at?: string | null
          last_refresh_status?: string
          last_scanned_at?: string | null
          listing_url: string
          name: string
          portal_type: string
          refresh_cadence_hours?: number
          refresh_enabled?: boolean
          scan_enabled?: boolean
          scan_interval_hours?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_refresh_completed_at?: string | null
          last_refresh_error?: string | null
          last_refresh_failed_at?: string | null
          last_refresh_queued_at?: string | null
          last_refresh_started_at?: string | null
          last_refresh_status?: string
          last_scanned_at?: string | null
          listing_url?: string
          name?: string
          portal_type?: string
          refresh_cadence_hours?: number
          refresh_enabled?: boolean
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
      project_readiness_items: {
        Row: {
          created_at: string
          derived_source: Json | null
          derived_status: string
          id: string
          key: string
          manual_status: string
          notes: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          derived_source?: Json | null
          derived_status?: string
          id?: string
          key: string
          manual_status?: string
          notes?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          derived_source?: Json | null
          derived_status?: string
          id?: string
          key?: string
          manual_status?: string
          notes?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_readiness_items_project_id_fkey"
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
          added_to_calendar_at: string | null
          added_to_calendar_by: string | null
          agency: string | null
          bid_due_at: string
          bid_due_override_at: string | null
          bid_due_override_reason: string | null
          bid_due_override_source: string | null
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
          job_walk_override_at: string | null
          job_walk_override_reason: string | null
          last_crawled_at: string | null
          location: string | null
          name: string
          opportunity_intelligence_report_id: string | null
          origin: string
          portal_type: string | null
          project_intelligence_error: string | null
          project_intelligence_ready_at: string | null
          project_intelligence_status: string
          project_intelligence_task_id: string | null
          project_lifecycle_status: string
          public_token: string
          pursuit_status: string
          pursuit_status_updated_at: string | null
          pursuit_status_updated_by: string | null
          scope_text: string | null
          source_opportunity_candidate_id: string | null
          source_url: string | null
          status: string
          timezone: string | null
          updated_at: string
          view_count: number
        }
        Insert: {
          added_to_calendar_at?: string | null
          added_to_calendar_by?: string | null
          agency?: string | null
          bid_due_at: string
          bid_due_override_at?: string | null
          bid_due_override_reason?: string | null
          bid_due_override_source?: string | null
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
          job_walk_override_at?: string | null
          job_walk_override_reason?: string | null
          last_crawled_at?: string | null
          location?: string | null
          name: string
          opportunity_intelligence_report_id?: string | null
          origin?: string
          portal_type?: string | null
          project_intelligence_error?: string | null
          project_intelligence_ready_at?: string | null
          project_intelligence_status?: string
          project_intelligence_task_id?: string | null
          project_lifecycle_status?: string
          public_token?: string
          pursuit_status?: string
          pursuit_status_updated_at?: string | null
          pursuit_status_updated_by?: string | null
          scope_text?: string | null
          source_opportunity_candidate_id?: string | null
          source_url?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
          view_count?: number
        }
        Update: {
          added_to_calendar_at?: string | null
          added_to_calendar_by?: string | null
          agency?: string | null
          bid_due_at?: string
          bid_due_override_at?: string | null
          bid_due_override_reason?: string | null
          bid_due_override_source?: string | null
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
          job_walk_override_at?: string | null
          job_walk_override_reason?: string | null
          last_crawled_at?: string | null
          location?: string | null
          name?: string
          opportunity_intelligence_report_id?: string | null
          origin?: string
          portal_type?: string | null
          project_intelligence_error?: string | null
          project_intelligence_ready_at?: string | null
          project_intelligence_status?: string
          project_intelligence_task_id?: string | null
          project_lifecycle_status?: string
          public_token?: string
          pursuit_status?: string
          pursuit_status_updated_at?: string | null
          pursuit_status_updated_by?: string | null
          scope_text?: string | null
          source_opportunity_candidate_id?: string | null
          source_url?: string | null
          status?: string
          timezone?: string | null
          updated_at?: string
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "projects_added_to_calendar_by_fkey"
            columns: ["added_to_calendar_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_gc_id_fkey"
            columns: ["gc_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_opportunity_intelligence_report_id_fkey"
            columns: ["opportunity_intelligence_report_id"]
            isOneToOne: false
            referencedRelation: "opportunity_intelligence_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_intelligence_task_id_fkey"
            columns: ["project_intelligence_task_id"]
            isOneToOne: false
            referencedRelation: "agent_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_pursuit_status_updated_by_fkey"
            columns: ["pursuit_status_updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_source_opportunity_candidate_id_fkey"
            columns: ["source_opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_opportunities: {
        Row: {
          created_at: string
          id: string
          opportunity_candidate_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          opportunity_candidate_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          opportunity_candidate_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_opportunities_opportunity_candidate_id_fkey"
            columns: ["opportunity_candidate_id"]
            isOneToOne: false
            referencedRelation: "opportunity_candidates"
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
      acquire_planetbids_lock: {
        Args: { p_ttl_seconds?: number; p_worker_id: string }
        Returns: boolean
      }
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
      is_company_member: {
        Args: { target_company_id: string }
        Returns: boolean
      }
      release_planetbids_lock: {
        Args: { p_worker_id: string }
        Returns: boolean
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
