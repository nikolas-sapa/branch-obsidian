import {
  App,
  FuzzySuggestModal,
  MarkdownPostProcessorContext,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
} from "obsidian";
import { homedir } from "os";
import { readdir, readFile, stat } from "fs/promises";
import { join } from "path";

interface BranchSettings {
  sessionsDir: string;
  viewerUrl: string;
  truncateNodeChars: number;
}

const DEFAULT_SETTINGS: BranchSettings = {
  sessionsDir: join(homedir(), ".branch", "sessions"),
  viewerUrl: "http://localhost:7432",
  truncateNodeChars: 200,
};

interface SessionMeta {
  sessionId: string;
  prompt: string;
  model: string;
  createdAt: string;
  nodeCount: number;
  filePath: string;
}

interface TreeNode {
  id: string;
  content: string;
  children: TreeNode[];
}

interface Tree {
  sessionId: string;
  prompt: string;
  model: string;
  createdAt: string;
  root: TreeNode;
  finalText: string;
}

function countNodes(n: TreeNode): number {
  return 1 + n.children.reduce((s, c) => s + countNodes(c), 0);
}

async function listSessions(dir: string): Promise<SessionMeta[]> {
  let files: string[] = [];
  try { files = await readdir(dir); } catch { return []; }
  const out: SessionMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const fp = join(dir, f);
    try {
      const raw = await readFile(fp, "utf8");
      const t: Tree = JSON.parse(raw);
      const s = await stat(fp);
      out.push({
        sessionId: t.sessionId,
        prompt: t.prompt,
        model: t.model,
        createdAt: t.createdAt ?? new Date(s.mtimeMs).toISOString(),
        nodeCount: countNodes(t.root),
        filePath: fp,
      });
    } catch { /* skip */ }
  }
  out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return out;
}

class SessionPicker extends FuzzySuggestModal<SessionMeta> {
  constructor(
    app: App,
    private items: SessionMeta[],
    private onPick: (meta: SessionMeta) => void
  ) {
    super(app);
    this.setPlaceholder("Pick a Branch reasoning session…");
  }
  getItems(): SessionMeta[] {
    return this.items;
  }
  getItemText(item: SessionMeta): string {
    return `${item.sessionId}  •  ${item.model}  •  ${item.nodeCount} nodes  •  ${item.prompt.slice(0, 80)}`;
  }
  onChooseItem(item: SessionMeta): void {
    this.onPick(item);
  }
}

export default class BranchPlugin extends Plugin {
  settings!: BranchSettings;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "insert-branch-session",
      name: "Insert reasoning session",
      editorCallback: async (editor) => {
        const sessions = await listSessions(this.settings.sessionsDir);
        if (sessions.length === 0) {
          new Notice("No Branch sessions found. Run `branch \"prompt\"` first.");
          return;
        }
        new SessionPicker(this.app, sessions, (s) => {
          editor.replaceSelection("```branch-tree\nsession: " + s.sessionId + "\n```\n");
        }).open();
      },
    });

    this.registerMarkdownCodeBlockProcessor("branch-tree", async (source, el, ctx) => {
      await this.renderTreeBlock(source, el, ctx);
    });

    this.addSettingTab(new BranchSettingTab(this.app, this));
  }

  async renderTreeBlock(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const lines = source.split("\n").map((l) => l.trim()).filter(Boolean);
    const sessionLine = lines.find((l) => l.startsWith("session:"));
    if (!sessionLine) {
      el.createEl("pre").setText("branch-tree: missing 'session: <id>' line");
      return;
    }
    const sessionId = sessionLine.replace(/^session:\s*/, "");
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      el.createEl("pre").setText("branch-tree: invalid session id");
      return;
    }

    const filePath = join(this.settings.sessionsDir, `${sessionId}.json`);
    let tree: Tree;
    try {
      tree = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      el.createEl("pre").setText(`branch-tree: session ${sessionId} not found at ${filePath}`);
      return;
    }

    const wrap = el.createDiv({ cls: "branch-tree-wrap" });
    const header = wrap.createDiv({ cls: "branch-tree-header" });
    header.createEl("span", { text: tree.prompt, cls: "branch-tree-prompt" });
    header.createEl("span", { text: ` · ${tree.model} · ${countNodes(tree.root)} nodes`, cls: "branch-tree-meta" });
    const link = header.createEl("a", { text: "Open in viewer →", href: `${this.settings.viewerUrl}/t/${sessionId}` });
    link.target = "_blank";

    const list = wrap.createEl("ul", { cls: "branch-tree-list" });
    this.renderNode(tree.root, list, 0);
  }

  renderNode(n: TreeNode, parent: HTMLElement, depth: number) {
    const li = parent.createEl("li");
    const text = n.content.length > this.settings.truncateNodeChars
      ? n.content.slice(0, this.settings.truncateNodeChars) + "…"
      : n.content;
    li.createEl("span", { text, cls: depth === 0 ? "branch-tree-root-node" : "branch-tree-node" });
    if (n.children.length > 0) {
      const sub = li.createEl("ul");
      n.children.forEach((c) => this.renderNode(c, sub, depth + 1));
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class BranchSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: BranchPlugin) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Sessions directory")
      .setDesc("Where Branch CLI saves session JSONs.")
      .addText((t) => t.setValue(this.plugin.settings.sessionsDir).onChange(async (v) => {
        this.plugin.settings.sessionsDir = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Viewer URL")
      .setDesc("Base URL of your Branch viewer (used for 'Open in viewer' links).")
      .addText((t) => t.setValue(this.plugin.settings.viewerUrl).onChange(async (v) => {
        this.plugin.settings.viewerUrl = v;
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Node truncate length")
      .setDesc("Characters to show per node before truncating.")
      .addText((t) => t.setValue(String(this.plugin.settings.truncateNodeChars)).onChange(async (v) => {
        const n = parseInt(v, 10);
        if (!isNaN(n) && n > 0) {
          this.plugin.settings.truncateNodeChars = n;
          await this.plugin.saveSettings();
        }
      }));
  }
}
