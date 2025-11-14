---
title: "Feature-First Architecture for Node.js projects"
description: "This post argues that a feature-first layout better aligns with cognitive models, reduces coupling, and improves envolvability in medium-to-large Node.js codebases."
date: 2025-11-13
tags: ["node.js", "architecture", "javascript", "feature-first"]
image: "/images/posts/feature_first_architecture/feature_first_showcase.png"
---

Feature-first architecture organizes code by feature or domain capability (e.g., `payments`, `users`, `chat`) instead of technical concerns (e.g., `controllers`, `routes`, `services`) at the project root. This post argues that a feature-first layout better aligns with cognitive models, reduces coupling, and improves evolvability in medium-to-large Node.js codebases. We connect software-engineering theory (modularity, information hiding) to concrete Node.js/TypeScript patterns, show internal mechanisms with diagrams and code, analyze complexity and trade-offs (including circular dependencies, cross-feature transactions, build and test impacts), and provide a pragmatic migration checklist for real-world systems.

# Introduction

Historically, many Node.js projects adopt a _technical-concern-first_ layout: top-level folders named `controllers`, `routes`, `services`, and models. This was sensible during early, small-scale applications because it separated responsibilities and made it easy to find similar artifacts. However, as systems grow, this structure often amplifies accidental complexity: locating all code for a particular feature becomes scattered across the repository, refactors touch many files in many directories, and teams working on vertical features must negotiate across horizontal boundaries.

The central question we examine is: Can organizing Node.js projects by feature (feature-first) produce measurably better modularity, reduced coupling, and faster cognitive load for developers—without sacrificing performance, testability, or runtime characteristics? We'll explore why the answer is frequently "yes" and exactly when and how trade-offs enter the picture.

Relevance: For system architects, maintainers and researchers, the architectural decision affects onboarding time, fault isolation, CI runtimes, and the ability to evolve the system safely. We’ll bridge formal principles to engineering practices and provide reproducible patterns for Node/TS ecosystems.

# Conceptual Foundations

Feature-first architecture rests on several well-established theoretical principles:

- **Modularity & Information Hiding:** modules should hide design decisions likely to change. Grouping by feature co-locates changing code, minimizing ripple changes.
- **Cohesion & Coupling:** high cohesion - a module’s elements serve a common purpose. Low coupling - modules depend minimally on one another. Feature folders aim to increase cohesion and reduce cross-cutting dependencies.
- **Separation of Concerns vs. Vertical Decomposition:** Traditional separation of concerns decomposes by technical concern (horizontal). Vertical decomposition (feature-first) slices by functionality, trading some horizontal standardization for clearer feature boundaries.
- **Conway’s Law:** Team structure shapes software architecture. If teams are organized by feature, aligning code layout to team boundaries reduces organizational impedance.
- **Graph Theory applied to Dependencies:** The project's dependency graph (nodes = modules, edges = imports) should be sparse and ideally hierarchical (DAG). Feature-first encourages a layered DAG where features depend on shared infra, not on other features, minimizing cycles.
- **Component and Interface Theory:** Treat each feature as a component exposing a small public API (e.g., `init`, `routes`, `events`), reminiscent of software components in distributed systems.

# System Architecture & Internal Mechanism

## High-Level architecture

A typical feature-first Node.js application decomposes into three vertical layers:

1. Features (domain modules): contain all the code required for a domain capability (HTTP handlers, domain services, DB models, events).
2. Shared Infrastructure: logging, database clients, authentication middleware, shared utilities.
3. Composition / Bootstrapping: top-level code that composes features, wires routes, and starts the server.

Example:

```bash
/src
  /features
    /users
      index.ts
      routes.ts
      controller.ts
      service.ts
      repository.ts
      dto.ts
      tests/
    /payments
      index.ts
      routes.ts
      ...
  /shared
    db.ts
    logger.ts
    auth.ts
    utils.ts
  /config
    index.ts
  server.ts
  app.ts
```

Or you can even structure the feature in another directories, usually called: `domain`, `data`, `interface/application`, `presentation`. In the example above we can structure the following:

```bash
/src
  /features
    /users
      index.ts
      /data
        repo.ts    # methods implementation
      /domain
        /entities
          user.ts  # user model
        /repo
          IUser.ts # contract/signature methods
      /interface
        routes.ts
        controller.ts
      /test
      ...
```

- `server.ts` imports features/\*/index.ts.
- Each feature `index.ts` exports a small composition: `register(app, deps)`. Or the most commom an Express `Router`.
- The top-level composes feature routers and shared middleware.

## Interactions between components

- Feature to Shared: features depend on shared infra (DB, logger). This is acceptable; directionality must be controlled to avoid feature-to-feature dependencies.
- Feature to Feature: ideally avoided. If needed, use well-defined interfaces or events (domain events, message bus) to decouple.
- Bootstrapping: orchestrates initialization order (db connection -> shared middleware -> features -> start server).

## Runtime characteristics and patterns

- Lazy-loading features: for very large apps, features can be dynamically imported to reduce cold-start time (e.g., serverless). This requires features to be self-contained and registered lazily.
- Transactions across features: if a workflow spans multiple features, use orchestration patterns: saga, orchestration service, or distributed transactions (rarely recommended).
- Event-driven integration: using domain events or message broker decouples services and preserves feature independence.

# Code perspective

Below are practical Node/Typescript patterns that map the theory to code.

## Minimal feature barrel pattern

- `src/features/users/index.ts` - exposes the features's router and an optical init function.

```ts
import { Router } from "express";
import { createUserController } from "./controller";
import { userService } from "./service";

export function registerUserFeature(
  appRouter: Router,
  deps: { db: any; logger: any },
) {
  const router = Router();
  const controller = createUserController(userService(deps));

  router.post("/", controller.createUser);
  router.get("/:id", controller.getUser);

  appRouter.use("/users", router);
}
```

Or export router directly:

```ts
export const usersRouter = (() => {
  const router = Router();
  // ... mount handlers
  return router;
})();
```

- `src/app.ts` - top-level composition:

```ts
import express from "express";
import { registerUserFeature } from "./features/users";
import { registerPaymentsFeature } from "./features/payments";
import { db } from "./shared/db";
import { logger } from "./shared/logger";

const app = express();
const apiRouter = express.Router();

registerUserFeature(apiRouter, { db, logger });
registerPaymentsFeature(apiRouter, { db, logger });

app.use("/api", apiRouter);

export default app;
```

## Service and repository co-location

- `src/features/users/service.ts`

```ts
export function userService({ db, logger }: { db: any; logger: any }) {
  const repo = userRepository(db);

  return {
    async createUser(dto) {
      // domain validation, business rules
      logger.info("Creating user", dto.email);
      const user = await repo.insert(dto);
      // emit domain event perhaps
      return user;
    },
    async getUser(id) {
      return repo.findById(id);
    },
  };
}
```

## Re-usable shared infra

- `src/shared/db.ts`

```ts
import { Pool } from "pg";

export const db = new Pool({
  /* config */
});

export async function transaction<T>(fn: (client: any) => Promise<T>) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await fn(client);
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

Features can import `transaction` to implement cross-aggregate consistency - but careful: calling `transaction` across features should be via orchestration layer rather than direct feature-to-feature calls.

## Barrel files & index exports

As you already know by now, barrel files are index files (e.g., `index.js` or `index.ts`) in a directory that re-export modules from another files within that same directory, acting as a single entry point for imports. They simplify the import process by allowing developers to import multiple related components, functions, or utilities with a single statement, rather then needgin multiple, longer import paths. This hides the internal folder structure and provides a cleaner public interface for a module, package, or feature. Thus, barrel files in feature folders provide a single public API for the feature, allowing top-level code to depend only on that barrel.

```ts
// src/features/users/index.ts (barrel)
export * from "./routes";
export * from "./service";
export * from "./types";
```

# Analytical Discussion

## Strengths

1. Reduced cognitive load per change: developers modifying a feature typically touch files within a single folder. This reduce search time and reduces the blast radius of edits
2. Improved module cohesion: co-locating related concerns (controller + service + model) increases semantic cohesion, making reasoning about behavior easier.
3. Easier refactor and extraction: a feature folder can be extracted into a sub-repo, microservice, or package with minimal surgery.
4. Better alignment with team structure: teams focused on vertical slices can own specific directories, decreasing cross-team friction.
5. Tests co-located with code: feature tests (unit/integration) live next to code, improving maintainability.

## Limitations

1. Risk of duplicate technical code: if developers aren't disciplined, same utility logic might be duplicated across features.
   - Countermeasure: strong shared infra and linting rules.
2. Cross-feature coupling temptation
   - Features might import from other features directly, causing cycles. Enforce policy: _features may only import shared infra or well-defined feature interface_
3. Build and bundling concers: with monolithic builds, a change in a shared file may trigger full rebuilds. However, feature-first assists incremental builds if using per-feature build outputs.
4. Navigational friction for purely technical tasks: when you need to find all controllers or DTOs across features, you must search across many folders rather then open `controllers/`. Use code search tools or IDE workspace features.

## Scalability

- Dependency graph complexity: if features depend only on shared infra, the graph becomes star-shaped (linear in number of features `O(F)` edges to shared). If features depend on each other, potential for `O(F^2)` edges and cycles increases.
- Time complexity of refactor operations: refactor to move a feature to a microservice often becomes `O(1)` per feature folder (local changes), compared to `O(N)` when code scattered across concerns.
- Build/test complexity: with per-feature tests and CI, parallelication is possible. Time-to-test can be reduced by running only tests for modifed features (required mapping changed files to features).
- Security implications: co-location doesn't intrinsically change security posture, but boundaries are clearer for access control enforcement (e.g., middleware in feature index). However, careless export of internal APIs can leak sensitive internals - enforce exports via barrel/`register` contract.

## Example: Dealing with a Cross-Feature workflow

Suppose `orders` creation requires charging a `payments` provider and updating `inventory`.

A simple saga via events:

1. orders feature emits OrderCreated event.
2. payments features listens and attempts ChargeUser.
3. inventory decrements stock on PaymentConfirmed.
4. Any failure triggers compensating actions.

This preserves feature independence: features subscribe to domain events rather than invoking each other’s services directly. Implementation options: in-process event bus (for monolith), or message broker (for distributed systems). Use idempotency, retries, and deduplication to ensure correctness.

# Misconceptions or edge cases

> Feature-first means no shared code

False. Shared infrastructure (DB clients, logging, etc.) should remain centralized. The rule is dependency direction: features -> shared, not shared -> features.

> Feature-first prevents cross-cutting concerns

Cross-cutting concerns (logging, metrics) still exist but are applied via shared middleware or decorators. Don’t replicate logging logic per feature.

> Feature-first is only for microservices

Not true. It’s highly effective in monoliths because it makes eventual extraction to microservices easier

> You’ll end up with too many files to manage

True if features are too granular. Choose feature granularity to reflect bounded contexts; grouping very small features into a larger domain may be better.

> Circular dependencies are magically solved

No. Circular imports still happen. Practice: rely on explicit interfaces (ports) and inversion-of-control to break cycles.

# Migration

If you have an existing `controllers/`, `services/`, etc. layout, migrate incrementally:

1. Choose feature boundaries: use bounded contexts (domain-driven design) as guides. Do not over-split.
2. Create feature folders and move code: move a small, self-contained feature first. Keep the old files until the new structure passes tests.
3. Introduce explicit feature registration: each feature exposes register(app, deps) so the top-level composition is explicit.
4. Refactor shared utilities: move duplicated utilities to shared/; ensure types and contracts are stable.
5. Enforce dependency rules: add ESLint rules (e.g., no-restricted-imports) or TypeScript path aliases to prevent feature-to-feature imports unless via explicit interfaces.
6. Adjust CI: update test selection and build scripts to support per-feature runs where feasible.
7. Run integration tests: verify that API composition and middleware order remain correct.
8. Observe and iterate: measure developer productivity metrics (PR size, churn) and adjust feature granularity.

# Conclusion

Feature-first architecture for Node.js projects re-aligns code structure to domain boundaries, improving cohesion, enabling faster feature-focused work, and simplifying extraction to services. The approach is grounded in core software engineering principles (information hiding, cohesion/coupling, Conway’s law). Practically, it encourages a composition style in which top-level bootstrap code wires small, well-documented feature modules to shared infrastructure.

Adopting feature-first requires discipline: preventing feature-to-feature coupling, maintaining shared infra, and handling cross-feature transactions via event-driven or orchestrated patterns. When applied judiciously (especially in mid-to-large teams or systems expected to evolve) feature-first commonly reduces long-term maintenance cost and improves developer productivity.
