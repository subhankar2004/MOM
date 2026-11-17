# How we work

We build MOM **one GitHub issue at a time**. Every change goes through a pull request (PR).
Nobody pushes straight to `main`.

## The loop

```bash
# 1. Start from an up-to-date main
git switch main
git pull

# 2. Create a branch named after the issue: <issue-number>-<short-name>
git switch -c 4-database-schema

# 3. Write code + tests, then check everything locally
npm run check          # format check + lint + typecheck + unit tests
npm run test:int       # integration tests (needs `npm run db:up`)

# 4. Commit and push
git add -A
git commit -m "feat(db): add schema v1 (#4)"
git push -u origin 4-database-schema

# 5. Open a PR that closes the issue
gh pr create --fill --body "Closes #4"
```

6. **CI must be green.** GitHub runs the `CI` workflow on every PR; `main` only accepts
   PRs whose checks pass. Then review the PR and test it locally.
7. **Squash merge** in GitHub. The issue closes automatically.
8. `git switch main && git pull`, then take the next issue.

## Conventions

- **Commits / PR titles:** [Conventional Commits](https://www.conventionalcommits.org) such as
  `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`, with a scope where it helps
  (`feat(api): …`), and the issue number at the end (`(#12)`).
- **Branches:** `<issue>-<kebab-name>`, e.g. `15-razorpay-upi`.
- **Money** is always an integer number of **paise**. Never use floats for rupees.
- **Secrets** never go into git. Only `.env.example` files are committed.
- **Formatting** is Prettier's job. Run `npm run format` before committing.

## Definition of Done (every issue)

- [ ] All acceptance criteria in the issue are met
- [ ] Tests added or updated (from #3 onwards)
- [ ] `npm run check` passes and CI is green
- [ ] Docs and `quick_start.txt` are updated if a workflow changed
- [ ] Works in the local stack (and on staging from #28 onwards)
