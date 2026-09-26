import * as assert from "assert";
import { renderMarkdown } from "../../src/ui/markdown";

describe("Markdown in the guide panel", () => {
  it("shows **bold**, *italic* and `code`", () => {
    assert.strictEqual(
      renderMarkdown("The **value** is *rounded* by `round(x)`."),
      "<p>The <strong>value</strong> is <em>rounded</em> by <code>round(x)</code>.</p>",
    );
  });

  it("shows bold and italic that contain `code`", () => {
    assert.strictEqual(
      renderMarkdown("Not `x` is 0, but **the gradient of `x`**, *via `detach`*."),
      "<p>Not <code>x</code> is 0, but <strong>the gradient of <code>x</code></strong>, <em>via <code>detach</code></em>.</p>",
    );
  });

  it("leaves stars inside code and underscores in names alone", () => {
    assert.strictEqual(
      renderMarkdown("`a * b * c` and _ste and __init__ and 2 * 3 * 4"),
      "<p><code>a * b * c</code> and _ste and __init__ and 2 * 3 * 4</p>",
    );
  });

  it("escapes HTML from Claude, also inside bold and code", () => {
    const html = renderMarkdown("**<img src=x onerror=alert(1)>** `<script>` <b>hi</b>");
    assert.ok(!html.includes("<img") && !html.includes("<script>") && !html.includes("<b>"), html);
    assert.ok(html.includes("<strong>&lt;img src=x onerror=alert(1)&gt;</strong>"), html);
  });

  it("keeps a fenced diagram byte for byte, without Markdown inside it", () => {
    const text = "Before\n```\n**not bold**  |--|\n  <slope 1>\n```\nAfter";
    assert.strictEqual(
      renderMarkdown(text),
      `<p>Before</p><pre class="diagram">**not bold**  |--|\n  &lt;slope 1&gt;</pre><p>After</p>`,
    );
  });

  it("shows an unclosed fence as a diagram, not as prose", () => {
    assert.strictEqual(renderMarkdown("```\nx ──► 4.0"), `<pre class="diagram">x ──► 4.0</pre>`);
  });

  it("builds lists, with indented lines continuing an item", () => {
    assert.strictEqual(
      renderMarkdown("- one\n- two\n  still two\n\n1. first\n2. second"),
      "<ul><li>one</li><li>two<br>still two</li></ul><ol><li>first</li><li>second</li></ol>",
    );
  });

  it("builds tables", () => {
    assert.strictEqual(
      renderMarkdown("| part | forward |\n|---|---|\n| `a` | **4.0** |"),
      "<table><thead><tr><th>part</th><th>forward</th></tr></thead><tbody><tr><td><code>a</code></td><td><strong>4.0</strong></td></tr></tbody></table>",
    );
  });

  it("builds headings below the panel's own, and quotes", () => {
    assert.strictEqual(renderMarkdown("## Why\n> a zero with a cable"), "<h5>Why</h5><blockquote>a zero with a cable</blockquote>");
  });

  it("keeps single line breaks inside a paragraph", () => {
    assert.strictEqual(renderMarkdown("line one\nline two\n\nnext"), "<p>line one<br>line two</p><p>next</p>");
  });
});
