import { isIP } from 'node:net';

function ipv4Octets(address: string): number[] | undefined {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return isIP(v4) === 4 ? v4.split('.').map(Number) : undefined;
}

/** RFC 1918, loopback and IPv6 unique-local addresses: our VPC (ALB) or the local machine. */
export function isPrivateAddress(address: string): boolean {
  const octets = ipv4Octets(address);
  if (octets) {
    const [a = -1, b = -1] = octets;
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

/**
 * Trust function for Fastify's trustProxy: trust `hops` proxies (CloudFront + ALB = 2), but only
 * when the direct peer is a private address. A client connecting straight to the API cannot make
 * us trust its own X-Forwarded-For.
 */
export function proxyTrust(hops: number): (address: string, hop: number) => boolean {
  return (address, hop) => hop < hops && (hop > 0 || isPrivateAddress(address));
}
