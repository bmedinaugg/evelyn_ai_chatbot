import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './generated/database.types.ts';

export type ServiceClient = SupabaseClient<Database>;

/** Server-only client with the service-role key. Never use this in the widget. */
export function createServiceClient(cfg: { url: string; serviceRoleKey: string }): ServiceClient {
  return createClient<Database>(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Database errors carry the operation and Postgres error code only. */
export class DbError extends Error {
  readonly code: string | undefined;

  constructor(operation: string, code: string | undefined) {
    super(`Database ${operation} failed${code ? ` (${code})` : ''}`);
    this.name = 'DbError';
    this.code = code;
  }
}
