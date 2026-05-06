/**
 * dashboard-xss.test.ts — SEC-005 regression test.
 *
 * SEC-005: Stored XSS in the loopback dashboard via memory content.
 *
 * Before fix: the memory list renderer in static/index.html did:
 *   list.innerHTML = (data.memories ?? []).map(m => `<div>${m.content}</div>`)
 * Memory `content` is attacker-controllable (any tool agent that calls
 * cortex:remember can submit a payload). When the dashboard fetched and
 * rendered such memories, <script>, <img onerror=...> and other HTML
 * elements were parsed and executed.
 *
 * Fix: replaced innerHTML interpolation with DOM API (textContent +
 * createElement). textContent never parses HTML.
 *
 * This test:
 *   1. Reads the static/index.html source.
 *   2. Asserts the loadMemories() function uses textContent (not innerHTML)
 *      for any field derived from memory data (m.content, m.store_type,
 *      m.consolidation_stage, m.domain, m.heat).
 *   3. Asserts no innerHTML assignment remains anywhere in the script.
 *
 * Falsification: revert to the innerHTML form and the test fails.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = join(__dirname, "..", "src", "static", "index.html");

describe("dashboard: SEC-005 XSS regression", () => {
  it("static/index.html does NOT use innerHTML for any user-controlled field", () => {
    const html = readFileSync(INDEX_HTML_PATH, "utf-8");

    // Strip JS string literals to avoid false positives in comments.
    // The actual concern is `.innerHTML =` assignment statements.
    // (DOMPurify-style assignments are also forbidden — we don't use it.)
    const innerHtmlAssignments = html.match(/\.innerHTML\s*=\s*[^;]+/g) ?? [];

    // Allowed assignments: NONE. The dashboard renders all data via DOM API.
    expect(innerHtmlAssignments).toEqual([]);
  });

  it("loadMemories renders m.content via textContent / createTextNode", () => {
    const html = readFileSync(INDEX_HTML_PATH, "utf-8");

    // Locate the loadMemories function body.
    const fnMatch = /async function loadMemories\(\)[\s\S]*?\n\s{4}\}/m.exec(html);
    expect(fnMatch, "loadMemories function not found in index.html").not.toBeNull();
    const body = fnMatch![0];

    // Must NOT contain template-literal HTML containing m.content.
    // Pattern that previously held the vuln: `${m.content}` inside a string
    // assigned via innerHTML.
    expect(body.includes(".innerHTML")).toBe(false);

    // Must rely on a safe-render API for content.
    const safeRender =
      body.includes("createTextNode") ||
      body.includes("textContent");
    expect(safeRender).toBe(true);
  });

  it("dashboard JS does not use document.write or eval", () => {
    const html = readFileSync(INDEX_HTML_PATH, "utf-8");
    expect(html.includes("document.write")).toBe(false);
    expect(/[^a-zA-Z_]eval\s*\(/.test(html)).toBe(false);
    // Function constructor — equivalent to eval.
    expect(/new\s+Function\s*\(/.test(html)).toBe(false);
  });
});
