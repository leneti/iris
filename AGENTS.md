# Agent guide

Iris is a Next 16 + TypeScript dashboard, shipped as a Docker image. Read `README.md` for what it does and `docs/contract.md` for the contract.

## Public repository: data rules

This repository is public. Never commit:

- real host names or domains (use `example.invalid` or `example.com`);
- IP addresses other than `127.0.0.1`, `0.0.0.0`, `::` and documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`);
- coordinates, keys, tokens, passwords, `.env` values or crontab lines;
- user names or local absolute paths.

Fixtures, examples and tests use invented placeholder names. Only `dev/.env.fixtures` (placeholders) is a committed env file. Run `scripts/privacy-scan.sh` and check `git diff --staged` before committing. If a secret leaks, rotate it first, then clean the history.

Local agent ledgers live in `.llms/` and `.superpowers/`, both untracked; never add them.

## Command environment

Every Node command goes through `scripts/dev.sh`, which selects the Node version from `.nvmrc`, sets `TMPDIR` to `.tmp/` in the repo and keeps the Yarn cache in the repo. Nothing should write outside the repository.

```sh
scripts/dev.sh yarn dev:fixtures
scripts/dev.sh yarn vitest run tests/server/some.test.ts   # focused test
scripts/dev.sh yarn test
scripts/dev.sh yarn verify   # lint, fmt:check, typecheck, test, build; must pass before a commit
```

Dependencies are exact-pinned and must be at least 14 days old. Server modules import `server-only`; route handlers are GET only with `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`. Iris is not served from a secure context: do not use `crypto.randomUUID`, `crypto.subtle`, `navigator.clipboard` or service workers.

## Contract versioning

The label schema, the two config files, the environment variables and the endpoint shapes are a versioned contract (`docs/contract.md`, schemas in `lib/shared/contract.ts`).

- Adding an optional label, key, variable or response field is backward compatible: keep the contract version and add a row or note saying which Iris version introduced it.
  The schemas are strict, so the server's tests catch undeclared fields, but the browser parses with `parseTolerant`, which drops unknown keys: a page that is already open keeps working after a deploy that adds a field.
- Removing or renaming anything, changing a meaning or default, or making something required is a breaking change: raise the contract version and say so in the table in `docs/contract.md`.
- A change that crosses this repository and a deployment's Compose files is two commits: Iris first, released and deployed, then the Compose change.
