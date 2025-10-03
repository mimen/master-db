# Repository Guidelines

## Project Structure & Module Organization
- Frontend lives in `app/` (Vite + React). UI components under `app/src/components`, shared logic in `app/src/lib`, Convex client types in `app/src/types/convex/`.
- Convex backend functions reside in `convex/`, grouped by service (e.g., `convex/todoist/queries.ts`). Generated artifacts live in `convex/_generated/`.
- Tests mirror their targets: Convex code uses `.test.ts` files beside functions; frontend tests reside in the React tree when present.

## Build, Test, and Development Commands
- `bun run dev`: start Convex dev server (requires local Convex configured).
- `bun run typecheck`: runs frontend (`bun --cwd app tsc --noEmit`) and Convex (`bunx convex typecheck`) type checks.
- `bun run lint`: ESLint over both frontend and backend sources.
- `bun test` / `bun run test:watch`: Vitest test suite.
- Frontend dev server (if needed) via `bun --cwd app dev` (Vite default).

## Coding Style & Naming Conventions
- TypeScript everywhere, strict mode enforced (`noImplicitAny`, etc.). Avoid `any`.
- Use Convex-generated types (`@/convex/_generated/*`) or shared aliases (`@/types/convex/*`) instead of manual interfaces.
- Prefer named exports; group public API via barrel files (`convex/todoist/publicQueries.ts`).
- Run `bun run lint` to enforce formatting and import order.

## Testing Guidelines
- Convex tests use `convex-test`; place alongside implementation (`foo.ts` → `foo.test.ts`).
- Frontend testing uses Vitest; follow component-based test placement.
- Validate before commits: `bun run typecheck && bun run lint && bun test`.

## Commit & Pull Request Guidelines
- Commit messages follow conventional short summary style (imperative verb). Group related changes; avoid large mixed commits.
- PRs should describe scope, link relevant issues, and note validation commands run. Include screenshots or logs for UI-affecting changes.

## Agent-Specific Tips
- Use shared type aliases in `app/src/types/convex/` when consuming Convex data.
- Restart Convex dev server (`bunx convex dev --once`) after adding new exported functions to ensure generated types refresh.
