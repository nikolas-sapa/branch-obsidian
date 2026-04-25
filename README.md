# branch-obsidian

Obsidian plugin to embed [Branch](https://github.com/84yk8btb9f-prog/branch-ai) reasoning trees in your notes.

## Install

This plugin is not yet on the community store. To install manually:
1. Clone this repo or download a release
2. Copy `manifest.json`, `main.js`, and `styles.css` into `<your vault>/.obsidian/plugins/branch-ai/`
3. In Obsidian, enable "Branch" under Settings → Community plugins

Or use [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add this repo URL.

## Usage

1. Run `branch "your prompt"` from your terminal (requires [branch-ai](https://www.npmjs.com/package/branch-ai))
2. In Obsidian, open the command palette (Ctrl/Cmd-P) → "Branch: Insert reasoning session"
3. Pick a session from the fuzzy list
4. The plugin inserts:
   ```
   ```branch-tree
   session: abc123
   ```
   ```
5. In preview mode the code block renders the full reasoning tree

## Settings

- **Sessions directory** — where Branch CLI saves JSONs (default `~/.branch/sessions`)
- **Viewer URL** — used for "Open in viewer" link (default `http://localhost:7432`)
- **Node truncate length** — chars per node before "…" (default 200)

## Privacy

This plugin reads session JSONs from your local filesystem only. Nothing is uploaded, transmitted, or shared. The "Open in viewer" link points to whatever URL you configure (default `http://localhost:7432`, your local Branch viewer).

If your `Sessions directory` setting points to `~/.branch/sessions`, you're reading the same private files Branch CLI writes locally — they only become public if you explicitly run `branch share <id>` from your terminal.

## License

MIT
