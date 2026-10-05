import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
export class Element {
  constructor(tag = 'div', options = {}) {
    this.tag = tag;
    this.children = [];
    this.text = options.text ?? '';
    Object.assign(this, options);
  }
  createEl(tag, options) {
    const child = new Element(tag, options);
    this.children.push(child);
    return child;
  }
  createDiv(options) { return this.createEl('div', options); }
  setText(text) { this.text = text; }
  empty() { this.children = []; }
}

export function elements(root) {
  const out = [];
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    out.push(node);
    pending.push(...node.children);
  }
  return out;
}

export async function loadPlugin(home) {
  const state = { pickers: [], notices: [] };
  class Plugin {
    settings = {};
    app = {};
    commands = [];
    async loadData() { return this.persistedData; }
    async saveData(data) { this.persistedData = data; }
    addCommand(command) { this.commands.push(command); }
    registerMarkdownCodeBlockProcessor(_, processor) { this.processor = processor; }
    addSettingTab(tab) { this.tab = tab; }
  }
  class FuzzySuggestModal {
    constructor(app) { this.app = app; }
    setPlaceholder() {}
    open() { state.pickers.push(this); }
  }
  class PluginSettingTab {
    constructor() { this.containerEl = new Element(); }
  }
  class Setting {
    setName() { return this; }
    setDesc() { return this; }
    addText(fn) {
      fn({ setValue() { return this; }, onChange() { return this; } });
      return this;
    }
  }
  const obsidian = {
    Plugin, FuzzySuggestModal, PluginSettingTab, Setting,
    Notice: class { constructor(message) { state.notices.push(message); } },
  };
  const module = { exports: {} };
  const source = await readFile(new URL('../../main.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require(name) {
      if (name === 'obsidian') return obsidian;
      if (name === 'os') return { ...require('node:os'), homedir: () => home };
      return require(name);
    },
    console, URL,
  }, { filename: fileURLToPath(new URL('../../main.js', import.meta.url)) });
  const plugin = new module.exports.default();
  return { plugin, state };
}

export function tree(sessionId = 'safe-session') {
  return {
    sessionId, prompt: 'Controlled prompt', model: 'fixture',
    createdAt: '2026-01-01T00:00:00.000Z', finalText: '',
    root: { id: 'root', content: 'Controlled content', children: [] },
  };
}
