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
import { readdir, readFile } from "fs/promises";
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

const SESSION_ID = /^[a-zA-Z0-9_-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTree(value: unknown, sessionId: string): value is Tree {
  if (!isRecord(value) || typeof value.sessionId !== "string"
    || !SESSION_ID.test(value.sessionId) || value.sessionId !== sessionId
    || typeof value.prompt !== "string" || typeof value.model !== "string"
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.finalText !== "string") return false;

  const pending: unknown[] = [value.root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!isRecord(node) || typeof node.id !== "string" || typeof node.content !== "string"
      || !Array.isArray(node.children)) return false;
    for (const child of node.children) pending.push(child);
  }
  return true;
}

function countNodes(root: TreeNode): number {
  let count = 0;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop()!;
    count++;
    for (const child of node.children) pending.push(child);
  }
  return count;
}

function viewerLink(base: string, sessionId: string): string | undefined {
  try {
    const url = new URL(base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.pathname = `${url.pathname.replace(/\/$/, "")}/t/${sessionId}`;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function normalizeSettings(value: unknown): BranchSettings {
  const data = isRecord(value) ? value : {};
  return {
    sessionsDir: typeof data.sessionsDir === "string" && data.sessionsDir.trim()
      ? data.sessionsDir : DEFAULT_SETTINGS.sessionsDir,
    viewerUrl: typeof data.viewerUrl === "string" && viewerLink(data.viewerUrl, "session")
      ? data.viewerUrl : DEFAULT_SETTINGS.viewerUrl,
    truncateNodeChars: typeof data.truncateNodeChars === "number"
      && Number.isSafeInteger(data.truncateNodeChars) && data.truncateNodeChars > 0
      ? data.truncateNodeChars : DEFAULT_SETTINGS.truncateNodeChars,
  };
}

async function listSessions(dir: string): Promise<SessionMeta[]> {
  let files: string[] = [];
  try { files = await readdir(dir); } catch { return []; }
  const out: SessionMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".json") || !SESSION_ID.test(f.slice(0, -5))) continue;
    const fp = join(dir, f);
    try {
      const raw = await readFile(fp, "utf8");
      const t: unknown = JSON.parse(raw);
      if (!isTree(t, f.slice(0, -5))) continue;
      out.push({
        sessionId: t.sessionId,
        prompt: t.prompt,
        model: t.model,
        createdAt: t.createdAt,
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
  declare settings: BranchSettings;

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
    if (!SESSION_ID.test(sessionId)) {
      el.createEl("pre").setText("branch-tree: invalid session id");
      return;
    }

    const filePath = join(this.settings.sessionsDir, `${sessionId}.json`);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      el.createEl("pre").setText(`branch-tree: session ${sessionId} not found at ${filePath}`);
      return;
    }
    if (!isTree(value, sessionId)) {
      el.createEl("pre").setText(`branch-tree: invalid session data for ${sessionId}`);
      return;
    }
    const tree = value;

    const wrap = el.createDiv({ cls: "branch-tree-wrap" });
    const header = wrap.createDiv({ cls: "branch-tree-header" });
    header.createEl("span", { text: tree.prompt, cls: "branch-tree-prompt" });
    header.createEl("span", { text: ` · ${tree.model} · ${countNodes(tree.root)} nodes`, cls: "branch-tree-meta" });
    const href = viewerLink(this.settings.viewerUrl, sessionId);
    if (href) {
      const link = header.createEl("a", { text: "Open in viewer →", href });
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }

    const list = wrap.createEl("ul", { cls: "branch-tree-list" });
    this.renderNode(tree.root, list, 0);
  }

  renderNode(n: TreeNode, parent: HTMLElement, depth: number) {
    const pending = [{ node: n, parent, depth }];
    while (pending.length > 0) {
      const item = pending.pop()!;
      const li = item.parent.createEl("li");
      const text = item.node.content.length > this.settings.truncateNodeChars
        ? item.node.content.slice(0, this.settings.truncateNodeChars) + "…"
        : item.node.content;
      li.createEl("span", { text, cls: item.depth === 0 ? "branch-tree-root-node" : "branch-tree-node" });
      if (item.node.children.length > 0) {
        const sub = li.createEl("ul");
        for (let i = item.node.children.length - 1; i >= 0; i--) {
          pending.push({ node: item.node.children[i], parent: sub, depth: item.depth + 1 });
        }
      }
    }
  }

  async loadSettings() {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
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
        const n = Number(v);
        if (Number.isSafeInteger(n) && n > 0) {
          this.plugin.settings.truncateNodeChars = n;
          await this.plugin.saveSettings();
        }
      }));
  }
}
