/** Evals never touch real customer data: Magicline must be the mock server on this machine. */
export function isLocalMagicline(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}
