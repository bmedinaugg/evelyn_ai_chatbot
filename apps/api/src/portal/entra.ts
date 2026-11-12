import { ConfidentialClientApplication, ResponseMode } from '@azure/msal-node';
import type { PortalConfig } from '@trainmore/shared';
import { z } from 'zod';

const SCOPES = ['openid', 'profile'];

/** The ID token claims the portal relies on (validated again by the caller). */
export const entraClaimsSchema = z.object({
  tid: z.string().optional(),
  aud: z.string().optional(),
  oid: z.string().optional(),
  name: z.string().optional(),
  roles: z.array(z.string()).optional(),
  nonce: z.string().optional(),
});
export type EntraClaims = z.infer<typeof entraClaimsSchema>;

/** Entra ID sign-in (authorization code + PKCE). The only place that talks to Microsoft. */
export interface EntraClient {
  authUrl(input: {
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
  }): Promise<string>;
  redeem(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    expectedNonce: string;
  }): Promise<EntraClaims>;
}

export function createEntraClient(config: PortalConfig): EntraClient {
  const msal = new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      clientSecret: config.clientSecret,
    },
  });
  return {
    authUrl(input) {
      return msal.getAuthCodeUrl({
        scopes: SCOPES,
        redirectUri: input.redirectUri,
        state: input.state,
        nonce: input.nonce,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: 'S256',
        responseMode: ResponseMode.QUERY,
      });
    },
    async redeem(input) {
      const result = await msal.acquireTokenByCode({
        scopes: SCOPES,
        code: input.code,
        redirectUri: input.redirectUri,
        codeVerifier: input.codeVerifier,
        nonce: input.expectedNonce,
      });
      // Only the identity is needed; keep no Entra tokens in memory.
      if (result.account) await msal.getTokenCache().removeAccount(result.account);
      return entraClaimsSchema.parse(result.idTokenClaims);
    },
  };
}
