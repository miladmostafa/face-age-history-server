<p>
  <img src="https://static.getfaceage.com/logo.png" width="232" alt="Face Age logo for the AI skin analysis SDK at getfaceage.com" />
</p>

# Face Age Scan History Server

Self-hosted scan history for the [face-age](https://www.npmjs.com/package/face-age) skin analysis SDK. Stores each shopper's skin age, skin health, and problem scores on your own server, then feeds them back so the widget can show past scans and the Compare tab on any device.

[Face Age](https://getfaceage.com/) runs the analysis in the browser widget and the Face Age cloud. This Node.js service does not analyze photos. It only keeps the result payload, encrypted at rest, with a delete and export path for privacy requests.

Built for stores and developers who embed face-age and want cross-device skin scan history without standing up their own backend.

## Features

- REST API to create, list, and delete face-age scans
- SQLite by default, PostgreSQL when `DATABASE_URL` is a Postgres URL
- Server API key for your store backend, plus short-lived per-user access tokens for the browser
- Browser helper that syncs `API.getAdvisorData()` and restores history with `API.setHistoryData()`
- Per-user export and a GDPR-style delete that erases every scan for that user id
- AES-256-GCM encryption at rest
- Retention window and a per-user scan cap
- Facial photos are dropped before storage
- Docker image and Compose file
- OpenAPI docs at `/docs`

## How it works

Face Age cannot run in Node. The shopper's browser loads the widget, the widget talks to the Face Age cloud, and this server stores the JSON result.

1. Run `docker compose up`. The history server listens on port 3000.
2. After a shopper logs in, your store backend calls `POST /api/tokens` with the API key and that session's user id. The history server returns a short-lived access token scoped to that one user. Alternatively, your backend proxies the scan routes and never exposes this API to the browser.
3. The page receives only that access token. The helper posts `API.getAdvisorData()` to `POST /api/scans` with `Authorization: Bearer`. It does not send the API key or a user id.
4. When that shopper returns, the store mints a fresh token for the same session user. The helper calls `GET /api/scans` and passes the saved results to `API.setHistoryData()`. The widget opens past scans and its Compare tab. `analyze_ref_token` is the dedupe key, so posting the same scan again updates the existing row.
5. A privacy delete from your backend is `DELETE /api/users/123` with the API key. The signed-in browser can erase only its own rows with `DELETE /api/users/me`.

```mermaid
sequenceDiagram
  participant Shopper
  participant Store as Store backend
  participant Widget as face-age widget
  participant Cloud as Face Age cloud
  participant History as History server
  Shopper->>Store: Log in
  Store->>History: POST /api/tokens with API key and session user id
  History-->>Store: Short-lived access token
  Store-->>Shopper: access token only
  Shopper->>Widget: Scan face
  Widget->>Cloud: Analyze photo
  Cloud-->>Widget: Skin age, damage, problems
  Widget-->>History: POST /api/scans with Bearer token
  Shopper->>Widget: Return on another device
  Store->>History: Mint a new token for the same user
  Widget->>History: GET /api/scans
  History-->>Widget: setHistoryData
  Shopper->>Widget: Open Compare
```

## Quick start

Requirements: Docker, or Node.js 20.

### Docker

```bash
cp .env.example .env.local
# Set API_KEY, TOKEN_SECRET, DATA_ENCRYPTION_KEY, and FACEAGE_CLIENT_ID
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) for the demo (widget + helper) and [http://localhost:3000/docs](http://localhost:3000/docs) for the API docs.

PostgreSQL instead of SQLite:

```bash
docker compose -f docker-compose.postgres.yml up --build
```

### Node.js

```bash
cp .env.example .env.local
npm install
npm run build
npm start
```

`npm run dev` rebuilds the database schema and restarts on file changes.

## Configuration

Environment variables are read from the process environment. For local development, put them in `.env.local` (gitignored) or `.env`. The server loads those files on startup and does not override variables that are already set. Never commit secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_KEY` | required | Server-to-server secret. Your store backend sends it. The browser helper must not. Comma-separated values are accepted. `API_KEYS` is an alias. |
| `TOKEN_SECRET` | required | HMAC secret for short-lived per-user access tokens. At least 16 characters. Keep it on the server. |
| `USER_TOKEN_TTL_SECONDS` | `900` | Lifetime of tokens from `POST /api/tokens` and the local demo. 60 to 86400 seconds. |
| `DATA_ENCRYPTION_KEY` | required | Password for AES-256-GCM encryption of every stored payload. At least 16 characters. |
| `DATABASE_URL` | `file:./data/history.db` | SQLite file or a `postgresql://` URL. |
| `PORT` | `3000` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `RETENTION_DAYS` | `365` | Delete scans older than this many days. `0` keeps them until you delete them. |
| `MAX_SCANS_PER_USER` | `50` | After a new save, older scans beyond this count are deleted. |
| `MAX_PAYLOAD_BYTES` | `200000` | Maximum JSON size after image removal. |
| `STORE_IMAGES` | `false` | When `false`, facial image fields and `meta.image` are removed. `https` product image URLs are kept so restored recommendations can still render. |
| `CORS_ORIGIN` | `*` | Comma-separated browser origins allowed to call the API. Set this to your store domain before a public deploy. |
| `DEMO_ENABLED` | on outside production | Serves the widget demo at `/`. The demo mints a token with `POST /demo/session` for the id typed on the page. Turn this off on any public host, because that endpoint can mint a token for any id. It does not put `API_KEY` or `TOKEN_SECRET` in the HTML. |
| `FACEAGE_CLIENT_ID` | empty | Client ID used only by the demo page. |
| `RATE_LIMIT_MAX` | `120` | Requests per minute per IP. |
| `LOG_LEVEL` | `info` | Pino log level. |

### Getting a Client ID

The history server does not call Face Age on your behalf. The widget does, and the widget needs a Client ID (`faceageId`).

1. Open [panel.getfaceage.com](https://panel.getfaceage.com/) and create an account.
2. Copy the Client ID from the panel.
3. Pass it to `new FaceAge({ faceageId: 'YOUR_CLIENT_ID' })` on your site.
4. For this repo's demo page, set `FACEAGE_CLIENT_ID` in `.env.local` and restart. Do not commit the value.

The widget mounts directly in the page, in an element with id `FaceAge-module`. It is not iframed by your code. face-age 2.4.x returns skin age, a skin health / damage percentage, and 13 problem scores. It does not return real age or gender.

## Browser helper

The helper is published in the browser as `FaceAgeHistory` from `/face-age-history.js`, and it can be imported from this package as `face-age-history-server/helper`.

Call `attach` before `render`. The widget reads history while it renders, and a later `setHistoryData` call would miss that first paint.

The helper never accepts the server API key and never sends a user id. Your store backend decides who the shopper is.

### Signed per-user token

After login, the store backend mints a token and the page only receives `accessToken`:

```js
// Store backend. userId comes from the login session, not from the browser.
app.get('/api/face-age/session', requireLogin, async (req, res) => {
  const minted = await fetch('https://history.example.com/api/tokens', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.HISTORY_API_KEY,
    },
    body: JSON.stringify({ userId: req.session.userId }),
  }).then((response) => response.json());
  res.json({ accessToken: minted.accessToken, expiresAt: minted.expiresAt });
});
```

```html
<div id="FaceAge-module"></div>
<script src="https://cdn.jsdelivr.net/npm/face-age@2.4.13/dist/faceage.js"></script>
<script src="https://history.example.com/face-age-history.js"></script>
<script>
  const session = await fetch('/api/face-age/session', { credentials: 'include' })
    .then((response) => response.json());

  const faceAge = new FaceAge({
    elementId: 'FaceAge-module',
    faceageId: 'YOUR_CLIENT_ID',
    history: true,
  });

  FaceAgeHistory.attach(faceAge, {
    baseUrl: 'https://history.example.com',
    accessToken: session.accessToken,
  }).then(() => faceAge.render());
</script>
```

The history server checks the HMAC, the expiry, and the `sub` claim. A token for user `123` cannot list, create, export, or delete scans for any other user. Putting that token in `X-Api-Key` does not authenticate.

### Store proxy

If you would rather not give the browser a history token, proxy the scan routes on your own origin. The proxy reads the user id from the session, adds `X-Api-Key`, and forwards the call. The helper then sends cookies and nothing else:

```js
FaceAgeHistory.attach(faceAge, {
  baseUrl: '',
  sessionProxy: true,
});
```

Proxy `POST /api/scans`, `GET /api/scans`, `DELETE /api/scans`, `DELETE /api/users/me`, and `GET /api/users/me/export`. Map `/me` to the session user on the history server (`DELETE /api/users/{sessionUserId}` and the matching export).

What the helper does:

- Registers `API.getAdvisorData()`. When a scan finishes, it posts the result to `/api/scans` with no user id in the body.
- On load, fetches `GET /api/scans` and calls `API.setHistoryData()` once with every saved scan.
- Wraps `API.removeHistoryItem(token)` so a local delete also deletes that scan on the server. `removeHistoryItem(null)` calls `DELETE /api/users/me`.

face-age 2.4.13 replaces its in-memory history on every `setHistoryData` call. Sending scans one by one would leave only the last scan, and Compare would have nothing to compare. The helper therefore sends one history document:

```js
{
  latestRefId: 'analyze_ref_newer',
  updatedAt: 1710000000000,
  items: {
    analyze_ref_older: { analysis, activeSelections, meta },
    analyze_ref_newer: { analysis, activeSelections, meta }
  }
}
```

That shape is what the 2.4.13 widget reads (`items` plus `latestRefId`) for the history gate, the Compare tab, and `removeHistoryItem(token)`.

### Payload shape

Documented `getAdvisorData` callback:

```js
{
  analysis: {
    analyze_ref_token: 'analyze_ref_abc123',
    skinAge: 28,
    damagePercentage: 12.4,
    problems: [{ key: 'pores', title: 'Pores', number: 22 }]
  },
  activeSelections: { skinType: 'combination' }
}
```

In the published 2.4.13 build, `getAdvisorData` is invoked with the problems array as `analysis`, while `analyze_ref_token`, `skinAge`, and `damagePercentage` live on the widget report object. The helper merges that callback with `faceAge.w.globals.skinAnalyzeData` so the stored record still has a real dedupe token. If no token can be found, the scan is not uploaded.

`meta.ts` is a millisecond timestamp. `meta.quality` may include `lightingScore`, `lighting`, `brightness`, `sharpnessScore`, `sharpness`, `blur`, `noise`, and `confidence` as finite numbers from 0 to 100. The helper does not send `meta.image` unless you pass `includeImage: true`, and even then only for `http` or `https` URLs.

Keep `API_KEY` and `TOKEN_SECRET` on the server. Lock `CORS_ORIGIN` to your store before a public deploy. The local demo at `/` is a stand-in for the store login: it calls `POST /demo/session` and must stay off on public hosts.

## API reference

Interactive docs: `/docs`. Machine-readable spec: `/openapi.json`.

Two credentials are accepted on `/api/*`:

- `X-Api-Key: <API_KEY>` or `Authorization: Bearer <API_KEY>` is the server API key. You must pass the store user's id (`userId` in the body, or `user` in the query). This is the store-backend path.
- `Authorization: Bearer <accessToken>` is a per-user token from `POST /api/tokens`. The user id is the token subject. Omit `userId`. A different user id returns `403`.

`X-Api-Key` accepts only the server API key. A user token in that header is rejected.

### Mint an access token

`POST /api/tokens` requires the server API key.

```bash
curl -X POST http://localhost:3000/api/tokens \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "userId": "123" }'
```

Response:

```json
{
  "accessToken": "v1.<payload>.<hmac>",
  "tokenType": "Bearer",
  "userId": "123",
  "expiresAt": "2026-01-01T00:15:00.000Z"
}
```

Optional `ttlSeconds` overrides `USER_TOKEN_TTL_SECONDS` for that token (60–86400). A per-user token cannot call this route.

### Create or update a scan

`POST /api/scans`

```bash
curl -X POST http://localhost:3000/api/scans \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "123",
    "payload": {
      "analysis": {
        "analyze_ref_token": "analyze_ref_abc123",
        "skinAge": 28,
        "damagePercentage": 12.4,
        "problems": []
      },
      "activeSelections": { "skinType": "combination" },
      "meta": { "ts": 1710000000000 }
    }
  }'
```

Returns `201` when the token is new for that user and `200` when the same `analyze_ref_token` is updated. `user` is accepted as an alias of `userId` for API key callers. A browser call with an access token sends only `payload`.

### List scans

`GET /api/scans?user=123` with the API key.

`GET /api/scans` with a per-user access token.

Newest first. Optional `limit` (1–100, default 50) and `offset`.

### Delete one scan

`DELETE /api/scans/:id`

`DELETE /api/scans?user=123&token=analyze_ref_abc123` with the API key.

`DELETE /api/scans?token=analyze_ref_abc123` with a per-user access token.

An access token that names another user's scan id gets `404`, and that scan stays stored.

### Export a user

`GET /api/users/123/export` with the API key.

`GET /api/users/me/export` with a per-user access token.

Returns every stored scan for that id as JSON.

### Delete a user

`DELETE /api/users/123` with the API key.

`DELETE /api/users/me` with a per-user access token.

Removes every scan stored for that id. Response: `{ "userId": "123", "deleted": 4 }`. Deleting a user that has no rows returns `deleted: 0`. The API key cannot call `/api/users/me`; pass the session user id in the path from your backend.

### Health

`GET /health` returns `{ "status": "ok" }` and does not require an API key.

## Privacy

- Payloads are encrypted with AES-256-GCM before they are written. The database stores ciphertext.
- `basCode`, data URLs, and other embedded facial image fields are removed before encryption. This service never stores the camera photo unless you opt in with `STORE_IMAGES=true`, and even then only an `http` or `https` `meta.image` URL is eligible. The raw base64 capture is always dropped.
- `RETENTION_DAYS` deletes old rows on a schedule and whenever scans are read or written. `MAX_SCANS_PER_USER` drops the oldest rows past the cap.
- `GET /api/users/:userId/export` and `DELETE /api/users/:userId` are the access and erase endpoints for a store backend that holds the API key. The browser equivalents are `/api/users/me/export` and `DELETE /api/users/me`, and they follow the signed-in token only.
- The server API key and the token signing secret stay off the page. A browser that holds a user token can read and delete only that user's scans.
- Logs redact `Authorization` and `X-Api-Key`. Request bodies are not logged.
- Analysis still happens in the shopper's browser and in the Face Age cloud, under Face Age's own terms. This repository only covers the history copy you choose to keep.

## FAQ

### Does this server run face-age or analyze faces?

No. The face-age package is a browser widget. Photos are analyzed by the widget and the Face Age cloud. This process only stores and returns the result JSON.

### What is stored for each scan?

The advisor payload: skin age, damage percentage, problem scores, quiz selections (`activeSelections`), and optional routine or product metadata. The dedupe key is `analysis.analyze_ref_token`.

### How does the Compare tab get its data?

The helper restores every saved scan through `API.setHistoryData()` before `render()`, with `history: true` on the widget. Opening a past analysis in the widget exposes Compare.

### Can two devices share history?

Yes. Both devices use a token (or a proxied session) for the same store user id. The history lives in this server, not in `localStorage`. The browser does not choose whose history to load.

### Does the browser hold the API key?

No. Mint a short-lived token on your store backend, or proxy the history routes there. The helper throws if you pass `apiKey`.

### How do I erase a shopper?

From your store backend, `DELETE /api/users/{userId}` with the API key. That deletes every scan for that id. The shopper's own token can call `DELETE /api/users/me` and cannot erase anyone else.

### Where do I get a Client ID?

Create one at [panel.getfaceage.com](https://panel.getfaceage.com/). Put it in the widget's `faceageId` option. For the local demo, set `FACEAGE_CLIENT_ID` in `.env.local`.

### Which face-age methods does the helper use?

`API.getAdvisorData()`, `API.setHistoryData()`, and `API.removeHistoryItem(token)`, matching face-age 2.4.x.

## License

MIT. Copyright (c) 2026 milad mostafa.

Face Age and the face-age SDK are published at [getfaceage.com](https://getfaceage.com/) and [npmjs.com/package/face-age](https://www.npmjs.com/package/face-age).

Suggested GitHub topics: `face-age`, `skin-analysis`, `skin-age`, `scan-history`, `face-scan`, `skincare`, `beauty-tech`, `self-hosted`, `gdpr`, `fastify`, `sqlite`, `openapi`.
