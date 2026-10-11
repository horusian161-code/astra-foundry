import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateReadiness, REQUIRED_EVIDENCE} from '../tools/release-gate.mjs';

// EVERY acceptance report in these fixtures is synthetic. A passing fixture does
// not say that Foundry, two clients, screenshots or native operations were tested.
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const reviewer = 'synthetic-fixture-reviewer';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.parse('2026-10-10T12:00:00Z');
const repository = 'horusian161-code/astra-foundry';
const writeJSON = (filename, value) => fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const chunk = (kind, data) => {
    const type = Buffer.from(kind), result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0); type.copy(result, 4); data.copy(result, 8);
    result.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
    return result;
  };
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
}

async function fixture(t, {version = '0.3.0', complete = true} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'astra-release-fixture-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  for (const directory of ['scripts', 'styles', 'templates', 'tools', 'docs', 'evidence', 'astra-sdk-core']) await fs.mkdir(path.join(root, directory));
  const manifest = {
    id: 'astra-redline-combat', title: 'SYNTHETIC FIXTURE ONLY', version,
    compatibility: {minimum: '12', maximum: '12.999', verified: '12.343'},
    esmodules: ['scripts/main.mjs'], styles: ['styles/redline.css'], license: 'LICENSE',
    relationships: {systems: [{id: 'cyberpunk-red-core', type: 'system'}]},
    manifest: `https://github.com/${repository}/releases/download/v${version}/module.json`,
    download: `https://github.com/${repository}/releases/download/v${version}/astra-redline-combat-${version}.zip`
  };
  await writeJSON(path.join(root, 'module.json'), manifest);
  await fs.writeFile(path.join(root, 'scripts/main.mjs'), 'export const fixtureOnly = true;\n');
  await fs.writeFile(path.join(root, 'styles/redline.css'), '[data-fixture] { color: #fff; }\n');
  await fs.writeFile(path.join(root, 'templates/hud.hbs'), '<div data-fixture>Fixture</div>\n');
  await fs.writeFile(path.join(root, 'LICENSE'), 'Synthetic MIT test fixture.\n');
  await fs.writeFile(path.join(root, 'README.md'), 'SYNTHETIC FIXTURE: no live acceptance happened.\n');
  await writeJSON(path.join(root, 'docs/not-runtime.json'), {mustNotBeDistributed: true});
  await writeJSON(path.join(root, 'astra-sdk-core/module.json'), {id: 'legacy-sdk-must-not-be-distributed'});
  await fs.copyFile(path.join(sourceRoot, 'tools/build.py'), path.join(root, 'tools/build.py'));
  execFileSync('python3', ['tools/build.py'], {cwd: root, stdio: 'ignore'});
  const build = JSON.parse(await fs.readFile(path.join(root, 'dist/build-manifest.json'), 'utf8'));
  const candidate = {moduleId: manifest.id, version, sourceFingerprint: build.sourceFingerprint, packageSha256: build.archive.sha256};
  const entries = [];
  if (complete) for (const [kind, ids] of Object.entries(REQUIRED_EVIDENCE)) {
    const logPath = `evidence/${kind}.txt`;
    const log = Buffer.from(`SYNTHETIC FIXTURE ONLY. No ${kind} acceptance happened.\n`);
    await fs.writeFile(path.join(root, logPath), log);
    const artifacts = [{path: logPath, sha256: sha(log), mediaType: 'text/plain'}];
    const checks = ids.map(id => ({id, status: 'passed', artifactPaths: [logPath]}));
    const report = {
      format: 'astra-acceptance-evidence-v1', kind, candidate,
      run: {id: `synthetic-${kind}`, startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:10:00Z'},
      environment: kind === 'local-checks' ? {runtime: 'node', nodeVersion: '20'} :
        {runtime: 'foundry', foundryVersion: '12.343', systemId: 'cyberpunk-red-core', systemVersion: '0.92.4', worldId: 'synthetic-lab', worldPurpose: 'isolated-test'},
      checks, artifacts
    };
    if (kind === 'visual') {
      report.screens = [];
      for (const [width, height] of [[1920, 1080], [1366, 768]]) {
        const checkId = `visual.${width}x${height}`, artifactPath = `evidence/synthetic-${width}x${height}.png`, bytes = png(width, height);
        await fs.writeFile(path.join(root, artifactPath), bytes);
        artifacts.push({path: artifactPath, sha256: sha(bytes), mediaType: 'image/png'});
        checks.find(item => item.id === checkId).artifactPaths = [artifactPath];
        report.screens.push({checkId, width, height, artifactPath, capture: 'running-foundry-module'});
      }
    }
    if (kind === 'two-client') report.clients = [
      {id: 'synthetic-gm-browser', userId: 'synthetic-gm', role: 'gm'},
      {id: 'synthetic-player-browser', userId: 'synthetic-player', role: 'player'}
    ];
    if (kind === 'native-operations') report.operations = ids.map(id => ({id, adapterOperation: `synthetic.adapter.${id}`, requestId: `synthetic-${id}`, receiptId: `synthetic-receipt-${id}`, documentUuids: ['Actor.synthetic-fixture']}));
    const reportPath = `evidence/${kind}.json`;
    await writeJSON(path.join(root, reportPath), report);
    entries.push({kind, path: reportPath, sha256: sha(await fs.readFile(path.join(root, reportPath)))});
  }
  const readiness = {format: 'astra-release-readiness-v1', candidate, entries};
  await writeJSON(path.join(root, 'docs/readiness.json'), readiness);
  await writeJSON(path.join(root, 'docs/release-review.json'), {
    format: 'astra-release-review-v1', reviewer, decision: 'approve-stable', reviewedAt: '2026-01-01T01:00:00Z', candidate, evidence: entries
  });
  return {root, manifest, build, candidate, readiness,
    options: {root, expectedVersion: version, trustedReviewer: reviewer, now},
    async updateReport(kind, change) {
      const entry = readiness.entries.find(item => item.kind === kind);
      const report = JSON.parse(await fs.readFile(path.join(root, entry.path), 'utf8'));
      change(report);
      await writeJSON(path.join(root, entry.path), report);
      entry.sha256 = sha(await fs.readFile(path.join(root, entry.path)));
      await writeJSON(path.join(root, 'docs/readiness.json'), readiness);
      const review = JSON.parse(await fs.readFile(path.join(root, 'docs/release-review.json'), 'utf8'));
      review.evidence = readiness.entries;
      await writeJSON(path.join(root, 'docs/release-review.json'), review);
    }
  };
}

test('runtime builder emits ONE clean deterministic ZIP and excludes docs/tools/legacy SDK', async t => {
  const data = await fixture(t, {complete: false});
  const names = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,zipfile;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))', path.join(data.root, data.build.archive.path)], {encoding: 'utf8'}));
  assert.deepEqual(names, [
    'astra-redline-combat/LICENSE', 'astra-redline-combat/README.md', 'astra-redline-combat/module.json',
    'astra-redline-combat/scripts/main.mjs', 'astra-redline-combat/styles/redline.css', 'astra-redline-combat/templates/hud.hbs'
  ]);
  const before = data.build.archive.sha256;
  execFileSync('python3', ['tools/build.py'], {cwd: data.root, stdio: 'ignore'});
  const after = JSON.parse(await fs.readFile(path.join(data.root, 'dist/build-manifest.json'), 'utf8'));
  assert.equal(after.archive.sha256, before);
  assert.equal(after.sourceFingerprint, data.build.sourceFingerprint);
});

test('sparse readiness and self-declared pass booleans cannot authorize publication', async t => {
  const data = await fixture(t, {complete: false});
  await writeJSON(path.join(data.root, 'docs/readiness.json'), {...data.readiness, ready: true, foundryTested: true, twoClientsPassed: true});
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  for (const kind of Object.keys(REQUIRED_EVIDENCE)) assert.ok(result.reasons.some(reason => reason.code === `missing-${kind}`));
});

test('fully shaped SYNTHETIC fixtures pass format/binding checks; this is not live evidence', async t => {
  const data = await fixture(t);
  const result = await evaluateReadiness(data.options);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.ready, true);
  assert.match(result.assurance, /not cryptographic attestation/);
});

test('forged acceptance-report digest is blocked despite a passed status string', async t => {
  const data = await fixture(t);
  data.readiness.entries.find(entry => entry.kind === 'live-foundry').sha256 = '0'.repeat(64);
  await writeJSON(path.join(data.root, 'docs/readiness.json'), data.readiness);
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-live-foundry'));
});

test('changed supporting log bytes invalidate their evidence reference', async t => {
  const data = await fixture(t);
  await fs.appendFile(path.join(data.root, 'evidence/two-client.txt'), 'Changed bytes after review.\n');
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-two-client'));
});

test('runtime source changes after packaging invalidate package and evidence binding', async t => {
  const data = await fixture(t);
  await fs.appendFile(path.join(data.root, 'scripts/main.mjs'), 'export const unreviewed = true;\n');
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'runtime-package'));
});

test('alpha is refused stable promotion even with complete synthetic reports and reviewer metadata', async t => {
  const data = await fixture(t, {version: '0.3.0-alpha.1'});
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'prerelease'));
});

test('reviewer metadata cannot substitute for an independently supplied expected reviewer', async t => {
  const data = await fixture(t);
  const result = await evaluateReadiness({...data.options, trustedReviewer: 'different-fixture-reviewer'});
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'review'));
});

test('browser reconstructions and fabricated viewport labels cannot satisfy actual-module visuals', async t => {
  const data = await fixture(t);
  await data.updateReport('visual', report => { report.screens[0].capture = 'browser-reconstruction'; });
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-visual'));
});

test('acceptance requires an isolated world, distinct GM/player users and native receipts', async t => {
  const data = await fixture(t);
  await data.updateReport('live-foundry', report => { report.environment.worldPurpose = 'working-world'; });
  await data.updateReport('two-client', report => { report.clients[1].userId = report.clients[0].userId; });
  await data.updateReport('native-operations', report => { delete report.operations[0].receiptId; });
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-live-foundry'));
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-two-client'));
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-native-operations'));
});

test('evidence paths cannot escape the candidate directory', async t => {
  const data = await fixture(t);
  data.readiness.entries[0].path = '../outside.json';
  await writeJSON(path.join(data.root, 'docs/readiness.json'), data.readiness);
  const result = await evaluateReadiness(data.options);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.code === 'evidence-local-checks'));
});
