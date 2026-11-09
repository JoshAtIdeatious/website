import dns from "node:dns/promises";
import net from "node:net";
import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

// --- Safety: only public http(s) targets, so this isn't a door into private networks.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error(`Not a valid URL: ${raw}`); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http and https URLs are allowed.");
  if (process.env.DEV_SKIP_DNS_CHECK === "1") return u; // local sandbox testing only
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error("That address points at a private network.");
  return u;
}

// --- Turn HTML into something short and speakable.
export function extract(html, baseUrl, maxChars) {
  const { document } = parseHTML(html);
  const title = (document.querySelector("title")?.textContent || "").trim();

  const links = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const text = (a.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 80) continue;
    let href;
    try { href = new URL(a.getAttribute("href"), baseUrl).href; } catch { continue; }
    if (!href.startsWith("http") || seen.has(href)) continue;
    seen.add(href);
    links.push(`- ${text}: ${href}`);
    if (links.length >= 20) break;
  }

  let text = "";
  try {
    const article = new Readability(document.cloneNode(true)).parse();
    text = article?.textContent || "";
  } catch { /* fall through */ }
  if (text.trim().length < 200) {
    for (const el of document.querySelectorAll("script,style,noscript,svg,iframe")) el.remove();
    text = document.body?.textContent || "";
  }
  text = text.replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

  const truncated = text.length > maxChars;
  if (truncated) text = text.slice(0, maxChars) + "\n\n[…truncated — ask for more with a higher max_chars or a narrower page]";

  return { title, text, links, truncated };
}

export function format({ url, title, text, links }, note) {
  return [
    `URL: ${url}`,
    title && `Title: ${title}`,
    note,
    "",
    text || "(No readable text found.)",
    links.length ? `\nLinks on page:\n${links.join("\n")}` : "",
  ].filter((x) => x !== undefined && x !== false && x !== "").join("\n");
}

// --- Quick path: plain HTTP fetch.
export async function fetchPage(url, maxChars) {
  let target = await assertPublicUrl(url);
  let res;
  for (let hop = 0; hop < 5; hop++) {
    res = await fetch(target, {
      redirect: "manual",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.5" },
      signal: AbortSignal.timeout(15000),
    });
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      target = await assertPublicUrl(new URL(loc, target).href);
      continue;
    }
    break;
  }
  const type = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${target.href}`);
  if (!type.includes("html")) {
    const truncated = body.length > maxChars;
    return { url: target.href, title: "", text: truncated ? body.slice(0, maxChars) + "\n[…truncated]" : body, links: [], truncated };
  }
  return { url: target.href, ...extract(body, target.href, maxChars) };
}

// --- Heavy path: real headless Chromium for JavaScript-rendered pages.
let browserPromise;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = (await import("puppeteer-core")).default;
      if (process.env.CHROME_PATH) {
        return puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true,
          args: ["--no-sandbox", ...(process.env.DEV_PROXY ? [`--proxy-server=${process.env.DEV_PROXY}`] : [])] });
      }
      const chromium = (await import("@sparticuz/chromium")).default;
      return puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: true,
      });
    })().catch((e) => { browserPromise = undefined; throw e; });
  }
  return browserPromise;
}

export async function browsePage(url, maxChars, waitMs, waitFor) {
  const target = await assertPublicUrl(url);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    // Skip heavy assets — we only want the words.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      ["image", "media", "font"].includes(r.resourceType()) ? r.abort() : r.continue();
    });
    await page.goto(target.href, { waitUntil: "networkidle2", timeout: 30000 });
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 }).catch(() => {});
    if (waitMs) await new Promise((r) => setTimeout(r, Math.min(waitMs, 10000)));
    const finalUrl = page.url();
    await assertPublicUrl(finalUrl);
    const html = await page.content();
    return { url: finalUrl, ...extract(html, finalUrl, maxChars) };
  } finally {
    await page.close().catch(() => {});
  }
}
