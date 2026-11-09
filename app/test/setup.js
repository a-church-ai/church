/**
 * Loaded before every test file (package.json "test", --require): the tests'
 * database is the local one (`supabase start` at the repository root), always,
 * whatever app/.env or the shell says, so no test can reach production's.
 * These are the local stack's fixed development values, valid nowhere else.
 */

process.env.SUPABASE_URL = 'http://127.0.0.1:56121';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
