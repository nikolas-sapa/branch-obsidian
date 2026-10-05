import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Element, elements, loadPlugin, tree } from './helpers/host.mjs';

async function fixture(t, persistedData = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'branch-obsidian-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = await loadPlugin(dir);
  host.plugin.persistedData = { sessionsDir: dir, ...persistedData };
  await host.plugin.onload();
  return { dir, ...host };
}

async function picker(plugin, state) {
  await plugin.commands[0].editorCallback({ replaceSelection() {} });
  return state.pickers.at(-1);
}

for (const [name, change] of [
  ['missing root', (t) => { delete t.root; }],
  ['non-string prompt', (t) => { t.prompt = null; }],
  ['non-string model', (t) => { t.model = 1; }],
  ['invalid date', (t) => { t.createdAt = 'not-a-date'; }],
  ['non-string date', (t) => { t.createdAt = 7; }],
  ['missing date', (t) => { delete t.createdAt; }],
  ['invalid children', (t) => { t.root.children = {}; }],
  ['invalid node content', (t) => { t.root.content = null; }],
  ['invalid node id', (t) => { t.root.id = 1; }],
  ['unsafe session id', (t) => { t.sessionId = 'safe\n```\ninjected'; }],
  ['filename mismatch', (t) => { t.sessionId = 'another-session'; }],
]) {
  test(`${name}: picker skips malformed file and renderer returns friendly error`, async (t) => {
    const { dir, plugin, state } = await fixture(t);
    const invalid = tree();
    change(invalid);
    await writeFile(join(dir, 'safe-session.json'), JSON.stringify(invalid));
    const valid = tree('valid');
    await writeFile(join(dir, 'valid.json'), JSON.stringify(valid));
    const modal = await picker(plugin, state);
    assert.equal(modal.getItems().length, 1);
    assert.equal(modal.getItems()[0].sessionId, 'valid');
    assert.doesNotThrow(() => modal.getItemText(modal.getItems()[0]));
    const el = new Element();
    await assert.doesNotReject(plugin.renderTreeBlock('session: safe-session', el, {}));
    assert.match(el.children[0].text, /branch-tree:.*invalid/i);
    assert.equal(elements(el).filter((n) => n.tag === 'a').length, 0);
  });
}

test('malformed JSON and missing files render friendly errors', async (t) => {
  const { dir, plugin } = await fixture(t);
  await writeFile(join(dir, 'broken.json'), '{invalid');
  for (const id of ['broken', 'missing']) {
    const el = new Element();
    await plugin.renderTreeBlock(`session: ${id}`, el, {});
    assert.match(el.children[0].text, /branch-tree:/);
    assert.equal(elements(el).filter((n) => n.tag === 'a').length, 0);
  }
});

for (const persisted of [null, [], 'text', { sessionsDir: 12, viewerUrl: {}, truncateNodeChars: -1 },
  { sessionsDir: '', viewerUrl: '', truncateNodeChars: 0 },
  { sessionsDir: ' ', viewerUrl: 'javascript:alert(1)', truncateNodeChars: Infinity },
  { truncateNodeChars: 1.5 }, { truncateNodeChars: '200' }, { truncateNodeChars: NaN }]) {
  test(`persisted settings normalize invalid fields: ${JSON.stringify(persisted)}`, async (t) => {
    const { dir, plugin } = await fixture(t);
    plugin.persistedData = persisted;
    await plugin.loadSettings();
    assert.equal(typeof plugin.settings.sessionsDir, 'string');
    assert.ok(plugin.settings.sessionsDir.trim());
    assert.match(plugin.settings.viewerUrl, /^https?:\/\//);
    assert.equal(plugin.settings.truncateNodeChars, 200);
    assert.doesNotThrow(() => plugin.tab.display());
  });
}

for (const viewerUrl of ['javascript:alert(1)//', 'file:///tmp/viewer', 'data:text/html,hello']) {
  test(`unsafe viewer scheme creates zero active links: ${viewerUrl}`, async (t) => {
    const { dir, plugin } = await fixture(t);
    await writeFile(join(dir, 'safe-session.json'), JSON.stringify(tree()));
    plugin.settings.viewerUrl = viewerUrl;
    const el = new Element();
    await plugin.renderTreeBlock('session: safe-session', el, {});
    assert.equal(elements(el).filter((n) => n.tag === 'a').length, 0);
  });
}

test('HTTP(S) viewer URLs retain base path and disable opener', async (t) => {
  const { dir, plugin } = await fixture(t);
  await writeFile(join(dir, 'safe-session.json'), JSON.stringify(tree()));
  for (const base of ['http://localhost:7432/base/', 'https://example.com/nested/viewer']) {
    plugin.settings.viewerUrl = base;
    const el = new Element();
    await plugin.renderTreeBlock('session: safe-session', el, {});
    const link = elements(el).find((n) => n.tag === 'a');
    assert.equal(link.href, `${base.replace(/\/$/, '')}/t/safe-session`);
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    assert.match(link.rel, /noreferrer/);
  }
});

test('real tracked Branch gallery JSON lists, inserts and renders its exact node count', async (t) => {
  const { dir, plugin, state } = await fixture(t);
  // Unmodified Branch gallery export, tracked at branch-ai commit 54b16ad.
  const source = await readFile(new URL('./fixtures/MYxMPun8wl.json', import.meta.url), 'utf8');
  const actual = JSON.parse(source);
  await writeFile(join(dir, `${actual.sessionId}.json`), source);
  const pending = [actual.root];
  let count = 0;
  while (pending.length) { count++; pending.push(...pending.pop().children); }
  const modal = await picker(plugin, state);
  assert.equal(modal.getItems().length, 1);
  assert.equal(modal.getItems()[0].nodeCount, count);
  let inserted;
  await plugin.commands[0].editorCallback({ replaceSelection(value) { inserted = value; } });
  state.pickers.at(-1).onChooseItem(modal.getItems()[0]);
  assert.equal(inserted, `\`\`\`branch-tree\nsession: ${actual.sessionId}\n\`\`\`\n`);
  const el = new Element();
  await plugin.renderTreeBlock(`session: ${actual.sessionId}`, el, {});
  assert.equal(elements(el).filter((n) => n.tag === 'li').length, count);
});

test('8000-level valid JSON tree counts and renders all nodes without recursive stack failure', async (t) => {
  const { dir, plugin, state } = await fixture(t);
  const metadata = tree();
  delete metadata.root;
  const depth = 8000;
  const nodeStart = '{"id":"node","content":"deep","children":[';
  const raw = JSON.stringify(metadata).slice(0, -1) + ',"root":' + nodeStart.repeat(depth - 1)
    + '{"id":"leaf","content":"deep","children":[]}' + ']}'.repeat(depth - 1) + '}';
  await writeFile(join(dir, 'safe-session.json'), raw);
  const modal = await picker(plugin, state);
  assert.ok(modal);
  assert.equal(modal.getItems()[0].nodeCount, depth);
  const el = new Element();
  await plugin.renderTreeBlock('session: safe-session', el, {});
  assert.equal(elements(el).filter((n) => n.tag === 'li').length, depth);
});
