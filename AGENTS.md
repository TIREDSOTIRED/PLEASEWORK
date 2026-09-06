# AGENTS.md

Eshmun — pharmacy POS/inventory platform. React 19 + TS + Vite + Tailwind v4, Firebase Auth/Firestore, Supabase catalog, offline-first (IndexedDB).

Full architecture and flows are in `README.md` — read that instead of re-exploring the codebase. Project memory/roadmap: `PROJECT_STATE.md`.

## Token-saving rules (follow strictly)

- NEVER read these files (huge, useless as text): `public/master_catalog.db` (7MB sqlite), `public/catalog.json` (2MB), `package-lock.json`, `bun.lock`, anything in `dist/`, `*.csv`.
- Do not open `src/components/B2BMarketplaceTab.tsx` (106KB) wholesale — grep for the symbol first, then read only the matching line ranges.
- Prefer Grep/Glob over directory listings. Read files with offset/limit slices, never whole large files.
- Verify changes with `npm run lint` (tsc --noEmit) and `npm test` (vitest). Do not run `npm run build` unless asked.
- When asked "why/how" questions about the codebase, answer from README.md + targeted greps; do not dump file contents back to the user.
- Keep edits minimal and scoped; do not reformat unrelated code.
- Whenever a task writes a report under `.gstack/qa-reports/`, immediately open it with `Start-Process <path>` — the user reads reports in their default viewer; do not wait to be asked.

## Layout

- `src/domain/` pure logic (FEFOStockAllocator, DrugBatch) — `src/infrastructure/` IndexedDB, sync engine
- `src/services/` Supabase catalog sync + local search — `src/components/` feature UI
- `src/presentation/RootNavigator` role-aware routing — `src/application/` AuthContext/hooks
- Firestore rules: `firestore.rules`; deploy checklist: `FIRESTORE_RULES_DEPLOYMENT.md`

## graphify

This project has a graphify knowledge graph at .graphify/.

Rules:
- For codebase or architecture questions, when `.graphify/graph.json` exists, first run `graphify query "<question>"` (or `graphify path "<A>" "<B>"` / `graphify explain "<concept>"`); these return a scoped subgraph, usually much smaller than `GRAPH_REPORT.md` or raw grep output
- If .graphify/wiki/index.md exists, navigate it instead of reading raw files
- If .graphify/graph.json is missing but graphify-out/graph.json exists, run `graphify migrate-state --dry-run` first; if tracked legacy artifacts are reported, ask before using the recommended `git mv -f graphify-out .graphify` and commit message
- If .graphify/needs_update exists or .graphify/branch.json has stale=true, warn before relying on semantic results and run the graphify skill with --update when appropriate
- If the user asks to build, update, query, path, or explain the graph, use the installed `graphify` skill instead of ad-hoc file traversal
- Before proposing or committing .graphify artifacts, run `graphify portable-check .graphify`; commit-safe graph artifacts must use repo-relative paths, and never commit .graphify/branch.json, .graphify/worktree.json, .graphify/needs_update, or .graphify/cache/. If a repo already tracks any of them, first add them to .gitignore, then propose `git rm --cached .graphify/branch.json .graphify/worktree.json .graphify/needs_update` and `git rm -r --cached .graphify/cache`; never mutate git state without asking
- Before deep graph traversal, prefer `graphify summary --graph .graphify/graph.json` for compact first-hop orientation
- For review impact on changed files, use `graphify review-delta --graph .graphify/graph.json` instead of generic traversal
- Read `.graphify/GRAPH_REPORT.md` only for broad architecture review or when `query` / `path` / `explain` do not surface enough context
- After modifying code files in this session, run `npx graphify hook-rebuild` to keep the graph current
