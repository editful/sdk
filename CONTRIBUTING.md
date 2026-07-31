# Contributing

Install Node.js 26 and pnpm 11, then run:

```bash
pnpm install
pnpm check
```

Changes to a published package need a Changesets entry:

```bash
pnpm changeset
```

Keep the repository independent from the Editful application source. Do not
add private package imports, application-relative paths, internal service
endpoints, or copied application implementation. Extend the public SDK contract
here first; the desktop host can consume a published version separately.
