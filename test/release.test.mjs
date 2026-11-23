import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));

test('manifest, package and versions.json agree on the release version', async () => {
  const manifest = await json('manifest.json');
  const pkg = await json('package.json');
  const versions = await json('versions.json');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(pkg.version, manifest.version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
});

test('release workflow uploads every file a manual or BRAT install needs', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  for (const asset of ['main.js', 'manifest.json', 'styles.css']) {
    await access(new URL(`../${asset}`, import.meta.url));
    assert.match(workflow, new RegExp(`\\b${asset.replace('.', '\\.')}\\b`));
  }
});
