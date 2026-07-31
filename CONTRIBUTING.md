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

Keep published packages limited to the documented SDK contract. Do not add
undeclared internal package imports, internal service endpoints, or symlinks.
