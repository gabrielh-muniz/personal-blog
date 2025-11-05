---
title: "How Firebase Authentication works?"
description: "This post peels back the layers of Firebase Authentication to explain how it works and why its designers chose the protocols and trade-offs they did."
date: 2025-11-05
tags: ["firebase", "authentication"]
image: "/images/posts/firebase_authentication/firebase_showcase.png"
---

# Introduction

Firebase Authentication (Firebase Auth) is a managed authentication service offered by Google that lets applications authenticate users with email/password, federated identity providers (Google, Apple, Facebook, etc.), anonymous sign-ins, and custom tokens issued by backend systems. On the surface it looks like a convenience layer that issues tokens for clients and provides server libraries to verify them. Under the hood it is an instance of a common pattern in distributed authentication systems: a short-lived, locally verifiable credential (a signed token) plus a long-lived, server-mediated credential used to mint new short-lived credentials.

Understanding Firebase Auth deeply matters because it affects system design decisions for backend APIs, session management, revocation semantics, multi-device consistency, and compliance. This post aims to place Firebase Auth in the context of protocol standards (JWT, OAuth2/OIDC), and then walk through its architecture, token life cycles, verification, and trade-offs.

# Conceptual Foundations

Before we look at Firebase specifics, recall the canonical primitives and theory:

- JSON Web Token (JWT): a compact, URL-safe means of representing claims. A JWT is typically three base64url parts: header, payload (claims), and signature. Verification consists of validating the signature (using a key in a JWKS), then checking claims like `iss` (issuer), `exp` (expiration), `aud` (audience) and custom claims (RFC 7519).
- OAuth2 Refresh Token / Access Token dichotomy: access tokens are short-lived credentials used to access resources; refresh tokens are long-lived credentials that allow a client to obtain new access tokens without re-authenticating the user (RFC 6749). In many implementations, refresh tokens are opaque to clients and can be revoked server-side.
- Stateless vs Stateful sessions: a signed JWT allows stateless verification (servers need only fetch public keys), whereas session cookies or server session stores are stateful and permit easy revocation at the cost of server state and coordination.
- Threat model: token theft, replay, cross-site exposure (cookies), and misissued tokens. Design choices aim to minimize window of vulnerability (short JWT TTL), minimize sensitive on-client secrets, and enable server control (revocation lists or revocation counters).

These concepts provide the formal backdrop for understanding Firebase Auth.

# System architecture and internal mechanisms

## High-level components

- Client SDK (web, iOS, Android, etc.): handles interactive sign-in flows, stores a refresh token (opaque) and obtains ID tokens (JWTs) from Firebase Auth servers. The SDK automatically refreshes ID tokens when they near expiry.
- Firebase Auth backend / Identity service: authoritative authentication server that validates credentials (password, OAuth code exchanges, custom token exchange), mints ID tokens and refresh tokens, and exposes endpoints such as the secure token endpoint used for refresh operations.
- Application backend (your server): typically receives ID tokens from clients and verifies them (either using Firebase Admin SDK helpers or by manual JWT verification against Google’s JWKS). The backend enforces application-level authorization and may also cooperate with Firebase Admin functions for revocation.
- Admin SDK: server libraries that wrap verification, revocation checks, and session cookie minting APIs for convenience.

Imagine your app as a nightclub. Firebase Auth is the bouncer. The user's credentials (email/password, Google OAuth, etc.) are their ID. The ID token Firebase issues is the wristband that says, "this person is allowed inside". Your backend doesn't check ID's directly. Instead, it checks if the wristband is authentic and unexpired. This "wristband" is a signed JWT that represents the authenticated user.

So, when you make requests to your backend, you include it in your headers (e.g. `Authorization: Bearer <id_token>`). The backend verifies it using Google's public keys, ensuring the user hasn't forged it. Simple, but powerful.

## Token types and lifecycles

### ID token (JWT)

- **Form:** a JWT signed by Google's private keys. Contains standard claims (iss, sub/uid, aud, exp, iat) and Firebase specific claims (e.g., email_verified, firebase object with provider data, and optional custom claims).
- **TTL:** short, ≈1 hour by design; clients refresh it frequently. Short TTL reduces the window for replay attacks and simplifies stateless verification semantics.

### Refresh token (opaque)

- **Form:** opaque token (not a JWT) which the client persists (securely) and uses to request new ID tokens from Firebase’s token endpoint.
- **Lifetime and revocation:** refresh tokens are long-lived and allow the client to obtain new ID tokens indefinitely until explicitly revoked (by sign-out, password change, or explicit revocation actions). Because they are long-lived, they are more sensitive and must be stored and transmitted securely.

### Session cookie

- **Porpuse:** for server-side sessions that need long lifetimes (e.g., web apps), Firebase can mint an HttpOnly session cookie from a recently issued ID token. Cookies use platform cookie semantics and can last up to 14 days. Session cookies are stateful on the server in the sense that the Admin SDK supports verification and expiration control.

### Custom tokens

- **Use case:** your backend can mint a custom token (a signed JWT) for integrating external authentication systems or SSO. The client exchanges that custom token with Firebase Auth for regular ID/refresh tokens. Custom tokens expire quickly (about 1 hour) and require service account credentials to mint.

## Typical interaction flow (sequence)

![Sequence_diagram](/images/posts/firebase_authentication/flow_diagram_auth.jpeg)

1. Client authenticates (email/password, federated provider, or custom token) -> sends creds to Firebase Auth endpoints.
2. Firebase Auth validates credentials -> returns (`id_token (JWT), refresh_token (opaque), expires_in`) to client.
3. Client stores refresh token securely (platform-dependent) and uses ID token for API calls (`Authorization: Bearer <id_token>`). Client SDK refreshes ID tokens automatically before `exp`.
4. Application backend receives ID token -> verifies signature and claims (either via Admin SDK helper `verifyIdToken()` or manual validation using Google’s JWKS), then enforces authorization. The Admin SDK also provides facilities to check token revocation.
5. When ID token expires, the client calls the secure token endpoint with the refresh token to obtain a new ID token (and sometimes a new refresh token).

## Verification details and the JWKS model

Firebase ID tokens are signed using Google’s signing keys; public keys are published in a JWKS (JSON Web Key Set). A verifier fetches the JWKS, selects the key by `kid` in the JWT header, validates the signature, and checks standard claims (`iss`, `aud`, `exp`, `iat`) and application constraints (e.g., `email_verified required`). For high throughput, servers cache JWKS and keys with TTL and handle key rotation by retrying verification if the `kid` is unknown.

# Analytical discussion

## Strengths

- Stateless verification for API backends: ID tokens are verifiable without contacting the Firebase Auth backend on every request (only JWKS fetch is needed and can be cached). This is excellent for high throughput server clusters and aligns with the stateless token model (JWT).
- Client UX: SDKs hide refresh logic and token rotation from app code, enabling seamless sessions while keeping ID tokens short-lived. This reduces developer error and vulnerability windows.
- Managed provider integrations: Firebase centralizes federated login complexities (OAuth code exchanges) and exposes simple tokens to the app developer.

## Limitations and trade-offs

- Refresh token sensitivity: refresh tokens are long-lived and, if stolen, can mint new ID tokens indefinitely until revoked. Implementations must secure refresh tokens (platform secure storage, HttpOnly cookies where possible). The long-lived nature improves UX but increases the replay window compared to rotating short refresh tokens. Several community discussions highlight concerns about non-expiring refresh tokens and recommend careful handling.
- Revocation & multi-device consistency: revoking an ID token already issued is not possible by signature alone (since signature and expiry are baked into the JWT). Firebase offers revocation checks (e.g., token revocation counters, Admin SDK helpers), but checking revocation may require a server call or additional state checks; thus, revocation is inherently more complex than session store invalidation. This is the classic stateless vs stateful trade-off.
- Key rotation complexity: web services must correctly handle JWKS rotation (cache invalidation and retry on unknown kid) to avoid transient verification errors. This is common in JWKS-based verification systems.

## Scalability and complexity

- Time complexity: verification of a JWT is O(1) in terms of token size and cryptographic verification cost; fetching and caching public keys has network and cache costs but is amortized. The dominant cost at scale is cryptographic signature verification (RSA/ECDSA), which is CPU-bound.
- Space complexity: servers need only store cached JWKS and, if implementing revocation checks, a revocation map (e.g., revoked tokens / user revocation timestamps) - typically small compared to full session stores.

## Comparison with alternatives

- Pure cookie session store: session IDs stored in a server DB or distributed cache (Redis) allow immediate revocation and server control, but introduce stateful coordination and a DB/cache hop per request (higher latency and operational complexity).
- Opaque access tokens with introspection: some systems use opaque access tokens and an introspection endpoint for servers to validate tokens. This centralizes control and revocation but requires a network call for every request or a cache of introspection results. Firebase opts for signed JWTs for stateless verification plus refresh tokens for lifetime control - a hybrid approach offering good scalability and user experience at the cost of weaker instant revocation semantics.

# Common misconceptions and edge cases

> ID tokens are permanent and contain all truth about the user.

ID tokens are purpose-limited and short-lived. They reflect the user’s claims at issuance time; to capture later changes (e.g., email verified after sign-up), clients should refresh tokens or the server should re-check authoritative state. Session cookies can be minted to offer longer sessions, but will not automatically update claims without re-minting.

> The refresh token is safe to store anywhere.

No. Refresh tokens are sensitive credentials that can mint new ID tokens. On web apps, prefer HttpOnly, Secure cookies and avoid exposing refresh tokens to JavaScript; on mobile, use platform keystores. If a refresh token leaks, the attacker can obtain new ID tokens until the refresh token is invalidated.

> Token mismatch between session cookie and ID token issuer

Session cookies and ID tokens use different token types (cookie verification uses Admin SDK `verifySessionCookie()`); passing session cookies to ID token verifiers can lead to issuer errors (`iss` mismatch). Be explicit about which verification function to use for which token type.

> Languages or platforms without Admin SDK

You can manually verify ID tokens in any language by implementing JWT signature verification and claim checks. The Admin SDK simplifies this but is not required

# Conclusion

Firebase Authentication implements a pragmatic hybrid: short-lived, verifiable JWTs for scalable stateless verification and long-lived refresh tokens (opaque) to preserve user convenience. This model maps cleanly to OAuth2/OIDC conceptual primitives and balances UX with security in a managed service.
