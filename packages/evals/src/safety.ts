function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Evals never touch real customer data: Magicline must be the mock server on this machine. */
export function isLocalMagicline(baseUrl: string): boolean {
  return isLocalUrl(baseUrl);
}

/** Evals publish synthetic approved answers: only ever into the local Supabase stack. */
export function isLocalSupabase(url: string): boolean {
  return isLocalUrl(url);
}
