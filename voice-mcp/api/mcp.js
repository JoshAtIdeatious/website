import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { fetchPage, browsePage, format } from "../lib/web.js";

const DEFAULT_CHARS = 6000;

function buildServer() {
  const server = new McpServer({ name: "ideatious-web", version: "1.0.0" });

  const common = {
    url: z.string().describe("Full URL including https://"),
    max_chars: z.number().int().min(500).max(40000).optional()
      .describe(`How much page text to return (default ${DEFAULT_CHARS}). Keep it small for voice.`),
  };

  server.tool(
    "fetch_page",
    "Read a live web page right now and return its main text plus links. Fast. Use this first for any URL, " +
      "or to check current info (prices, opening hours, news, status pages). If the result looks empty or says " +
      "to enable JavaScript, use browse_page instead.",
    common,
    async ({ url, max_chars }) => {
      try {
        const r = await fetchPage(url, max_chars ?? DEFAULT_CHARS);
        const thin = r.text.length < 300 ? "Note: very little text — try browse_page if this page uses JavaScript." : "";
        return { content: [{ type: "text", text: format(r, thin) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `fetch_page failed: ${e.message}. Try browse_page — some sites block plain fetches.` }] };
      }
    }
  );

  server.tool(
    "browse_page",
    "Open a URL in a real headless Chrome browser, let its JavaScript run, then return the rendered text plus links. " +
      "Slower (5–20s). Use for booking sites, dashboards, single-page apps, or when fetch_page came back empty.",
    {
      ...common,
      wait_for: z.string().optional().describe("Optional CSS selector to wait for before reading, e.g. '.results'"),
      wait_ms: z.number().int().min(0).max(10000).optional().describe("Optional extra wait after load, in ms"),
    },
    async ({ url, max_chars, wait_for, wait_ms }) => {
      try {
        const r = await browsePage(url, max_chars ?? DEFAULT_CHARS, wait_ms, wait_for);
        return { content: [{ type: "text", text: format(r, "Rendered with headless Chrome.") }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `browse_page failed: ${e.message}` }] };
      }
    }
  );

  return server;
}

function tokenOk(given) {
  const want = process.env.MCP_TOKEN;
  if (!want || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const token = req.query?.token ?? url.searchParams.get("token") ?? url.pathname.split("/").pop();
  if (!tokenOk(token)) {
    res.statusCode = 404;
    return res.end("Not found");
  }
  if (req.method !== "POST") {
    // Stateless server: no SSE stream or session to resume.
    res.statusCode = 405;
    res.setHeader("allow", "POST");
    return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
