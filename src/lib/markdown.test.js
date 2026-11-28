import test from "node:test"
import assert from "node:assert/strict"
import { isSafeUrl, markdownToPlainText, safeUrlTransform } from "./markdown.js"

test("isSafeUrl allows http, https, and optional mailto while blocking unsafe schemes", () => {
  assert.equal(isSafeUrl("https://example.com/path?a=1#b"), true)
  assert.equal(isSafeUrl("http://localhost:3000"), true)
  assert.equal(isSafeUrl("mailto:user@example.com"), true)
  assert.equal(isSafeUrl("mailto:user@example.com", { allowMailto: false }), false)
  assert.equal(isSafeUrl("javascript:alert(1)"), false)
  assert.equal(isSafeUrl("JAVASCRIPT:alert(1)"), false)
  assert.equal(isSafeUrl("data:text/html,<script>alert(1)</script>"), false)
  assert.equal(isSafeUrl("vbscript:msgbox(1)"), false)
  assert.equal(isSafeUrl("file:///etc/passwd"), false)
  assert.equal(isSafeUrl("https://example.com/\nfoo"), false)
  assert.equal(isSafeUrl("/relative/path"), false)
  assert.equal(isSafeUrl(""), false)
})

test("safeUrlTransform keeps safe links and blocks unsafe image sources", () => {
  assert.equal(safeUrlTransform("https://example.com/a.png", "src"), "https://example.com/a.png")
  assert.equal(safeUrlTransform("mailto:a@b.com", "href"), "mailto:a@b.com")
  assert.equal(safeUrlTransform("mailto:a@b.com", "src"), "")
  assert.equal(safeUrlTransform("javascript:alert(1)", "href"), "")
  assert.equal(safeUrlTransform("data:image/svg+xml;base64,abc", "src"), "")
})

test("markdownToPlainText strips headings, emphasis, links, images, lists, and code fences cleanly", () => {
  const md = [
    "## Release checklist",
    "",
    "- [x] Fix **auth** & _session_ timeout",
    "- [ ] Update [docs](https://example.com/docs) with `snake_case_key`",
    "> Important ~~old~~ note ![badge](https://example.com/b.png)",
    "---",
    "```js",
    "const ok = true",
    "```",
  ].join("\n")

  assert.equal(
    markdownToPlainText(md),
    [
      "Release checklist",
      "☑ Fix auth & session timeout",
      "☐ Update docs with snake_case_key",
      "Important old note badge",
      "const ok = true",
    ].join("\n")
  )
})

test("markdownToPlainText flattens GFM tables and preserves plain text & issue numbers", () => {
  const md = [
    "| Env | Status |",
    "| --- | :---: |",
    "| Prod | OK |",
    "Fix #123 and keep_under_scores intact",
  ].join("\n")

  assert.equal(
    markdownToPlainText(md),
    [
      "Env · Status",
      "Prod · OK",
      "Fix #123 and keep_under_scores intact",
    ].join("\n")
  )
})

test("markdownToPlainText handles empty values, mermaid blocks, and escaped characters", () => {
  assert.equal(markdownToPlainText(""), "")
  assert.equal(markdownToPlainText(null), "")
  assert.equal(markdownToPlainText("Use \\*literal\\* and \\#1"), "Use *literal* and #1")
  assert.equal(
    markdownToPlainText("## Flow\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\nDone"),
    "Flow\n[Mermaid]\nDone"
  )
})
