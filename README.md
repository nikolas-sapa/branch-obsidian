# branch-obsidian

Obsidian plugin to embed [Branch](https://github.com/nikolas-sapa/branch-ai) reasoning trees in your notes.

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
   ````markdown
   ```branch-tree
   session: abc123
   ```
   ````
5. In preview mode the code block renders the full reasoning tree

## Settings

- **Sessions directory** — where Branch CLI saves JSONs (default `~/.branch/sessions`)
- **Viewer URL** — used for "Open in viewer" link (default `http://localhost:7432`)
- **Node truncate length** — chars per node before "…" (default 200)

Session JSON must match the Branch tree format, and its `sessionId` must match
the filename (for example, `abc123.json`). Invalid files are skipped by the picker
and show an error when referenced directly. Viewer URLs must use HTTP or HTTPS.

## Privacy

Rendering reads local session files and makes no network requests. Opening
"Open in viewer" navigates your browser to the configured viewer, sending the
session ID in its URL (default `http://localhost:7432`). The plugin does not upload
the session contents. Note sharing, exports and filesystem access follow your
Obsidian and operating-system configuration.

The default directory contains the local files written by Branch CLI. Keep the
viewer URL and sessions directory pointed at locations you trust.

## Development

```bash
npm ci
npm test
```

Tests exercise the compiled plugin with temporary session files and a small
Obsidian host adapter. They do not install the plugin or access a real vault.

## License

MIT
