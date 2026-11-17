# MOM — campus food-stall pre-ordering

Students around VSSUT pick a food stall, browse its menu, pay by **UPI** or **cash**, get a
**token + QR code**, and collect their food at the counter. Stall owners run orders, menus and a
pickup scanner from their console. The MOM team runs everything from the super-admin console.

- 📄 **Product & engineering spec:** [spec.md](spec.md)
- ✅ **Backlog:** [30 issues in 6 milestones](https://github.com/subhankar2004/MOM/milestones), built one by one
- 🗄️ **Old prototype** (Supabase + Expo): git tag [`prototype-v0`](https://github.com/subhankar2004/MOM/tree/prototype-v0)

## Repository layout

```
MOM/
├── apps/
│   ├── api/        Fastify + TypeScript REST/SSE API              (issue #5)
│   └── web/        Next.js web app: student · vendor · admin      (issue #6)
├── packages/
│   └── shared/     Code shared by api + web: money/fee maths, types (issue #4)
├── spec.md         What we are building and how
└── CONTRIBUTING.md How we work: issue → branch → PR → merge
```

`infra/` (AWS CDK) is added in issue #28.

## Getting started

Needs **Node.js 24+** (`node -v`) and **Docker Desktop** (running).

```bash
npm install          # installs every workspace
npm run setup        # creates apps/api/.env and apps/web/.env.local from the examples
npm run db:up        # starts Postgres 17 + S3-compatible storage in Docker
npm run env:check    # validates the API settings
npm run dev          # API on :4000 + web on :3000 (from issues #5 and #6)
npm run check        # format check + lint + typecheck + unit tests
npm run test:int     # integration tests against the mom_test database
```

### Local services (`docker-compose.yml`)

| Service    | Image                      | Address                                      | Data volume   |
| ---------- | -------------------------- | -------------------------------------------- | ------------- |
| PostgreSQL | `postgres:17.12-alpine`    | `localhost:5432` (dbs `mom`, `mom_test`)     | `mom_pg_data` |
| S3 storage | `chrislusf/seaweedfs:4.54` | `http://localhost:8333`, bucket `mom-images` | `mom_s3_data` |

Both listen on `127.0.0.1` only. MinIO, the usual choice, no longer publishes Docker
images, so local S3 uses [SeaweedFS](https://github.com/seaweedfs/seaweedfs). On AWS it is replaced by real S3 + CloudFront (#28).
Database commands: `db:down` (stop, data kept), `db:reset` (⚠ wipe, migrate and seed demo data),
`db:migrate`, `db:seed`, `db:psql`, `db:logs`.

### Database schema

Defined with Drizzle in [`apps/api/src/db/schema/`](apps/api/src/db/schema) (spec §8); SQL migrations live in
[`apps/api/drizzle/`](apps/api/drizzle). To change the schema: edit the schema files → `npm run db:generate -w @mom/api`
→ review the new SQL → `npm run db:migrate` → commit both. CI fails if the two are out of sync.
`npm run db:studio -w @mom/api` opens a browser view of the data.

A beginner-friendly walkthrough lives in [quick_start.txt](quick_start.txt).

## Continuous integration

Every PR and every push to `main` runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job                                 | What it runs                                                 |
| ----------------------------------- | ------------------------------------------------------------ |
| Lint, typecheck, unit tests & build | `format:check` → `lint` → `typecheck` → `npm test` → `build` |
| Integration tests (Postgres)        | `npm run test:int` against a `postgres:17.12-alpine` service |
| End-to-end tests (Playwright)       | skipped until #11                                            |

Both active jobs are **required** to merge into `main`. Dependabot opens grouped weekly
update PRs for npm packages, GitHub Actions and the Docker images.

## Status

| Milestone                   | Issues  | State          |
| --------------------------- | ------- | -------------- |
| M0 Foundation               | #1–#6   | 🚧 in progress |
| M1 Identity                 | #7–#9   | ⏳             |
| M2 Student ordering         | #10–#17 | ⏳             |
| M3 Stall console            | #18–#22 | ⏳             |
| M4 Super admin              | #23–#27 | ⏳             |
| M5 Deployment & launch, AWS | #28–#30 | ⏳             |
