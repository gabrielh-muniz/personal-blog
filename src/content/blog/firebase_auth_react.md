---
title: "Building a secure, practical authentication system with Firebase Auth and React"
description: "This post presents a deep, end-to-end design and implementation exploration of an authentication system built with React (client), Firebase Authentication (identity service), Zustand (client state), TailwindCSS and Zod (input/schema validation)."
date: 2025-11-05
tags: ["firebase", "authentication", "react", "zustand"]
image: "/images/posts/firebase_auth_react/firebase_auth_react_showcase.png"
---

Beyond a how-to, this article explains the formal models and trade-offs behind each choice: token lifecycles, trust boundaries, storage models, and UX vs. security trade-offs. We tie protocol-level concepts (JWT/OIDC semantics, refresh token models) to concrete engineering patterns (automatic token refresh, secure storage, session cookie vs. SPA flows) and show sample code and architecture diagrams enabling researchers and advanced developers to reason about correctness, performance, and security. If you are a student who wants to know how to integrate the following system in your application, you're going to enjoy!

# Introduction

Authentication is a core building block for almost every modern application. Libraries and managed services (Firebase Auth, Auth0, Cognito) abstract many low-level concerns, but building an application-quality authentication layer remains a systems design problem: we must combine cryptographic primitives, network protocols, client-side storage semantics, and user experience considerations into a coherent, secure whole.

This post answers a central question: _How can we design and implement a secure, user-friendly authentication layer for a modern application using React and Firebase Auth, while maintaining principled reasoning about correctness, revocation, state management, and UI/UX?_ We show an architecture and code that balances the scalability of stateless tokens, the UX of automatic renewal, and the security of careful storage and validation semantics.

# Conceptual foundations

Before jumping into code, we need formal models and protocol primitives that will guide design choices.

## Formal primitives ans standards

- JSON Web Tokens (JWT, RFC 7519): compact, signed (and optionally encrypted) tokens representing claims. Conceptually a triple: `header.payload.signature`. Verification: check signature (public key) and claims (`iss`, `aud`, `exp`, `iat`, etc.). JWTs enable stateless verification: servers don't need to consult centralized state to validate authenticity, only public keys.
- OAuth2 / OpenID Connect (OIDC): high-level flows for delegated authorization and identity. OIDC gives us ID tokens (identity claims, often as JWTs) and access tokens; OAuth2 introduces refresh tokens for renewed access without re-prompting the user. Firebase Auth implements an OIDC-like flow (short-lived ID tokens + refresh tokens).
- Threat model: we assume adversaries may capture network messages, XSS in the client, compromised devices, or interceptor servers. We assume TLS for transport. Our design seeks to minimize sensitive token exposure and reduce attack windows (short token TTLs, revocation mechanisms).

If you want to know more about the above topic, check our privious post about how [Firebase Authentication works under the hood](https://gabrielh-blog.netlify.app/blog/firebase_authentication/).

## State models

Two models dominate session management:

- Stateless model (JWTs): servers can validate tokens locally; easy horizontal scaling; revocation is harder (requires revocation lists or token versioning).
- Stateful model (server sessions): server stores session records (DB or cache); immediate revocation possible; introduces a server-side lookup (latency + coordination).

Firebase's hybrid: short-lived, locally verifiable ID tokens (JWT) + long-lived refresh tokens (opaque, stored securely) used to mint new ID tokens from the Identity provider.

## Client-side state

Client-side state must model authentication state (e.g. current user) and UI state (loading, errors, route guards). Using a small deterministic state machine simplifies reasoning: states include, for example, `unauthenticated`, `authenticating`, `authenticated`, `signedOut`, etc.

# System architecture and internal mechanism

Below are the architecture and sequence diagram we will build towards:

- React (client): uses Firebase SDK to perform sign-in flows; uses Zustand for global auth state; uses Zod for validation of inputs (sign-in/up forms); uses Tailwind for UI.
- Firebase Authentication (identity provider): mints ID tokens and refresh tokens; issues signed JWTs with short TTLs and publishes public keys for verification.
- Backend (optional): REST/GraphQL API that verifies ID tokens (server-side) and optionally issues server-side session cookies for SSR or longer-lived sessions.

![Sequence_diagram](/images/posts/firebase_auth_react/sequence_diagram.jpeg)

This workflow is fairly easy to implement as well to setup everything. Keep in mind that the "problem" is to implement the state management. For this, Zustand plays an important part on the system. It keeps easy to track the user authentication flow.

Another concern you may ask, is security. Almost everything Firebase manages to us. But, if you want tweak the flow you have to analyse the trus boundaries and storage. On the client, the Id token should be stored in memory (never localStorage). Why? LocalStorage is vulnerable to XSS.

# Implementation

> Note: snippets are illustrative compact code, not full production apps. Error handling, env management, and deployment considerations should be added for production.

## 1. Example Layout

```
frontend/
  firebase.js
  useLogicForm.js
  authentication.js
  SignupPage.jsx
  Protected.jsx
  fetch.js
backend/
  server.js
docker-compose.yml
...
```

## 2. Firebase initialization

Firebase offers a simple way to connect your app with firebase authentication. Go to your project on firebase console and get your credentials. The goal of this post is to show the system. If you don't know how to get your credentials, I'd recommend whatching a video.

```js
// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

try {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
} catch (error) {
  console.error("Firebase initialization error:", error);
  throw error;
}

export { auth };
```

- Lines 1-2: import Firebase function - `initializeApp` creates a Firebase app, `getAuth` returns the Authentication instance.
- Lines 4-8: `firebaseConfig` object reads credentials from environment variables (Vite-style `import.meta.env`).
- Lines 10-13: `try` block initialized Firebase app and obtains the auth instance.
- Lines 14-17: catch logs initialization errors and rethrows them so failures surface during startup.
- Line 19: exports auth so other modules can import it.

## 3. Logic for form validation

```js
// useLogicForm.js
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

/**
 * Pre-configured schemas for common forms
 */
const schemas = {
  signup: z.object({
    username: z.string().min(3, "Username must be at least 3 characters"),
    email: z.email("Invalid email format").nonempty("Email is required"),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .max(20)
      .nonempty("Password is required"),
  }),

  login: z.object({
    email: z.email("Invalid email format").nonempty("Email is required"),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .nonempty("Password is required"),
  }),
};

/**
 * Generic form hook to handle form state and validation
 * @param {z.ZodObject} schema - Zod schema for form validation
 * @param {Object} defaultValues - Default values for the form fields
 * @param {Function} onSubmit - Callback function to handle form submission
 * @param {Object} formOptions - Additional options for useForm
 * @returns {Object} - Form methods and state
 */
function useLogicForm(schema, defaultValues = {}, onSubmit, formOptions = {}) {
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues,
    ...formOptions,
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  function wrappedOnSubmit(data) {
    if (onSubmit) onSubmit(data);
  }

  return { register, handleSubmit: handleSubmit(wrappedOnSubmit), errors };
}

/**
 * Pre-configured hook for commomn forms
 */
function useSignupForm(onSubmit) {
  return useLogicForm(
    schemas.signup,
    { username: "", email: "", password: "" },
    onSubmit,
  );
}

function useLoginForm(onSubmit) {
  return useLogicForm(schemas.login, { email: "", password: "" }, onSubmit);
}

export { useSignupForm, useLoginForm };
```

This snippet is a reusable form-handling utility built with React Hook Form and Zod. It defines validation schemas for signup, login and possible other validations. It wraps RHF with a helper `useLoginForm` that wires Zod validation (via `zodResolver`) and returns the usual from helpers. Finally, it exports two specific hooks: `useSignupForm` and `useLoginForm`, pre-configured with the right schema and default values. Keep in mind that is totally scalabe for other helpers.

The vantages of this is clearly: centralizes validation rules so you don't repeat them in every component. With this, the component code keeps small. Also, it ensures consistent validation messages and behaviour across the app.

I'm not a senior developer, but I made a test asking ChatGPT what are the improvements that it would made. Here's the answer: avoid re-creating the submit wrapper on every render: wrap `wrappedOnSubmit` in `useCallback`. Feel free to test this out.

## 4. Authentication store

```js
// authentication.js
import { create } from "zustand";
import { auth } from "@/lib/firebase";
import { to } from "@/lib/to";
import {
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
} from "firebase/auth";

const defaultStates = {
  user: null,
  isInitializing: true,
  isLoading: true,
  isAuthenticated: false,
  error: null,
};

/**
 * Zustand store for authentication state management
 */
const useAuthStore = create((set) => ({
  ...defaultStates,

  /**
   * Set user and auth state (used by listener)
   * @param {Object|null} user - Firebase user object or null
   */
  setUser: (user) =>
    set({
      user,
      isInitializing: false,
      isLoading: false,
      isAuthenticated: !!user,
      error: null,
    }),

  /**
   * Clear error message
   */
  clearError: () => set({ error: null }),

  /**
   * Sign out the current user
   * @returns {Promise<[Error|null, boolean|null]>} [error, success] tuple
   */
  signOut: async () => {
    set({ isLoading: true, error: null });
    const [error, _] = await to(firebaseSignOut(auth));

    if (error) {
      set({ isLoading: false, error: error.message || "Failed to sign out" });
      return [error, null];
    }
    setUser(null);
    return [null, true];
  },

  /**
   * Sign up with email and password (create user)
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} displayName - User display name
   * @returns {Promise<[Error|null, Object|null]>} [error, user] tuple
   */
  signUp: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    const [error, userCredential] = await to(
      createUserWithEmailAndPassword(auth, email, password),
    );

    if (error) {
      set({ isLoading: false, error: error.message || "Failed to sign up" });
      return [error, null];
    }

    // Update profile with display name if provided
    if (displayName && userCredential.user) {
      const [updateError, _] = await to(
        updateProfile(userCredential.user, { displayName }),
      );

      if (updateError) {
        set({
          isLoading: false,
          error: updateError.message || "Failed to update profile",
        });
        return [updateError, null];
      }
    }

    set({ isLoading: false });
    return [null, userCredential.user];
  },
}));

// Set up Firebase auth state listener (runs once on module load)
onAuthStateChanged(auth, (user) => {
  useAuthStore.getState().setUser(user);
});

export default useAuthStore;
```

This is a small authentication state manager built with Zustand that centralized user/auth state and actions (sign up, sign ou, and other possible actions). It integrates Firebase Auth to perform real auth operations and listens to Firebase's user changes to keep the stop in sync.

Key parts, simply:

- `defaultStates`: the initial shape of the store. Important flags relevant to the application in the authentication process.
- `create((set) => ({}))`: creates the Zustand store exposing state and actions:
  - `setUser(user)`: called when Firebase reposts the current user. It updates the store and flags.
  - `clearError()`: clear error messages.
  - `signOut()`: calls Firebase's signOut function via the small `to` helper (which returns `[error, result]`). If `signOut` fails to updates the error flag; if successful it returns [null, true].
  - `signUp(email, password, displayName)`: creates a user with Firebase, optionally updates their `displayName`, updates loading/error flags and returns the tuple.
- `onAuthStateChanged(auth, user)`: firebase listener set once at module load. Whenever Firebase's auth state changes, it updates the Zustand store by calling the `useAuthStore.getState().setUser(user)`.

It's useful because it's the central single source of truth for auth state. Any component can read the current user or call signOut/signUp without wiring callbacks through the tree. It also keeps UI reactive. Even better, using Firebase's listener ensures the store reflects the true auth state.

Zustand generally offers better performance compared to the React Context API, especiallly in larger applications or scenarios with frequent state updates. Also, for me, it's less confusing.

## 5. Signup form

```js
// SignupPage.jsx
import { useSignupForm } from "@/hooks/useLogicForm";
import useAuthStore from "@/store/auth.js";

function SignupPage() {
  const { signUp, isLoading, error } = useAuthStore();

  const { register, handleSubmit, erros } = useSignupForm(async (data) => {
    const [err, user] = await signUp(data.email, data.password, data.username);
    if (!err && user) {
      // do something
    }
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4">
      <input {...register("email")} placeholder="email" className="input" />
      <input
        {...register("password")}
        placeholder="password"
        type="password"
        className="input"
      />
      <button type="submit" className="btn btn-primary" disabled={isLoading}>
        {isLoading ? "Signing up..." : "Sign Up"}
      </button>
    </form>
  );
}

export default SignupPage;
```

This snippet defines a React component for the signup form. It uses two custom hooks (seen previously): `useSIgnupForm` and `useAuthStore`. When the form is submitted, it calls the `signUp` function with the entered email, password, and username. If signup is successful, you can add extra logic (like redirecting the user). The form disables the submit button and shows a loading message while the signup is in progress.

This component gives you a ready-to-use, validated signup form that connects directly to your authentication logic and shows loading feedback to the user. Feel free to modify it, adding animations, tailwind classes, shadcn components.

## 6. Component to protect the user

```js
// Protected.jsx
import useAuthStore from "@/store/useAuthStore";
import { Navigate } from "react-router-dom"; // used to change location

function Protected() {
  const { use, isLoading } = useAuthStore();

  if (isLoading) return <div>Loading...</div>;

  if (!user) return <Navigate to="/login" replace />;

  return children;
}
```

This React component protects routes that require authentication. It uses the Zustand auth manager to check if the user is logged in:

- If the authentication state is still loading, it shows a loading message (could easily be replaced to a spinner component).
- If there is no authenticated user, it redirects to the login page.
- If the user is authenticated, it renders the protected content `children`.

Notice the component has three return statement. This can be avoided. You can write it in one line using ternary operator. For me, the way it's being written makes it easier to visualize what is happening.

In short, wrap a page or any other component with the above component to protect contents.

## 7. Connecting with your backend

```js
// fetch.js
import { auth } from "@/lib/firebase";

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Get Firebase ID token of the currently authenticated user.
 */
async function getIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("No authenticated user found");

  return await user.getIdToken();
}

/**
 * Fetch wrapper to make authenticated API requests to the backend.
 * @param {string} endpoint - API endpoint (relative to API_URL)
 * @param {Object} options - Fetch options (method, headers, body, etc.)
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithAuth(endpoint, options = {}) {
  const idToken = await getIdToken();

  return fetch(`${API_URL}/${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...options.headers,
    },
  });
}

export { fetchWithAuth };
```

This helper provides a function for making authenticated request from the React app to the backend server.

- `getIdToken()` gets the current user's Firebase ID token (a JWT). This token proves the user is authenticated and can be verified by the backend.
- `fetchWithAuth(endpoint, options)` is a wrapper around the standard `fetch` function. It automatically attaches the user's ID token as a Bearer toekn in the `Authorization` header, so the backend can verify the request is from an authenticated user.

Whenever the frontend needs to talk with the backend (e.g. to fetch user data or save something), you want to make sure only authenticated users can do so. This helper ensures every request includes the user's ID token, so your backend can check if the request is allowed.

### Backend verification (Node/Express sketch)

```js
// server.js
import express from "express";
import admin from "firebase-admin";

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const app = express();

const verifyMiddleware = async (req, res, next) => {
  const header = req.header("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return res.status(401).end("Missing token");

  const idToken = match[1];
  try {
    // verifyIdToken validates signature, expiry, issuer, audience.
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).end("Invalid or revoked token");
  }
};
```

This is an express middleware function that protects backend API routes by verifying Firebase ID tokens:

- It checks the `Authorization` header for a Bearer token.
- If the token is missing, it responds with a 401 Unauthorized error.
- If a token is present, it uses Firebase Admin SDS's `verifyIdToken` to ckeck the tokens's validity (signature, expiry, issuer, etc).
- If the token is valid, it attaches the decoded user info to `req.user` and called `next()` to continue processing the request.
- If the token is invalid, it responds with a 401 error.

# Discussion

## Security vs UX trade-offs

- Short-lived ID tokens reduce the attack window for leaked JWTs. The Firebase client SDK automatically refreshes tokens using refresh tokens, improving UX. However, refresh tokens are long-lived and sensitive — they must be stored securely.
- Client storage: Storing tokens in JavaScript-accessible storage (localStorage) is convenient but vulnerable to XSS. The recommended approach is to keep tokens in memory and rely on server-issued HttpOnly cookies when possible for refresh tokens (but this introduces CSRF concerns and may require anti-CSRF measures).
- Revocation semantics: Stateless JWTs are efficient for verification but do not allow instant revocation without additional mechanisms (revocation lists, token versioning). Firebase offers mechanisms (revokeRefreshTokens) but full immediate revocation of already-issued JWTs requires server checks or short TTLs.

## Scalability and complexity

- Verification cost: cryptographic signature verification (RSA/ECDSA) is the main CPU cost per request for JWT verification. Caching/using session cookies shifts costs to a session store but enables instant revocation.
- JWKS rotation: servers must handle key rotation: retrieve JWKS, cache keys, and implement retry logic for unknown `kid` in JWT header.
- Concurrency model: For multi-tab SPA behavior, Firebase SDK and Zustand should coordinate: e.g., `onIdTokenChanged` events may fire per-tab, so choose a strategy for multi-tab single sign-on (shared workers or storage events). Race conditions can occur when two tabs refresh tokens simultaneously; Firebase SDK handles refresh orchestration internally for most platforms.

## Design alternatives and comparisons

- Opaque tokens + server introspection: every request uses an opaque token validated via introspection endpoint. This centralizes revocation and reduces token-exposure risk but adds a network hop. It’s a good fit for systems that need strict server control over sessions.
- Short-lived access tokens + rotating refresh tokens: rotating refresh tokens (refresh token present then rotated with each refresh) reduce replay risk for stolen refresh tokens. Firebase uses stable refresh tokens in many setups — design accordingly.
- Server-issued session cookies (stateful): if you need long-lived sessions with immediate revocation and strong server control, mint HttpOnly session cookies and maintain server session state. This adds storage/coordination overhead.

# Common misconceptions and edge cases

> `verifyIdToken` is optional. Client tokens are trusted

Never trust client-side tokens without server verification. Clients can be manipulated; always verify signature and claims on the server before sensitive operations.

> multi-tab sync

When the user signs out in one tab, other tabs must update their state. Use:

- Firebase SDK listeners (`onAuthStateChanged` / `onIdTokenChanged`) — these propagate across tabs if using browser storage controlled by Firebase SDK.
- Or use storage event listeners on window to sync custom state.

# Checklist/recommendations for future projects

1. Use Zod to validate all client inputs before forwarding to Firebase to avoid malformed requests and provide good UX early.
2. Keep ID tokens in memory (Zustand) and avoid persisting them to localStorage. Let the Firebase SDK manage refresh tokens where practical.
3. Prefer server-set HttpOnly cookies for refresh tokens if you have a backend that can set them securely (Secure, SameSite, HttpOnly).
4. Always verify tokens server-side with Admin SDK or manual JWT verification and include revocation checks when security requirements demand immediate logout.
5. Handle JWKS rotation and cache public keys; implement retry logic on unknown `kid`.
6. Treat authentication state as a deterministic state machine (unauthenticated -> authenticating -> authenticated -> refreshing -> signedOut) to make code reasoning and proofs about behavior easier.
7. Design multi-tab synchronization using Firebase SDK listeners or explicit storage events.
8. Plan for token compromise: implement monitoring, IP heuristics, refresh token revocation API use, and short TTLs for critical sessions.

# Conclusion

This architecture demonstrates a balanced approach: Firebase Auth provides scalable, well-tested identity primitives; React + Zustand provides predictable client state management. Important trade-offs remain: stateless verification scales well but complicates revocation; token storage choices trade between XSS and CSRF risks.

## Project Repository

This article is accompanied by an open-source implementation that demonstrates the architectural model discussed in the text. Check it out [here](https://github.com/gabrielh-muniz/barber-saas).

See you in the next post!
