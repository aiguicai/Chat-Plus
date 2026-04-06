# Contributing

## Development setup

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

## Before opening a pull request

Run the checks that match your change:

```bash
npm test
npm run build
```

If you touched adapter behavior, include the target site and a reproducible request/response example in the pull request description.

## Versioning and releases

- Project versions come from `version.json`.
- Use `npm run version:set -- x.y.z` to sync `package.json`, lockfile, and both manifests.
- Pushing a Git tag that starts with lowercase `v`, for example `v1.2.3`, triggers GitHub Actions to build release ZIP packages.
- Each release ZIP contains a single top-level folder. Extract that folder and load it as an unpacked browser extension.

## Adapter changes

- Keep adapters aligned with the four-hook contract.
- Prefer shared helpers from `ctx.helpers.*` instead of custom DOM or protocol implementations.
- Add or update tests when adapter behavior changes.
