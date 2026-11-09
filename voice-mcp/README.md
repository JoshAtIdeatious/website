# Ideatious Voice MCP

A small remote MCP server that lets Claude (including voice mode on the phone) read **live** web pages.

| Tool | What it does | Speed |
|---|---|---|
| `fetch_page` | Plain HTTP fetch → main text + links | ~1s |
| `browse_page` | Real headless Chrome, runs the page's JavaScript → rendered text + links | 5–20s |

Protected by a secret token in the URL. It also refuses private/internal addresses, so strangers can't use it as an open proxy or to reach internal networks.

## Deploy (Ideatious Vercel)

1. Create or sign in to the **Ideatious** Vercel account/team at vercel.com.
2. **Add New → Project → Import** `JoshAtIdeatious/website`.
3. Set **Root Directory** to `voice-mcp`. Framework preset: **Other**. Leave the build settings as they are.
4. Under **Environment Variables**, add `MCP_TOKEN` = a long random string. To make one:
   ```bash
   openssl rand -hex 24
   ```
5. Deploy. Your connector URL is:
   ```
   https://<your-project>.vercel.app/mcp/<MCP_TOKEN>
   ```

> The Vercel project only watches `voice-mcp/`, so the rest of the website (GitHub Pages) is untouched.
> To skip redeploys when only the site changes, set **Ignored Build Step** to `git diff --quiet HEAD^ HEAD -- .`

## Connect to Claude

1. On **claude.ai (web)** → Settings → Connectors → **Add custom connector**.
2. Name: `Ideatious Web`. URL: the connector URL above. No OAuth needed.
3. It syncs to the phone app. In a chat, make sure the connector is switched on in the tools menu.
4. Test it in a text chat first: *"Use fetch_page on metservice.com Queenstown and tell me tomorrow's high."* Then try the same thing in voice.

Treat the URL like a password. If it leaks, change `MCP_TOKEN` in Vercel and redeploy.

## Local dev

```bash
npm install
```

```bash
MCP_TOKEN=test CHROME_PATH=/path/to/chrome npm run dev
```

```bash
curl -X POST localhost:3939/mcp/test -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

`DEV_SKIP_DNS_CHECK` and `DEV_PROXY` exist only for sandboxed testing. Never set them on Vercel.
