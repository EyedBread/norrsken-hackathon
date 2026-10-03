# Around the Web extension

Manifest V3 extension for Google Maps. The drawer uses Shadow DOM; requests go through the background service worker to `http://localhost:8787`. No provider credentials are needed in the extension.

## Build and load

From the repository root (Node 22.18+):

```sh
npm install
npm run build
```

1. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
2. Select `apps/extension/dist`.
3. Start the backend with `npm run dev:api`. Configure credentials and `SOURCES=live` in `apps/api/.env`; see the API README. `SOURCES=mock` still calls Gemini, so it also needs a Gemini key.
4. Open a place on `www.google.com/maps/` or `www.google.se/maps/`.
5. Click **Around the Web**, confirm the address, then **Explore around the web**.

After rebuilding, click **Reload** on the extension in `chrome://extensions`, then reload the Maps tab. A Maps refresh alone may still use Chrome's cached extension code.

Only the listed Maps hosts are enabled; other country domains need an explicit manifest match. The API origin is intentionally fixed in `src/background.ts` and in the manifest's host permissions. Change both together when deploying. Do not put Gemini or Apify credentials in either file.

## Preview without API credits

```sh
npm run dev
# http://127.0.0.1:5173
```

The interaction studio uses the same drawer, controllers, filters, and evidence components. It combines recorded source captures with **illustrative UI decisions**, always labeled demo. It does not run Gemini, start Apify jobs, or represent successful live ranking. Search/check/queue fixtures stay in their selected state; no fake tool activity is generated. Remote thumbnails are fetched directly and may expire; the text/link fallback is intentional.

Use the state selector for queued, searching, checking, partial, empty, connection failure, missing thumbnails, unclear identity, and no selected place. The three venue buttons exercise switching and result clearing.

## Behavior and boundaries

- Reads visible headings and address controls, not obfuscated CSS classes or map-camera coordinates. English/Swedish address labels are supported.
- Watches DOM changes and checks SPA URL changes. Exact street and number are required before mapping to a demo venue key; names alone never establish a branch match.
- Missing address/city opens a correction form. Research starts only after a click. Changing the place or correcting details discards prior results and stops polling.
- Polls every 1.5 seconds. A generation token plus place key and job ID prevent stale results, including A → B → A. Polling stops at terminal state, errors, navigation, or a two-minute client budget. The backend owns running jobs; stopping UI polling does not cancel provider work already underway.
- Shows backend event messages, counts, source errors, uncertain/rejected decisions, and evidence. It does not generate verdicts in the live extension.
- `demo` is explicitly labeled. `cache` displays the saved research time. Each expanded card displays its source fetch time. Null metrics are unavailable, never fabricated zeros.
- Every card links to its original URL. Only HTTP(S) links and images are rendered; source text is escaped. Preview media is not downloaded or rehosted.
- Keyboard support includes normal tab navigation, visible focus, native disclosure controls, and Escape to close. This is a nonmodal drawer so Maps remains usable. Reduced-motion preferences are respected.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

The build scans output for provider-token patterns. Unit checks cover exact branch mapping, route identity, late start/poll responses, wrong-job responses, refresh, and recovery after failure. Root checks also run the existing API and source tests.

Browser verification uses the interaction studio plus an unpacked extension in an isolated Chromium profile. Maps markup can change, so rehearse the three demo venues before presenting. Live Gemini ranking remains a backend integration check; preview and scripted API tests do not establish model availability.

Verified on 2026-10-03: 30 workspace tests passed; typecheck and build passed. The installed extension detected Café Pascal's canonical branch key and rendered two cards through the background worker and existing API with scripted model/mock sources. Café Pascal → Vete-Katten → Café Pascal navigation kept the same drawer, cleared old results, and created no duplicate mounts. The preview's correction form, filters, evidence, close/reopen, loading/error/partial/empty states, thumbnail fallback, and 390px layout were exercised in Chromium.

Implementation references: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging), and [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
