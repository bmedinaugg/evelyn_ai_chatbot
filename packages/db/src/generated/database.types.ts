
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor": string,"actor_name": string | null,"details": NonNullable<Json>,"entity_id": string | null,"entity_type": string | null,"id": number,"occurred_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor": string,"actor_name"?: string | null,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: never,"occurred_at"?: string
                  }
                  Update: {
                    "action"?: string,"actor"?: string,"actor_name"?: string | null,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"id"?: never,"occurred_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"capability_flags": {
                  Row: {
                    "enabled": boolean,"name": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "enabled"?: boolean,"name": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "enabled"?: boolean,"name"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"conversation_logins": {
                  Row: {
                    "conversation_id": string,"email_hash": string,"verified_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"email_hash": string,"verified_at"?: string
                  }
                  Update: {
                    "conversation_id"?: string,"email_hash"?: string,"verified_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversation_logins_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "account_candidates": Json | null,"anonymised_at": string | null,"created_at": string,"customer_id": number | null,"customer_status": string | null,"id": string,"lang": string,"last_message_at": string | null,"studio_id": number | null,"token_hash": string,"turn_claim_id": string | null,"turn_claimed_at": string | null,"user_message_count": number,"verified_at": string | null,"verified_email_hash": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_candidates"?: Json | null,"anonymised_at"?: string | null,"created_at"?: string,"customer_id"?: number | null,"customer_status"?: string | null,"id"?: string,"lang": string,"last_message_at"?: string | null,"studio_id"?: number | null,"token_hash": string,"turn_claim_id"?: string | null,"turn_claimed_at"?: string | null,"user_message_count"?: number,"verified_at"?: string | null,"verified_email_hash"?: string | null
                  }
                  Update: {
                    "account_candidates"?: Json | null,"anonymised_at"?: string | null,"created_at"?: string,"customer_id"?: number | null,"customer_status"?: string | null,"id"?: string,"lang"?: string,"last_message_at"?: string | null,"studio_id"?: number | null,"token_hash"?: string,"turn_claim_id"?: string | null,"turn_claimed_at"?: string | null,"user_message_count"?: number,"verified_at"?: string | null,"verified_email_hash"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"daily_reports": {
                  Row: {
                    "claimed_at": string,"clustered": boolean | null,"day": string,"recipients_count": number | null,"sent_at": string | null,"topics": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string,"clustered"?: boolean | null,"day": string,"recipients_count"?: number | null,"sent_at"?: string | null,"topics"?: NonNullable<Json>
                  }
                  Update: {
                    "claimed_at"?: string,"clustered"?: boolean | null,"day"?: string,"recipients_count"?: number | null,"sent_at"?: string | null,"topics"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"escalations": {
                  Row: {
                    "conversation_id": string | null,"created_at": string,"freshdesk_ticket_id": number,"id": number,"reason": string,"topic": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id"?: string | null,"created_at"?: string,"freshdesk_ticket_id": number,"id"?: never,"reason": string,"topic": string
                  }
                  Update: {
                    "conversation_id"?: string | null,"created_at"?: string,"freshdesk_ticket_id"?: number,"id"?: never,"reason"?: string,"topic"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "escalations_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"faq_articles": {
                  Row: {
                    "body_en": string | null,"body_nl": string | null,"content_hash": string,"deleted_at": string | null,"folder_id": number,"freshdesk_updated_at": string,"id": number,"search_en": unknown,"search_nl": unknown,"synced_at": string,"title_en": string | null,"title_nl": string | null,"url_en": string | null,"url_nl": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body_en"?: string | null,"body_nl"?: string | null,"content_hash": string,"deleted_at"?: string | null,"folder_id": number,"freshdesk_updated_at": string,"id": number,"search_en"?: never,"search_nl"?: never,"synced_at"?: string,"title_en"?: string | null,"title_nl"?: string | null,"url_en"?: string | null,"url_nl"?: string | null
                  }
                  Update: {
                    "body_en"?: string | null,"body_nl"?: string | null,"content_hash"?: string,"deleted_at"?: string | null,"folder_id"?: number,"freshdesk_updated_at"?: string,"id"?: number,"search_en"?: never,"search_nl"?: never,"synced_at"?: string,"title_en"?: string | null,"title_nl"?: string | null,"url_en"?: string | null,"url_nl"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"flags": {
                  Row: {
                    "conversation_id": string,"created_at": string,"id": number,"message_id": number | null,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"id"?: never,"message_id"?: number | null,"reason": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"id"?: never,"message_id"?: number | null,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "flags_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "flags_message_id_fkey"
      columns: ["message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_submissions": {
                  Row: {
                    "conversation_id": string | null,"created_at": string,"freshdesk_ticket_id": number,"id": number,"lang": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id"?: string | null,"created_at"?: string,"freshdesk_ticket_id": number,"id"?: never,"lang": string
                  }
                  Update: {
                    "conversation_id"?: string | null,"created_at"?: string,"freshdesk_ticket_id"?: number,"id"?: never,"lang"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "lead_submissions_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"message_feedback": {
                  Row: {
                    "created_at": string,"message_id": number,"rating": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"message_id": number,"rating": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"message_id"?: number,"rating"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "message_feedback_message_id_fkey"
      columns: ["message_id"]
isOneToOne: true
      referencedRelation: "messages"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "api_content": NonNullable<Json>,"citations": NonNullable<Json>,"conversation_id": string,"created_at": string,"display_text": string,"id": number,"outcome": string | null,"role": string,"scenario_version_id": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_content": NonNullable<Json>,"citations"?: NonNullable<Json>,"conversation_id": string,"created_at"?: string,"display_text": string,"id"?: never,"outcome"?: string | null,"role": string,"scenario_version_id"?: number | null
                  }
                  Update: {
                    "api_content"?: NonNullable<Json>,"citations"?: NonNullable<Json>,"conversation_id"?: string,"created_at"?: string,"display_text"?: string,"id"?: never,"outcome"?: string | null,"role"?: string,"scenario_version_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_scenario_version_id_fkey"
      columns: ["scenario_version_id"]
isOneToOne: false
      referencedRelation: "scenario_versions"
      referencedColumns: ["id"]
    }
                  ]
                },"otp_challenges": {
                  Row: {
                    "attempts": number,"code_hash": string,"consumed_at": string | null,"conversation_id": string,"created_at": string,"email_hash": string,"expires_at": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"code_hash": string,"consumed_at"?: string | null,"conversation_id": string,"created_at"?: string,"email_hash": string,"expires_at": string,"id": string
                  }
                  Update: {
                    "attempts"?: number,"code_hash"?: string,"consumed_at"?: string | null,"conversation_id"?: string,"created_at"?: string,"email_hash"?: string,"expires_at"?: string,"id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "otp_challenges_conversation_id_fkey"
      columns: ["conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["id"]
    }
                  ]
                },"portal_sessions": {
                  Row: {
                    "created_at": string,"display_name": string,"expires_at": string,"id_hash": string,"roles": (string)[],"user_oid": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name": string,"expires_at": string,"id_hash": string,"roles": (string)[],"user_oid": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string,"expires_at"?: string,"id_hash"?: string,"roles"?: (string)[],"user_oid"?: string
                  }
                  Relationships: [
                    
                  ]
                },"scenario_versions": {
                  Row: {
                    "answer_en": string,"answer_nl": string,"article_id": number | null,"author_name": string,"author_oid": string,"created_at": string,"id": number,"published_at": string | null,"published_by": string | null,"published_by_name": string | null,"scenario_id": string,"search_en": unknown,"search_nl": unknown,"status": string,"statuses": (string)[],"triggers_en": (string)[],"triggers_nl": (string)[],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "answer_en": string,"answer_nl": string,"article_id"?: number | null,"author_name": string,"author_oid": string,"created_at"?: string,"id"?: never,"published_at"?: string | null,"published_by"?: string | null,"published_by_name"?: string | null,"scenario_id": string,"search_en"?: never,"search_nl"?: never,"status"?: string,"statuses"?: (string)[],"triggers_en": (string)[],"triggers_nl": (string)[],"version": number
                  }
                  Update: {
                    "answer_en"?: string,"answer_nl"?: string,"article_id"?: number | null,"author_name"?: string,"author_oid"?: string,"created_at"?: string,"id"?: never,"published_at"?: string | null,"published_by"?: string | null,"published_by_name"?: string | null,"scenario_id"?: string,"search_en"?: never,"search_nl"?: never,"status"?: string,"statuses"?: (string)[],"triggers_en"?: (string)[],"triggers_nl"?: (string)[],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "scenario_versions_article_id_fkey"
      columns: ["article_id"]
isOneToOne: false
      referencedRelation: "faq_articles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scenario_versions_scenario_id_fkey"
      columns: ["scenario_id"]
isOneToOne: false
      referencedRelation: "scenarios"
      referencedColumns: ["id"]
    }
                  ]
                },"scenarios": {
                  Row: {
                    "archived_at": string | null,"archived_by": string | null,"created_at": string,"created_by": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"created_at"?: string,"created_by": string,"id"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"archived_by"?: string | null,"created_at"?: string,"created_by"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ticket_topics": {
                  Row: {
                    "active": boolean,"synced_at": string,"value": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"synced_at"?: string,"value": string
                  }
                  Update: {
                    "active"?: boolean,"synced_at"?: string,"value"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "add_scenario_version":
{ Args: { "p_actor_name": string,"p_actor_oid": string,"p_content": Json,"p_scenario_id": string }; Returns: number
                           },
"anonymise_conversations":
{ Args: { "p_before": string,"p_limit": number }; Returns: number
                           },
"append_chat_turn":
{ Args: { "p_assistant": Json,"p_claim_id": string,"p_conversation_id": string,"p_flags": (string)[],"p_steps"?: Json,"p_user": Json }; Returns: number
                           },
"archive_scenario":
{ Args: { "p_actor_name": string,"p_actor_oid": string,"p_scenario_id": string }; Returns: string
                           },
"bind_account":
{ Args: { "p_conversation_id": string,"p_index": number }; Returns: boolean
                           },
"claim_conversation_turn":
{ Args: { "p_id": string }; Returns: string
                           },
"claim_daily_report":
{ Args: { "p_day": string,"p_resend": boolean }; Returns: boolean
                           },
"clear_account_bindings":
{ Args: { "p_before": string }; Returns: number
                           },
"create_otp_challenge":
{ Args: { "p_code_hash": string,"p_conversation_id": string,"p_email_hash": string,"p_id": string,"p_max_per_window": number,"p_ttl_seconds": number,"p_window_seconds": number }; Returns: boolean
                           },
"create_scenario":
{ Args: { "p_actor_name": string,"p_actor_oid": string,"p_content": Json }; Returns: {
              "scenario_id": string,"version_id": number
            }[]
                           },
"daily_metrics":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "approved_answers": number,"conversations": number,"day": string,"escalations": number,"flags": Json,"logins": number,"resolved": number,"thumbs_down": number,"thumbs_up": number
            }[]
                           },
"dsar_delete":
{ Args: { "p_email_hash": string }; Returns: {
              "conversations": number,"otp_challenges": number
            }[]
                           },
"finish_daily_report":
{ Args: { "p_clustered": boolean,"p_day": string,"p_recipients_count": number,"p_topics": Json }; Returns: undefined
                           },
"flagged_questions":
{ Args: { "p_from": string,"p_limit": number,"p_to": string }; Returns: {
              "conversation_id": string,"message_id": number,"question": string,"reasons": (string)[]
            }[]
                           },
"list_flagged_conversations":
{ Args: { "p_limit": number,"p_offset": number,"p_reason": string,"p_since": string }; Returns: {
              "conversation_id": string,"escalated": boolean,"lang": string,"last_flag_at": string,"logged_in": boolean,"reasons": (string)[],"user_message_count": number
            }[]
                           },
"publish_scenario_version":
{ Args: { "p_actor_name": string,"p_actor_oid": string,"p_version_id": number }; Returns: string
                           },
"purge_otp_challenges":
{ Args: { "p_before": string }; Returns: number
                           },
"record_feedback":
{ Args: { "p_conversation_id": string,"p_message_id": number,"p_rating": string }; Returns: boolean
                           },
"release_conversation_turn":
{ Args: { "p_claim_id": string,"p_id": string }; Returns: undefined
                           },
"release_daily_report":
{ Args: { "p_day": string }; Returns: undefined
                           },
"replace_ticket_topics":
{ Args: { "p_values": (string)[] }; Returns: undefined
                           },
"search_faq":
{ Args: { "max_results"?: number,"preferred_lang": string,"query": string }; Returns: {
              "article_id": number,"body": string,"lang": string,"rank": number,"title": string,"url": string
            }[]
                           },
"search_scenarios":
{ Args: { "max_results"?: number,"preferred_lang": string,"query": string }; Returns: {
              "answer_en": string,"answer_nl": string,"article_id": number,"article_title": string,"article_url": string,"rank": number,"scenario_id": string,"statuses": (string)[],"triggers": (string)[],"version_id": number
            }[]
                           },
"set_account_candidates":
{ Args: { "p_candidates": Json,"p_conversation_id": string }; Returns: undefined
                           },
"set_capability":
{ Args: { "p_actor_name": string,"p_actor_oid": string,"p_enabled": boolean,"p_name": string }; Returns: undefined
                           },
"verify_otp_attempt":
{ Args: { "p_challenge_id": string,"p_code_hash": string,"p_conversation_id": string,"p_max_attempts": number }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
