# Around the Web · Maps

A Chrome extension that brings TikToks and articles into Google Maps, with a Gemini agent checking whether each source refers to the selected venue and branch.

## Quick start

Requires Node 22.18+.

```sh
npm install
npm run build        # load apps/extension/dist in chrome://extensions
npm run dev         # local UI preview at http://127.0.0.1:5173
```

For live research, configure `apps/api/.env` with `GEMINI_API_KEY`, `APIFY_TOKEN`, and `SOURCES=live`, then run `npm run dev:api`. Keys stay in the backend. The UI preview needs no credentials and labels its illustrative decisions as demo results.

- [Extension setup and behavior](apps/extension/README.md)
- [Backend setup and HTTP contract](apps/api/README.md)
- [Source adapters](apps/api/sources/README.md)
- [Three-venue demo and known limitations](docs/demo.md)
- [Team ownership and handoffs](TEAM-PLAN.md)

## Development

The root npm workspace includes the extension, API, and shared contracts. Use the root `package-lock.json` with `npm ci` for team installs. The existing API lockfile is retained for its earlier standalone workflow; it is not the root workspace lock.

```sh
npm run typecheck
npm test
npm run build
```

The API defaults to mock sources, but still calls Gemini. Successful live retrieval has been verified; prior Gemini high-demand errors prevented full live ranking validation. See the demo notes before presenting.
