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

Needs **Node.js 24+** (`node -v`). Docker Desktop is needed from issue #2 onwards.

```bash
npm install          # installs every workspace
npm run check        # format check + lint + typecheck
```

A beginner-friendly walkthrough lives in [quick_start.txt](quick_start.txt).

## Status

| Milestone                   | Issues  | State          |
| --------------------------- | ------- | -------------- |
| M0 Foundation               | #1–#6   | 🚧 in progress |
| M1 Identity                 | #7–#9   | ⏳             |
| M2 Student ordering         | #10–#17 | ⏳             |
| M3 Stall console            | #18–#22 | ⏳             |
| M4 Super admin              | #23–#27 | ⏳             |
| M5 Deployment & launch, AWS | #28–#30 | ⏳             |
