---
name: safe-data-repair
description: Diagnose, preview, approve, execute, and verify a narrowly scoped Estio data repair. Use for cleanup, backfill, deduplication, merge, reconciliation, identity correction, or repair scripts that may change database records or production state.
---

# Safe Estio Data Repair

Protect customer and operational data by separating diagnosis from mutation. Gather evidence first and use the narrowest reversible repair that restores explicit invariants.

## Diagnose read-only

1. Identify the intended environment, database, tenant or location, record types, and symptom. Never infer production from an environment filename or shell history.
2. Find candidate scripts with `rg --files scripts` and inspect the complete selected script before running it.
3. Treat a script as mutating unless its code proves otherwise. Flags and filenames are not safety guarantees. Several legacy cleanup scripts mutate by default and use `--dry-run` only when supplied.
4. Prefer an existing dry-run or read-only query. If none exists, add a safe preview mode or perform a separate narrow query before considering execution.
5. Determine exact affected identifiers, counts, relationships, and invariants. Avoid broad filters such as every tenant, every user, or all historical rows unless that exact scope is requested and justified.

Do not expose secrets or place customer data, tokens, database URLs, or production snapshots in Git. Store temporary evidence outside the repository and report only the minimum necessary identifiers and counts.

## Prepare recovery and approval

Before mutation:

- record the pre-change state needed to verify or reverse the repair;
- identify whether the operation is transactional and what may be irreversible;
- use an existing verified backup/export workflow when the affected data warrants it;
- show the exact target environment, tenant/location, record IDs or predicate, expected counts, command, and post-change invariants;
- explain the recovery path and any gap in reversibility.

Obtain explicit approval for the exact material mutation. Approval for diagnosis or a dry-run does not authorize apply mode. A changed predicate, environment, record count, or command invalidates the prior approval.

## Execute narrowly

Run the narrowest applicable repair once. Prefer scripts that default to dry-run and require an explicit `--apply`. When a legacy script mutates unless `--dry-run` is passed, never omit that distinction from the approval summary.

Stop on unexpected counts, identity mismatches, constraint failures, or output that shows a broader scope than approved. Do not chain additional cleanup, retries, or follow-on repairs without new evidence and authorization.

## Verify

After execution:

1. Rerun the read-only diagnostic using the same scope.
2. Verify the repaired invariant and related counts, ownership, references, uniqueness, and audit/history records as applicable.
3. Check that unrelated records and tenants were not changed using the pre-change evidence.
4. Run the smallest relevant application or integration smoke test.
5. Report exact changed counts and identifiers, verification results, recovery information, and remaining uncertainty without exposing sensitive values.

If verification fails, do not improvise a second mutation. Preserve evidence, state whether the approved repair can be reversed, and ask for direction.
