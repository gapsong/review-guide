Explain the {{kind}} `{{path}}` of this repository to its owner, as a visual explanation page.
The owner wants to own this code again: understand what it does, why, and where it can hurt.

## The codemap entry

The owner's own one-line note about this path, from the codemap (or "none" when it has no entry yet):

```
{{entry}}
```

## What to write

Output folder: {{outputFolder}}

- Write one self-contained page, `index.html`, into the output folder above, and put every image, GIF, recording, script, style and font it uses next to it in that folder.
- Do not delete or change anything else in that folder: its subfolders hold the explanations of other paths.
- The page is shown inside VS Code without network access. Use no web URLs (no CDN): if a tool writes `<script src="https://...">` or similar, download that file into the output folder and point to it with a relative path. Embedded `data:` images and fonts are fine.
- Links between your own pages and files must be relative. Keep the explanation on one page if you can.
- Write in the reader's language. For this owner that is German.
- Back every claim about the code with `file:line`, and mark what you could not confirm as unconfirmed.
- Never use the em dash character; use a plain "-" instead.
- If the `explain-visually` skill is available, use it for recordings of the running system, click-through steppers and GIFs.

## Shape it by the label

Use the codemap entry's label. Without an entry, pick the label that fits best and say which one you picked.

- money: show where the cost is decided and where it is recorded, and who loses money if this code breaks.
- security: show where the secret or identity is born, where it lives and where it dies, and which attack this code stops.
- core: show its place in the main request path, from the request coming in to the answer going out.
- feature: show a real screenshot of where users see this feature, plus 3 sentences.
- util: only 3 sentences, no images.
- deep (when the entry says `deep: true`): put the small interface first, then what it hides behind it, and why a caller never needs to know that.

When you are done, say in one line where the page is.
