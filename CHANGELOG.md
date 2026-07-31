# Changelog


## v1.1.1

[compare changes](https://github.com/laioutr/app-essentials-seo/compare/v1.1.0...v1.1.1)

### 🩹 Fixes

- Stop shipping the sitemap XSL stylesheet to production ([0f2c07c](https://github.com/laioutr/app-essentials-seo/commit/0f2c07c))

### 💅 Refactors

- Take completion from the page-index stream contract ([3d9547b](https://github.com/laioutr/app-essentials-seo/commit/3d9547b))

### 📖 Documentation

- Add the upstream-adoption handoff and the snapshot state-machine plan ([99a75a6](https://github.com/laioutr/app-essentials-seo/commit/99a75a6))
- Design the wall-clock deadline for an enumeration pass ([c3bfcfd](https://github.com/laioutr/app-essentials-seo/commit/c3bfcfd))
- Correct which bound binds when the connector is slow ([682aed6](https://github.com/laioutr/app-essentials-seo/commit/682aed6))

### 🏡 Chore

- Lock dependencies at 0.38.2 and resolve the shopify devDependency ([a0538bc](https://github.com/laioutr/app-essentials-seo/commit/a0538bc))
- **playground:** Run against a real project rc when one is present ([30f97d7](https://github.com/laioutr/app-essentials-seo/commit/30f97d7))

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>

## v1.1.0


### 🚀 Enhancements

- Rename to @laioutr/app-essentials-seo and add config surface ([d7ab838](https://github.com/laioutr/app-essentials-seo/commit/d7ab838))
- Add pure path helpers for sitemap URL composition ([a4f4429](https://github.com/laioutr/app-essentials-seo/commit/a4f4429))
- Add sitemap source name slugging and parsing ([02cb81c](https://github.com/laioutr/app-essentials-seo/commit/02cb81c))
- Add page selection predicates for sitemap inclusion ([ede9a22](https://github.com/laioutr/app-essentials-seo/commit/ede9a22))
- Derive site, sitemap and robots config from laioutrrc ([9c31a5a](https://github.com/laioutr/app-essentials-seo/commit/9c31a5a))
- Wire module fan-out and install the seo modules ([f7d7e70](https://github.com/laioutr/app-essentials-seo/commit/f7d7e70))
- Resolve request host and locale to a market domain ([9209929](https://github.com/laioutr/app-essentials-seo/commit/9209929))
- Build configured-page sitemap URLs with cross-host alternates ([7245996](https://github.com/laioutr/app-essentials-seo/commit/7245996))
- Map page-index entries to sitemap URLs and declare the resolve hook ([1c5b26d](https://github.com/laioutr/app-essentials-seo/commit/1c5b26d))
- Add host-keyed sitemap snapshot store with live and pending slots ([4e8e742](https://github.com/laioutr/app-essentials-seo/commit/4e8e742))
- Add bounded resumable sitemap rebuild pass ([58efe9b](https://github.com/laioutr/app-essentials-seo/commit/58efe9b))
- Serve per-host sitemap sources from a resumable snapshot ([4b3de61](https://github.com/laioutr/app-essentials-seo/commit/4b3de61))
- Export the sitemap hook payload types ([001c281](https://github.com/laioutr/app-essentials-seo/commit/001c281))
- Warn when a non-production deployment is forced indexable ([6ec66ef](https://github.com/laioutr/app-essentials-seo/commit/6ec66ef))

### 🩹 Fixes

- Reject sitemap name collisions and document registry lifetime ([43625d5](https://github.com/laioutr/app-essentials-seo/commit/43625d5))
- Treat null conditions as unconditional and split robots on whitespace ([1e66351](https://github.com/laioutr/app-essentials-seo/commit/1e66351))
- Type the derived site config instead of Record<string, unknown> ([92e2c9d](https://github.com/laioutr/app-essentials-seo/commit/92e2c9d))
- Group multiTenancy entries by host and guard blank env values ([921eac8](https://github.com/laioutr/app-essentials-seo/commit/921eac8))
- Drop plan reference from globalExtensions.ts comment ([847dfa5](https://github.com/laioutr/app-essentials-seo/commit/847dfa5))
- Order-independent robots config, both site.url sources, curated key leak ([707968f](https://github.com/laioutr/app-essentials-seo/commit/707968f))
- Unify param-completeness check with fillParams' constraint fallback ([790cf3c](https://github.com/laioutr/app-essentials-seo/commit/790cf3c))
- Guard rebuild-pass diagnostics against non-Error rejections ([60c5804](https://github.com/laioutr/app-essentials-seo/commit/60c5804))
- Swallow rejected background sitemap passes and lock down rcProject.config typing ([4c1f996](https://github.com/laioutr/app-essentials-seo/commit/4c1f996))
- Stop installing redundant peer modules on the prepare step ([0c03fdf](https://github.com/laioutr/app-essentials-seo/commit/0c03fdf))
- Point the playground at a committed rc so dev:prepare works ([ffe635d](https://github.com/laioutr/app-essentials-seo/commit/ffe635d))
- Fire the sitemap source hook where the source is built ([3c79f9e](https://github.com/laioutr/app-essentials-seo/commit/3c79f9e))
- Honour include: false on page-index sitemap sources ([ecb535f](https://github.com/laioutr/app-essentials-seo/commit/ecb535f))
- Give the playground its own rc fixture ([89f4ff4](https://github.com/laioutr/app-essentials-seo/commit/89f4ff4))
- Resolve a www host onto the market that configures it ([2a55371](https://github.com/laioutr/app-essentials-seo/commit/2a55371))
- Keep walking the locale chain past a cleared field ([525589f](https://github.com/laioutr/app-essentials-seo/commit/525589f))

### 💅 Refactors

- Use zod/v4 for the module option schema ([3711d24](https://github.com/laioutr/app-essentials-seo/commit/3711d24))
- Use platform page and market types directly ([dcc0ed7](https://github.com/laioutr/app-essentials-seo/commit/dcc0ed7))
- Drop the redundant include flag from page type config ([88e9f86](https://github.com/laioutr/app-essentials-seo/commit/88e9f86))
- Rename the sitemap source hook to :built ([fee66ba](https://github.com/laioutr/app-essentials-seo/commit/fee66ba))
- Rename rebuildBatchSize to entriesPerRequest ([d584242](https://github.com/laioutr/app-essentials-seo/commit/d584242))
- Align the hook payload type name with the hook ([3b036dd](https://github.com/laioutr/app-essentials-seo/commit/3b036dd))
- Give every diagnostic one source for the package name ([daa6245](https://github.com/laioutr/app-essentials-seo/commit/daa6245))
- Lift the snapshot decision out of the nitro hook ([8283a74](https://github.com/laioutr/app-essentials-seo/commit/8283a74))

### 📖 Documentation

- Document the sitemap and robots surface ([7dc83e4](https://github.com/laioutr/app-essentials-seo/commit/7dc83e4))
- Note the cost of the first request for a page type ([c3bb2b6](https://github.com/laioutr/app-essentials-seo/commit/c3bb2b6))
- Explain the robots install race by its mechanism ([5aa9ac4](https://github.com/laioutr/app-essentials-seo/commit/5aa9ac4))

### 🏡 Chore

- Baseline my-laioutr-app template state ([d002aac](https://github.com/laioutr/app-essentials-seo/commit/d002aac))
- Satisfy lint across the module and test suite ([27c8b40](https://github.com/laioutr/app-essentials-seo/commit/27c8b40))
- Drop the unused ui devDependency ([fc6ba79](https://github.com/laioutr/app-essentials-seo/commit/fc6ba79))
- Drop template scaffolding this module never used ([0c7906a](https://github.com/laioutr/app-essentials-seo/commit/0c7906a))

### ✅ Tests

- Add multi-market fixture and sitemap integration suite ([1d10492](https://github.com/laioutr/app-essentials-seo/commit/1d10492))
- Harden sitemap convergence polling and self-pin noindex-omission test ([3175c76](https://github.com/laioutr/app-essentials-seo/commit/3175c76))
- Verify non-production deployments are not indexable ([6a221dd](https://github.com/laioutr/app-essentials-seo/commit/6a221dd))
- Tighten robots.txt assertion and align spy naming ([54de6b9](https://github.com/laioutr/app-essentials-seo/commit/54de6b9))
- Cover every snapshot state the sitemap can serve from ([7919dcb](https://github.com/laioutr/app-essentials-seo/commit/7919dcb))
- Let the fixture page index fail on demand ([7ac0ddb](https://github.com/laioutr/app-essentials-seo/commit/7ac0ddb))
- Cover recovery from a failed first enumeration ([1960788](https://github.com/laioutr/app-essentials-seo/commit/1960788))
- Cover the pending-slot refresh and its promotion ([3966f8e](https://github.com/laioutr/app-essentials-seo/commit/3966f8e))

### ❤️ Contributors

- Sebastian Langer <sebastian.langer@laioutr.com>

