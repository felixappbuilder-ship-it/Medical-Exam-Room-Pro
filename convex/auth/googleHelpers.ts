// convex/auth/googleHelpers.ts
"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { OAuth2Client } from "google-auth-library";
import { ConvexError } from "convex/values";

// ============================================================
// CONSTANTS
// ============================================================
// Google's fixed token issuers (we accept both, though `accounts.google.com`
// is the current canonical issuer).
const GOOGLE_ISSUERS = [
  "accounts.google.com",
  "https://accounts.google.com",
];

// Reusable client instances keyed by clientId. google-auth-library is
// safe to reuse and this avoids rebuilding the JWKS cache per request.
const clientCache = new Map<string, OAuth2Client>();

function getClient(clientId: string): OAuth2Client {
  let client = clientCache.get(clientId);
  if (!client) {
    client = new OAuth2Client(clientId);
    clientCache.set(clientId, client);
  }
  return client;
}

// ============================================================
// VERIFY GOOGLE ID TOKEN
// ============================================================
/**
 * Verifies a Google ID token (the JWT returned by Google Identity Services)
 * and returns the trusted identity payload.
 *
 * What this verifies (Google's documented requirements):
 *   - Signature via Google's public JWKS
 *   - `aud` matches our Google Client ID
 *   - `iss` is one of Google's expected issuers
 *   - `exp` is not in the past
 *   - `iat` is not absurdly far in the future
 *   - (optional) `nonce` matches if one was supplied
 *
 * Returns:
 *   {
 *     sub: string,             // stable Google account ID
 *     email: string,
 *     emailVerified: boolean,
 *     name: string,
 *     picture: string | undefined,
 *     givenName?: string,
 *     familyName?: string,
 *     locale?: string,
 *     hostedDomain?: string,   // set for Google Workspace accounts
 *     nonce?: string,
 *     issuedAt: number,        // seconds since epoch (from `iat`)
 *     expiresAt: number,       // seconds since epoch (from `exp`)
 *   }
 *
 * Throws ConvexError with a descriptive message on failure.
 */
export const verifyGoogleIdToken = internalAction({
  args: {
    idToken: v.string(),
    clientId: v.string(),
    // Optional nonce to bind the token to a specific sign-in attempt
    // (protects against replay / substitution attacks).
    nonce: v.optional(v.string()),
  },
  handler: async (_, args) => {
    // ---- Input validation ----
    if (!args.idToken || typeof args.idToken !== "string") {
      throw new ConvexError("Google ID token is missing or empty");
    }
    if (args.idToken.length > 8192) {
      // Sanity guard – real Google ID tokens are well under this.
      throw new ConvexError("Google ID token is malformed (too long)");
    }
    if (!args.clientId || typeof args.clientId !== "string") {
      throw new ConvexError("Google Client ID is missing");
    }

    // A Google ID token must have 3 dot-separated parts (header.payload.signature)
    const parts = args.idToken.split(".");
    if (parts.length !== 3) {
      throw new ConvexError("Google ID token is not a valid JWT (wrong segment count)");
    }

    const client = getClient(args.clientId);

    let ticket;
    try {
      ticket = await client.verifyIdToken({
        idToken: args.idToken,
        audience: args.clientId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown verification error";

      // Map common google-auth-library errors to clearer messages.
      let friendly = "Google token verification failed";
      if (/audience/i.test(msg) || /aud/i.test(msg)) {
        friendly = "Google token was issued for a different application";
      } else if (/expired/i.test(msg) || /exp/i.test(msg)) {
        friendly = "Google token has expired";
      } else if (/signature/i.test(msg)) {
        friendly = "Google token signature verification failed";
      } else if (/issuer/i.test(msg) || /iss/i.test(msg)) {
        friendly = "Google token issuer is not recognized";
      } else if (/malformed|invalid token|Wrong number of segments/i.test(msg)) {
        friendly = "Google token is malformed";
      }

      console.error("[verifyGoogleIdToken] Verification failed:", msg);
      throw new ConvexError(`${friendly}: ${msg}`);
    }

    const payload = ticket.getPayload();

    // ---- Structural checks ----
    if (!payload) {
      throw new ConvexError("Google token payload is missing");
    }
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new ConvexError("Google token is missing the required `sub` claim");
    }
    if (!payload.email || typeof payload.email !== "string") {
      throw new ConvexError("Google token is missing the required `email` claim");
    }

    // ---- Issuer check ----
    if (!payload.iss || !GOOGLE_ISSUERS.includes(payload.iss)) {
      throw new ConvexError(`Google token has an unrecognized issuer: ${payload.iss}`);
    }

    // ---- Time sanity checks ----
    const nowSec = Math.floor(Date.now() / 1000);

    if (typeof payload.exp !== "number" || payload.exp <= nowSec) {
      throw new ConvexError("Google token has expired");
    }

    // iat must not be absurdly in the future (allow 5 minutes of clock skew)
    if (typeof payload.iat === "number" && payload.iat > nowSec + 300) {
      throw new ConvexError("Google token has an invalid `iat` (issued in the future)");
    }

    // ---- Nonce check (if the caller supplied one) ----
    if (args.nonce) {
      const tokenNonce = (payload as any).nonce;
      if (!tokenNonce || tokenNonce !== args.nonce) {
        throw new ConvexError("Google token nonce does not match");
      }
    }

    // ---- Email verified ----
    // `email_verified` can be true, false, or undefined (Google usually sets it).
    // We only treat strictly `true` as verified.
    const emailVerified = payload.email_verified === true;

    // ---- Extract and normalize ----
    const nameFromGoogle =
      payload.name ||
      [payload.given_name, payload.family_name].filter(Boolean).join(" ").trim() ||
      payload.email.split("@")[0];

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified,
      name: nameFromGoogle,
      picture: payload.picture || undefined,
      givenName: payload.given_name || undefined,
      familyName: payload.family_name || undefined,
      locale: payload.locale || undefined,
      hostedDomain: payload.hd || undefined,
      nonce: (payload as any).nonce || undefined,
      issuedAt: typeof payload.iat === "number" ? payload.iat : nowSec,
      expiresAt: payload.exp,
    };
  },
});

// ============================================================
// VERIFY GOOGLE ACCESS TOKEN (optional – if you ever add the code flow)
// ============================================================
/**
 * Verifies a Google OAuth Access Token using Google's tokeninfo endpoint.
 * Used only if you later add the Authorization Code flow; not required
 * for the ID-token-only flow we currently use.
 *
 * Kept here so the helper module is a single source of truth for all
 * Google verification.
 */
export const verifyGoogleAccessToken = internalAction({
  args: {
    accessToken: v.string(),
  },
  handler: async (_, args) => {
    if (!args.accessToken) {
      throw new ConvexError("Access token is missing");
    }
    try {
      const resp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(args.accessToken)}`
      );
      if (!resp.ok) {
        const text = await resp.text();
        console.error("[verifyGoogleAccessToken] tokeninfo failed:", resp.status, text);
        throw new ConvexError(`Google access token verification failed (${resp.status})`);
      }
      const data: any = await resp.json();
      if (!data.sub && !data.user_id) {
        throw new ConvexError("Google access token payload is missing user id");
      }
      return {
        sub: data.sub || data.user_id,
        email: data.email || undefined,
        emailVerified: data.email_verified === "true" || data.email_verified === true,
        scope: data.scope || undefined,
        expiresIn: data.expires_in ? Number(data.expires_in) : undefined,
        audience: data.audience || undefined,
      };
    } catch (err) {
      if (err instanceof ConvexError) throw err;
      const msg = err instanceof Error ? err.message : "unknown error";
      console.error("[verifyGoogleAccessToken] error:", msg);
      throw new ConvexError(`Google access token verification failed: ${msg}`);
    }
  },
});