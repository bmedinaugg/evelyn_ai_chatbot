import { describe, expect, it } from 'vitest';
import { isPrivateAddress, proxyTrust } from '../src/proxy-trust.ts';

describe('isPrivateAddress', () => {
  it('recognises VPC and loopback addresses', () => {
    for (const ip of [
      '10.0.1.20',
      '172.16.5.1',
      '172.31.255.255',
      '192.168.1.1',
      '127.0.0.1',
      '::1',
      '::ffff:10.0.0.7',
      'fd12::1',
    ]) {
      expect(isPrivateAddress(ip)).toBe(true);
    }
  });

  it('treats public addresses as untrusted', () => {
    for (const ip of ['203.0.113.5', '172.32.0.1', '8.8.8.8', '2001:db8::1', 'not-an-ip']) {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  });
});

describe('proxyTrust', () => {
  it('trusts the configured hops only behind a private peer', () => {
    const trust = proxyTrust(2);
    expect(trust('10.0.1.20', 0)).toBe(true);
    expect(trust('130.176.0.10', 1)).toBe(true);
    expect(trust('203.0.113.5', 2)).toBe(false);
    expect(trust('203.0.113.5', 0)).toBe(false);
  });
});
