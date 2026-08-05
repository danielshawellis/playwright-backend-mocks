# Publishing

This repo continuous-deploys two artifacts from `main`:

| Artifact | Workflow | Trigger | Gate |
| --- | --- | --- | --- |
| VitePress docs → GitHub Pages | [`deploy-docs.yml`](./.github/workflows/deploy-docs.yml) | Push to `main` | Build succeeds |
| Library packages → npm | [`publish.yml`](./.github/workflows/publish.yml) | Push to `main` | Full CI suite, then publish |

npm auth uses **Trusted Publishing (OIDC)**: you authorize this GitHub repository + workflow on npmjs.com. No `NPM_TOKEN` secret.

## One-time setup (npm Trusted Publishing)

Do this once before the first successful publish. Packages today:

- `@playwright-backend-mocks/protocol`
- `@playwright-backend-mocks/node`
- `@playwright-backend-mocks/proxy`
- `@playwright-backend-mocks/playwright`
- `@playwright-backend-mocks/dashboard`

### 1. Create the npm scope

1. Sign in at [npmjs.com](https://www.npmjs.com/).
2. Create an organization named **`playwright-backend-mocks`** (this owns the `@playwright-backend-mocks/*` scope), or ensure you already control that scope.
3. Confirm your npm account can publish public packages under that scope.

### 2. Add a trusted publisher per package

For **each** package above:

1. Open the package on npm (create / claim the name under the org if it does not exist yet).
2. Go to **Settings → Trusted Publisher** (sometimes under **Publishing access**).
3. Choose **GitHub Actions** and set:

   | Field | Value |
   | --- | --- |
   | Organization or user | `danielshawellis` |
   | Repository | `playwright-backend-mocks-msw` |
   | Workflow filename | `publish.yml` |
   | Environment name | _(leave empty)_ |
   | Allowed actions | `npm publish` |

   Use only the filename `publish.yml`, not `.github/workflows/publish.yml`.

4. Save.

npm does not validate the configuration until the first publish attempt, so double-check spelling.

### 3. Confirm GitHub Pages (docs)

Docs CD is already wired. In the GitHub repo:

1. **Settings → Pages**
2. **Source**: GitHub Actions
3. Confirm the [Deploy docs](https://github.com/danielshawellis/playwright-backend-mocks-msw/actions/workflows/deploy-docs.yml) workflow is succeeding on `main`

Site URL: https://danielshawellis.github.io/playwright-backend-mocks-msw/

### 4. Optional hardening after the first green publish

On each package: **Settings → Publishing access → Require two-factor authentication and disallow tokens**. Trusted publishing continues to work; long-lived tokens do not.

## How to ship a release

1. Bump the same version in every package under [`packages/*/package.json`](./packages/) (keep `@playwright-backend-mocks/*` versions aligned).
2. Open a PR; wait for **CI** to pass.
3. Merge to `main`.
4. The **Publish** workflow runs the full test suite, then publishes any package versions that are not already on npm.
5. Merges that do not bump versions still run CI; the publish step is a no-op for already-published versions.

You can also run **Publish** manually via **Actions → Publish → Run workflow**.

## Local dry-run

```bash
pnpm build
pnpm publish:packages
```

Locally this still needs npm auth (OIDC only works in the configured GitHub Actions workflow). Prefer merging a version bump to `main` after trusted publishers are configured.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `ENEEDAUTH` / unable to authenticate | Trusted publisher not set, or workflow filename mismatch (`publish.yml` only) |
| Misleading `E404` on `PUT` | Often OIDC/trust mismatch, not a missing tarball — recheck org/repo/workflow fields |
| Provenance missing | Repo must be public; trusted publishing generates provenance automatically |
| Publish skipped every time | Version on `main` already exists on npm — bump `packages/*/package.json` |

Official reference: [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/).
