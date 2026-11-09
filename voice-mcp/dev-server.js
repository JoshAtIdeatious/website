// Local test server: MCP_TOKEN=test CHROME_PATH=/path/to/chrome node dev-server.js
import http from "node:http";
import handler from "./api/mcp.js";

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  req.body = raw ? JSON.parse(raw) : undefined;
  const m = req.url.match(/^\/mcp\/([^/?]+)/);
  req.query = m ? { token: m[1] } : {};
  try { await handler(req, res); } catch (e) { console.error(e); res.statusCode = 500; res.end(String(e)); }
}).listen(process.env.PORT || 3939, () => console.log("listening on", process.env.PORT || 3939));
