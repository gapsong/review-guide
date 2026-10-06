import * as assert from "assert";
import { CodemapEntry } from "../../src/codemap/codemap";
import { ExplainHeader, explanationPolicy, renderExplainPanel, renderExplanationPage } from "../../src/ui/explainHtml";

const cspSource = "https://csp.example";
const folderUrl = "https://file%2B.vscode-resource.example/work/.codemap/explanations/src/payment.py/";

const entry: CodemapEntry = {
  path: "src/payment.py",
  says: "Reserves the <amount> \"first\" & then charges it.",
  label: "money",
  deep: true,
};

function header(changes: Partial<ExplainHeader> = {}): ExplainHeader {
  return { path: "src/payment.py", entry, hasExplanation: false, explanationOlder: false, change: undefined, otherPage: undefined, ...changes };
}

function page(html: string) {
  return { html, baseUrl: folderUrl, folderUrl };
}

describe("C3, C4: the Explain panel", () => {
  it("shows the badge, the path, the sentence, the label and deep, and offers to generate an explanation", () => {
    const html = renderExplainPanel(header(), "n0nce", cspSource);
    assert.ok(html.includes("<span class=\"badge\">💰🧠</span><span class=\"path\">src/payment.py</span>"), html);
    assert.ok(html.includes("money · deep module"));
    assert.ok(html.includes("No explanation yet."));
    assert.ok(html.includes(">Generate explanation</button>"));
    assert.ok(html.includes("<code>.codemap/explanations/src/payment.py/</code>"), "says where the page will be written");
    assert.ok(!html.includes("Regenerate"));
  });

  it("escapes the sentence and the path", () => {
    const html = renderExplainPanel(header({ path: "src/<img src=x onerror=alert(1)>.py" }), "n0nce", cspSource);
    assert.ok(html.includes("Reserves the &lt;amount&gt; &quot;first&quot; &amp; then charges it."), html);
    assert.ok(html.includes("src/&lt;img src=x onerror=alert(1)&gt;.py"));
    assert.ok(!html.includes("<img") && !html.includes("<amount>"));
  });

  it("shows the owner's notes, escaped, with start as a button that opens it and mine with its lines", () => {
    const withNotes = { ...entry, why: "Real <cards>.", watch: "Retries.", start: "src/payment.py:42", mine: "Reserve first.\nThen <charge>." };
    const html = renderExplainPanel(header({ entry: withNotes }), "n0nce", cspSource);
    assert.ok(html.includes("<dt>Why it matters</dt><dd>Real &lt;cards&gt;.</dd><dt>Watch</dt><dd>Retries.</dd>"), html);
    assert.ok(html.includes("<dt>Start reading</dt><dd><button class=\"link\" data-review-guide=\"{&quot;type&quot;:&quot;openStart&quot;}\">src/payment.py:42</button></dd>"), html);
    assert.ok(html.includes("<dt>In your words</dt><dd><blockquote>Reserve first.\nThen &lt;charge&gt;.</blockquote></dd>"), html);
  });

  it("after a commit changed the path: says so first, and offers Still true, then Explain again", () => {
    const html = renderExplainPanel(header({ change: { commits: 2 }, hasExplanation: true, explanationOlder: true }), "n0nce", cspSource);
    assert.ok(html.includes("<p class=\"change\">⚠ Changed since you confirmed it (2 commits). Read it again, then say whether the entry is still true.</p>"), html);
    assert.ok(html.indexOf("class=\"change\"") < html.indexOf("class=\"says\""), "the marker comes before the sentence");
    assert.ok(html.includes("This explanation is older than the last commit that changed the code."));
    assert.match(html, /data-review-guide="\{&quot;type&quot;:&quot;confirm&quot;\}">Still true<\/button><button class="secondary" data-review-guide="\{&quot;type&quot;:&quot;generate&quot;\}">Explain again<\/button>/);
    assert.ok(!html.includes("Regenerate"));
  });

  it("without a change: no marker, no Still true, and Regenerate for an existing explanation", () => {
    const html = renderExplainPanel(header({ hasExplanation: true }), "n0nce", cspSource);
    for (const absent of ["class=\"change\"", "Still true", "Explain again", "older than"]) {
      assert.ok(!html.includes(absent), absent);
    }
    assert.ok(html.includes(">Regenerate</button>"));
  });

  it("shows no notes block for an entry without notes", () => {
    assert.ok(!renderExplainPanel(header(), "n0nce", cspSource).includes("<dl"));
  });

  it("says when a path is not in the codemap yet, and still offers to explain it", () => {
    const html = renderExplainPanel(header({ entry: undefined }), "n0nce", cspSource);
    assert.ok(html.includes("Not in the codemap yet."));
    assert.ok(!html.includes("class=\"badge\""));
    assert.ok(html.includes(">Generate explanation</button>"));
  });

  it("allows only its own nonce script and no frames or images without an explanation", () => {
    const html = renderExplainPanel(header(), "n0nce", cspSource);
    assert.ok(html.includes(`content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-n0nce';"`), html);
    assert.ok(html.includes("<script nonce=\"n0nce\">"));
    assert.ok(!html.includes("<iframe"));
  });

  it("shows the explanation page itself, with its base folder, the policy and the header on top", () => {
    const explanation = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<title>Payment</title>\n</head>\n<body class=\"page\">\n<h1>The payment</h1>\n<img src=\"flow.gif\">\n</body>\n</html>\n";
    const html = renderExplanationPage(page(explanation), header({ hasExplanation: true }), cspSource);
    const headStart = html.indexOf("<head>") + "<head>".length;
    assert.ok(html.startsWith(`<base href="${folderUrl}">`, headStart), "the base comes first, so relative links, images and scripts resolve in the page's folder");
    assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${explanationPolicy(cspSource)}">`));
    assert.ok(html.indexOf("acquireVsCodeApi") < html.indexOf("<title>"), "the panel's script runs before any script of the page");
    const bodyStart = html.indexOf("<body class=\"page\">") + "<body class=\"page\">".length;
    assert.ok(html.startsWith("<review-guide-bar><template shadowrootmode=\"open\">", bodyStart), "the header is the first thing in the body");
    assert.ok(html.includes(">Regenerate</button>"));
    assert.ok(!html.includes("Generate explanation"));
    assert.ok(html.includes("<h1>The payment</h1>\n<img src=\"flow.gif\">"), "the page itself is unchanged");
    assert.ok(!html.includes("<iframe"));
  });

  it("limits the explanation page to its own files: no web, no frames", () => {
    assert.strictEqual(explanationPolicy(cspSource), [
      "default-src 'none'",
      `img-src ${cspSource} data:`,
      `media-src ${cspSource} data:`,
      `font-src ${cspSource} data:`,
      `style-src ${cspSource} 'unsafe-inline'`,
      `script-src ${cspSource} 'unsafe-inline'`,
      `connect-src ${cspSource}`,
      "frame-src 'none'",
    ].join("; ") + ";");
  });

  it("finds its place in a page without head or body tags", () => {
    const html = renderExplanationPage(page("<p>Nur ein Absatz.</p>"), header({ hasExplanation: true }), cspSource);
    assert.ok(html.startsWith(`<base href="${folderUrl}">`));
    assert.ok(html.indexOf("<review-guide-bar>") < html.indexOf("<p>Nur ein Absatz.</p>"));
    const noHead = renderExplanationPage(page("<html><body><p>x</p></body></html>"), header({ hasExplanation: true }), cspSource);
    assert.ok(noHead.startsWith(`<html><base href="${folderUrl}">`));
    assert.ok(noHead.includes("<body><review-guide-bar>"));
  });

  it("is not fooled by a <header> tag or a folder address with quotes", () => {
    const html = renderExplanationPage(
      { html: "<html><header>top</header><head></head><body></body></html>", baseUrl: "https://x/a\"b/", folderUrl: "https://x/a\"b/</script>/" },
      header({ hasExplanation: true }),
      cspSource,
    );
    assert.ok(html.includes("<head><base href=\"https://x/a&quot;b/\">"), html);
    assert.ok(!html.includes("</script>/"), "the folder address cannot end the panel's script");
  });

  it("offers a way back when it shows another page of the explanation", () => {
    const html = renderExplanationPage(page("<body></body>"), header({ hasExplanation: true, otherPage: "steps/two.html" }), cspSource);
    assert.ok(html.includes(">Back to index.html</button> <span class=\"muted\">Showing steps/two.html</span>"));
    assert.ok(html.includes(">Regenerate</button>"));
  });
});
