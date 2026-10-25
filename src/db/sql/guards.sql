-- Database guards for RuleForge AI.
--
-- Applied with `npm run db:guards` after `npm run db:push`. Re-running is safe.
--
-- `audit_log` is append-only: the compliance trail is worthless if a row can be
-- edited after the fact. Application code cannot be trusted to respect that on
-- its own, so the database refuses the operation outright.
--
-- This is a guard against mistakes, not a security boundary: the table owner
-- can still drop the trigger. Pair it with a restricted application role.

CREATE OR REPLACE FUNCTION audit_log_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Insert a compensating audit_log entry instead.';
END;
$$;

-- Statement-level, so an UPDATE or DELETE is rejected even when it would match
-- no rows — the intent is what is being refused.
DROP TRIGGER IF EXISTS audit_log_no_update_or_delete ON audit_log;
CREATE TRIGGER audit_log_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();

-- TRUNCATE bypasses the trigger above, so it needs its own.
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();

-- `user.role` is a plain text column, because Better Auth's generator emits
-- `text` for `additionalFields` and the generated file is overwritten by
-- `npm run auth:generate`. Enforce the allowed values here instead, so a
-- stray UPDATE cannot invent a role the application does not understand.
--
-- NULL stays legal: the column is nullable and defaults to 'officer'.
ALTER TABLE "user" DROP CONSTRAINT IF EXISTS user_role_allowed;
ALTER TABLE "user" ADD CONSTRAINT user_role_allowed
  CHECK (role IS NULL OR role IN ('officer', 'head', 'ops', 'auditor'));
