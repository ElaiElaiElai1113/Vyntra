# Vyntra MVP

Vyntra — From Idea to Automation.

## Stack
- Frontend: React + Vite + TypeScript + Tailwind + React Flow + Zustand + Zod
- Backend: Supabase (Auth, Postgres, Edge Functions)
- AI generation: Supabase Edge Function `generate-workflow` (OpenAI)

## Local Run
1. Install deps:
   - `npm install`
2. Frontend env (`apps/web/.env`):
   - `VITE_SUPABASE_URL=http://127.0.0.1:54321`
   - `VITE_SUPABASE_ANON_KEY=<anon-key>`
3. Start Supabase local stack:
   - `supabase start`
4. Apply migration:
   - `supabase db reset`
5. Set function secrets:
   - `supabase secrets set OPENAI_API_KEY=... OPENAI_MODEL=gpt-4.1-mini`
   - optional: `supabase secrets set GENERATE_WORKFLOW_MONTHLY_LIMIT=250`
   - optional: `supabase secrets set RUN_WORKFLOW_MONTHLY_LIMIT=500`
   - optional: `supabase secrets set RUN_MODE=live`
   - optional: `supabase secrets set OPENAI_BASE_URL=...`
6. Serve edge function locally:
   - `supabase functions serve generate-workflow --import-map supabase/functions/import_map.json`
7. Run frontend:
   - `npm run dev`
8. Run smoke tests:
   - `npm test`
9. Run live integration smoke (requires a real test user account):
   - env:
     - `SUPABASE_URL=...`
     - `SUPABASE_ANON_KEY=...`
     - `SMOKE_TEST_EMAIL=...`
     - `SMOKE_TEST_PASSWORD=...`
   - command: `npm run smoke:live`

## Key Paths
- Shared schema: `shared/schema/workflow.ts`
- SQL migration: `supabase/migrations/202602200001_init_vyntra_mvp.sql`
- Edge function: `supabase/functions/generate-workflow/index.ts`
- App: `apps/web/src`
