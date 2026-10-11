#!/usr/bin/env node
/** Local accidental-release guard. It neither attests live tests nor authenticates a reviewer. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const REQUIRED_EVIDENCE = Object.freeze({
  'local-checks': ['local.unit-tests', 'local.static-checks', 'local.runtime-build'],
  'live-foundry': ['foundry.isolated-world', 'foundry.startup', 'foundry.document-source-of-truth', 'foundry.player-gm-permissions', 'foundry.window-reopen', 'foundry.scene-change-cleanup'],
  visual: ['visual.1920x1080', 'visual.1366x768', 'visual.russian-long-labels', 'visual.empty-state', 'visual.large-initiative', 'visual.reduced-motion', 'visual.expanded-compact', 'visual.hidden-targets'],
  'two-client': ['two-client.same-request-single-application', 'two-client.reconnect', 'two-client.player-gm-permissions'],
  'native-operations': ['native.attack-prepare', 'native.attack-roll', 'native.defense-resolve', 'native.damage-apply', 'native.ammo-consume', 'native.next-turn']
});

const HASH = /^[a-f0-9]{64}$/;
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const FORMAT = 'astra-acceptance-evidence-v1';
const MAX_METADATA_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const RUNTIME_DIRS = ['scripts', 'styles', 'templates'];
const RUNTIME_FILES = ['module.json', 'LICENSE', 'README.md'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const shortString = (value, limit = 128) => typeof value === 'string' && value.length > 0 && value.length <= limit;

async function boundedFile(root, relative, limit = MAX_METADATA_BYTES) {
  if (!shortString(relative, 512) || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some(part => part === '..' || part === '.')) {
    throw new Error('Expected a relative file path inside the candidate directory');
  }
  const absolute = path.join(root, relative);
  const stat = await fs.lstat(absolute);
  const real = await fs.realpath(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || !real.startsWith(`${root}${path.sep}`) || stat.size < 1 || stat.size > limit) {
    throw new Error(`Evidence must be a bounded regular file inside the candidate: ${relative}`);
  }
  const data = await fs.readFile(absolute);
  return {path: relative, absolute, data, bytes: data.length, sha256: sha(data)};
}

function boundMetadata(value, depth = 0) {
  if (depth > 12) throw new Error('Metadata exceeds the nesting limit');
  if (typeof value === 'string' && value.length > 4096) throw new Error('Metadata string is too long');
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error('Metadata array is too long');
    for (const item of value) boundMetadata(item, depth + 1);
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length > 64) throw new Error('Metadata object has too many keys');
    for (const [key, item] of entries) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe metadata key');
      boundMetadata(item, depth + 1);
    }
  }
}

async function metadata(root, relative) {
  const file = await boundedFile(root, relative);
  const value = JSON.parse(file.data.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected metadata object');
  boundMetadata(value);
  return {...file, value};
}

export async function runtimeIndex(root) {
  root = await fs.realpath(root);
  const relativeFiles = [...RUNTIME_FILES];
  async function walk(relative) {
    const directory = path.join(root, relative);
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Runtime directories must be regular directories');
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const next = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Runtime symlink is not allowed: ${next}`);
      if (entry.isDirectory()) await walk(next);
      else if (entry.isFile()) relativeFiles.push(next);
      else throw new Error(`Unsupported runtime entry: ${next}`);
    }
  }
  for (const relative of RUNTIME_DIRS) await walk(relative);
  relativeFiles.sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
  const files = [];
  for (const relative of relativeFiles) {
    const file = await boundedFile(root, relative, 25 * 1024 * 1024);
    files.push({path: relative, sha256: file.sha256, bytes: file.bytes});
  }
  const sourceFingerprint = sha(Buffer.from(files.map(file => `${file.path}\0${file.sha256}\n`).join('')));
  return {files, sourceFingerprint, fingerprintAlgorithm: 'sha256-runtime-path-index-v1'};
}

const ZIP_INSPECTION = String.raw`
import hashlib,json,sys,zipfile
filename,module_id,index_text=sys.argv[1:]
expected=json.loads(index_text)
with zipfile.ZipFile(filename) as archive:
    entries=archive.infolist()
    if len(entries)>500 or sum(item.file_size for item in entries)>50*1024*1024:
        raise ValueError('Runtime ZIP exceeds bounded inspection limits')
    names=[item.filename for item in entries]
    if len(names)!=len(set(names)):
        raise ValueError('Duplicate runtime ZIP entries')
    wanted=[module_id+'/'+item['path'] for item in expected]
    if sorted(names)!=sorted(wanted):
        raise ValueError('ZIP does not contain exactly the runtime source index')
    if archive.testzip() is not None:
        raise ValueError('ZIP CRC check failed')
    for item in expected:
        data=archive.read(module_id+'/'+item['path'])
        if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
            raise ValueError('ZIP content differs from current runtime source: '+item['path'])
print(json.dumps({'files':len(entries),'crcChecked':True}))
`;

function sameBinding(actual, expected) {
  return actual && Object.keys(expected).every(key => actual[key] === expected[key]);
}

function publicationUrls(manifest, repository) {
  const packageName = `${manifest.id}-${manifest.version}.zip`;
  const expectedDownload = `https://github.com/${repository}/releases/download/v${manifest.version}/${packageName}`;
  const allowedManifest = [
    `https://github.com/${repository}/releases/latest/download/module.json`,
    `https://github.com/${repository}/releases/download/v${manifest.version}/module.json`
  ];
  return manifest.download === expectedDownload && allowedManifest.includes(manifest.manifest);
}

function validRun(run, now) {
  if (!shortString(run?.id)) return false;
  const started = Date.parse(run.startedAt), completed = Date.parse(run.completedAt);
  return Number.isFinite(started) && Number.isFinite(completed) && started <= completed && completed <= now + 300000;
}

function pngDimensions(file) {
  const bytes = file.data;
  if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('Visual evidence must reference an actual PNG file');
  }
  return {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
}

/** Returns reasons instead of pretending a missing acceptance record is a passed check. */
export async function evaluateReadiness({root = process.cwd(), evidencePath = 'docs/readiness.json', reviewPath = 'docs/release-review.json', packagePath,
  channel = 'stable', expectedVersion, trustedReviewer = process.env.ASTRA_RELEASE_REVIEWER,
  expectedRepository = 'horusian161-code/astra-foundry', now = Date.now()} = {}) {
  const reasons = [];
  const block = (code, message) => reasons.push({code, message});
  const result = {ready: false, channel, moduleId: null, version: null, sourceFingerprint: null, packageSha256: null,
    reasons, requiredEvidence: Object.keys(REQUIRED_EVIDENCE), assurance: 'accidental-release guard; not cryptographic attestation or proof that live tests happened'};
  root = await fs.realpath(root);
  let manifest;
  try { manifest = (await metadata(root, 'module.json')).value; }
  catch (error) { block('manifest', error.message); return result; }
  result.moduleId = manifest.id; result.version = manifest.version;
  if (manifest.id !== 'astra-redline-combat') block('module-id', 'The upgrade identity must remain astra-redline-combat');
  if (channel !== 'stable') block('channel', 'This guard only authorizes the stable publication path; local alpha artifacts use build.py');
  if (!STABLE.test(manifest.version ?? '')) block('prerelease', 'Alpha, beta and other prereleases cannot be promoted by the stable gate');
  if (!shortString(expectedVersion) || expectedVersion !== manifest.version) block('expected-version', 'An explicit expected version must exactly match module.json');
  if (!publicationUrls(manifest, expectedRepository)) block('publication-urls', 'Manifest and versioned ZIP URLs must point to the proposed destination repository and exact version');
  if (!/^12(?:\.\d{1,5})?$/.test(manifest.compatibility?.verified ?? '')) block('unverified-foundry', 'Stable publication requires an explicitly verified Foundry v12 build');
  if (manifest.relationships?.requires?.some(entry => entry.id === 'astra-sdk-core')) block('single-package', 'The current distribution must not require a separate Astra SDK package');

  let index, candidate, archive;
  try {
    index = await runtimeIndex(root);
    result.sourceFingerprint = index.sourceFingerprint;
    packagePath ??= `dist/${manifest.id}-${manifest.version}.zip`;
    archive = await boundedFile(root, packagePath, 25 * 1024 * 1024);
    result.packageSha256 = archive.sha256;
    if (path.basename(packagePath) !== `${manifest.id}-${manifest.version}.zip`) throw new Error('Package filename differs from its manifest identity/version');
    execFileSync('python3', ['-c', ZIP_INSPECTION, archive.absolute, manifest.id, JSON.stringify(index.files)], {encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
    const build = (await metadata(root, 'dist/build-manifest.json')).value;
    if (build.format !== 'astra-runtime-build-v1' || build.moduleId !== manifest.id || build.version !== manifest.version ||
      build.fingerprintAlgorithm !== index.fingerprintAlgorithm || build.sourceFingerprint !== index.sourceFingerprint ||
      build.archive?.path !== packagePath || build.archive?.sha256 !== archive.sha256 || build.archive?.bytes !== archive.bytes ||
      JSON.stringify(build.files) !== JSON.stringify(index.files)) throw new Error('Build metadata does not match the current sources and exact runtime ZIP');
    candidate = {moduleId: manifest.id, version: manifest.version, sourceFingerprint: index.sourceFingerprint, packageSha256: archive.sha256};
  } catch (error) { block('runtime-package', error.message); }

  let evidence;
  try {
    evidence = (await metadata(root, evidencePath)).value;
    if (evidence.format !== 'astra-release-readiness-v1' || !candidate || !sameBinding(evidence.candidate, candidate)) block('evidence-binding', 'Evidence must bind to the exact module version, runtime source fingerprint, and package digest');
    if (!Array.isArray(evidence.entries) || evidence.entries.length > 16) throw new Error('Expected a bounded evidence entries array');
  } catch (error) { block('readiness-metadata', error.message); evidence = {entries: []}; }

  const seen = new Set();
  const reports = new Map();
  const evidenceRefs = [];
  for (const entry of evidence.entries) {
    if (!entry || !Object.hasOwn(REQUIRED_EVIDENCE, entry.kind) || seen.has(entry.kind) || !HASH.test(entry.sha256 ?? '')) {
      block('evidence-entry', 'Evidence kinds must be unique and use SHA256 file references'); continue;
    }
    seen.add(entry.kind);
    try {
      const reportFile = await metadata(root, entry.path);
      if (reportFile.sha256 !== entry.sha256) throw new Error('Evidence report file digest differs from its reference');
      evidenceRefs.push({kind: entry.kind, path: entry.path, sha256: entry.sha256});
      const report = reportFile.value;
      reports.set(entry.kind, report);
      if (report.format !== FORMAT || report.kind !== entry.kind || !candidate || !sameBinding(report.candidate, candidate)) throw new Error('Acceptance report is not bound to this candidate and evidence kind');
      if (!validRun(report.run, now)) throw new Error('Acceptance report needs bounded run identity and real timestamps');
      if (!Array.isArray(report.artifacts) || report.artifacts.length < 1 || report.artifacts.length > 32) throw new Error('Acceptance reports need actual supporting artifact files');
      const artifacts = new Map();
      for (const artifact of report.artifacts) {
        if (!HASH.test(artifact?.sha256 ?? '') || !shortString(artifact.mediaType, 80) || artifacts.has(artifact.path)) throw new Error('Artifact references need unique paths, media types and SHA256 hashes');
        const file = await boundedFile(root, artifact.path, MAX_ARTIFACT_BYTES);
        if (file.sha256 !== artifact.sha256) throw new Error(`Supporting artifact digest differs: ${artifact.path}`);
        artifacts.set(artifact.path, {...file, mediaType: artifact.mediaType});
      }
      if (!Array.isArray(report.checks) || report.checks.length < 1 || report.checks.length > 64) throw new Error('Acceptance report needs bounded check records');
      const checks = new Map();
      for (const check of report.checks) {
        if (!shortString(check?.id) || checks.has(check.id) || check.status !== 'passed' || !Array.isArray(check.artifactPaths) || !check.artifactPaths.length || check.artifactPaths.some(relative => !artifacts.has(relative))) {
          throw new Error('Check results must reference hashed artifact files; booleans are not acceptance evidence');
        }
        checks.set(check.id, check);
      }
      for (const checkId of REQUIRED_EVIDENCE[entry.kind]) if (!checks.has(checkId)) throw new Error(`Required check is missing: ${checkId}`);
      if (entry.kind === 'local-checks') {
        if (report.environment?.runtime !== 'node') throw new Error('Local-check evidence must identify its Node runtime');
      } else {
        const env = report.environment;
        if (env?.runtime !== 'foundry' || !/^12(?:\.\d{1,5})?$/.test(env.foundryVersion ?? '') || env.systemId !== 'cyberpunk-red-core' ||
          !shortString(env.systemVersion, 80) || !shortString(env.worldId) || env.worldPurpose !== 'isolated-test') throw new Error('Live reports must identify an isolated Foundry v12 CPR test environment');
        if (manifest.compatibility?.verified !== env.foundryVersion) throw new Error('Verified manifest build and actual acceptance build differ');
      }
      if (entry.kind === 'visual') {
        for (const [checkId, width, height] of [['visual.1920x1080', 1920, 1080], ['visual.1366x768', 1366, 768]]) {
          const screen = report.screens?.find(item => item.checkId === checkId);
          const file = screen && artifacts.get(screen.artifactPath);
          if (!screen || screen.capture !== 'running-foundry-module' || screen.width !== width || screen.height !== height || !file || file.mediaType !== 'image/png' || !checks.get(checkId).artifactPaths.includes(screen.artifactPath)) {
            throw new Error(`Missing labeled actual-module screenshot at ${width}×${height}`);
          }
          const dimensions = pngDimensions(file);
          if (dimensions.width !== width || dimensions.height !== height) throw new Error('PNG dimensions differ from their declared viewport');
        }
      }
      if (entry.kind === 'two-client') {
        const clients = report.clients;
        if (!Array.isArray(clients) || clients.length < 2 || clients.length > 8 || clients.some(item => !shortString(item.id) || !shortString(item.userId)) ||
          new Set(clients.map(item => item.id)).size !== clients.length || new Set(clients.map(item => item.userId)).size < 2 ||
          !clients.some(item => item.role === 'gm') || !clients.some(item => item.role === 'player')) throw new Error('Two-client evidence needs distinct GM and player clients/users');
      }
      if (entry.kind === 'native-operations') {
        if (!Array.isArray(report.operations) || report.operations.length > 32) throw new Error('Native evidence must identify executed adapter operations');
        for (const id of REQUIRED_EVIDENCE['native-operations']) {
          const operation = report.operations.find(item => item.id === id);
          if (!operation || !shortString(operation.adapterOperation) || !shortString(operation.requestId) || !shortString(operation.receiptId) ||
            !Array.isArray(operation.documentUuids) || !operation.documentUuids.length || operation.documentUuids.some(value => !shortString(value, 256))) {
            throw new Error(`Native operation needs an adapter call, request, receipt and document references: ${id}`);
          }
        }
      }
    } catch (error) { block(`evidence-${entry.kind}`, error.message); }
  }
  for (const kind of Object.keys(REQUIRED_EVIDENCE)) if (!seen.has(kind)) block(`missing-${kind}`, `No hashed ${kind} report has been supplied`);

  const liveEnvironments = [...reports].filter(([kind]) => kind !== 'local-checks').map(([, report]) => report.environment);
  if (liveEnvironments.length > 1 && liveEnvironments.some(env => env?.worldId !== liveEnvironments[0]?.worldId || env?.foundryVersion !== liveEnvironments[0]?.foundryVersion || env?.systemVersion !== liveEnvironments[0]?.systemVersion)) {
    block('environment-binding', 'Live, visual, native and two-client reports must identify the same test world and versions');
  }
  if (!shortString(trustedReviewer, 80)) block('trusted-reviewer', 'Trusted reviewer identity must come from independent release configuration');
  try {
    const review = (await metadata(root, reviewPath)).value;
    if (review.format !== 'astra-release-review-v1' || review.decision !== 'approve-stable' || review.reviewer !== trustedReviewer ||
      !candidate || !sameBinding(review.candidate, candidate)) throw new Error('Review must approve the exact candidate and match the separately configured reviewer');
    const reviewedAt = Date.parse(review.reviewedAt);
    if (!Number.isFinite(reviewedAt) || reviewedAt > now + 300000 || [...reports.values()].some(report => Date.parse(report.run?.completedAt) > reviewedAt)) throw new Error('Review must occur after its evidence runs');
    const refKey = ref => `${ref.kind}\0${ref.path}\0${ref.sha256}`;
    if (!Array.isArray(review.evidence) || review.evidence.length !== evidenceRefs.length ||
      review.evidence.map(refKey).sort().join('\n') !== evidenceRefs.map(refKey).sort().join('\n')) throw new Error('Review must enumerate the exact hashed evidence files');
  } catch (error) { block('review', error.message); }
  result.ready = reasons.length === 0;
  return result;
}

async function cli() {
  const names = new Map([['--root', 'root'], ['--evidence', 'evidencePath'], ['--review', 'reviewPath'], ['--package', 'packagePath'], ['--channel', 'channel'],
    ['--expected-version', 'expectedVersion'], ['--trusted-reviewer', 'trustedReviewer'], ['--expected-repository', 'expectedRepository']]);
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]);
    if (!name || options[name] != null || !shortString(args[i + 1], 512)) throw new Error(`Unknown, duplicate or incomplete gate option: ${args[i]}`);
    options[name] = args[i + 1];
  }
  const result = await evaluateReadiness(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ready ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { process.stderr.write(`Release gate failed: ${error.message}\n`); process.exitCode = 2; });
}
