#!/usr/bin/env python3
"""Build ONE deterministic Foundry runtime ZIP; no source archive or publishing."""
import hashlib
import json
import pathlib
import re
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
RUNTIME_ROOTS = ('scripts', 'styles', 'templates')
RUNTIME_FILES = ('module.json', 'LICENSE', 'README.md')
FINGERPRINT_ALGORITHM = 'sha256-runtime-path-index-v1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def runtime_files():
    result = []
    for name in RUNTIME_FILES:
        path = ROOT / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f'Missing regular runtime file: {name}')
        result.append(path)
    for name in RUNTIME_ROOTS:
        directory = ROOT / name
        if not directory.is_dir() or directory.is_symlink():
            raise ValueError(f'Missing regular runtime directory: {name}')
        for path in directory.rglob('*'):
            if path.is_symlink():
                raise ValueError(f'Symlinks are not distributable: {path.relative_to(ROOT)}')
            if path.is_file():
                result.append(path)
    return sorted(result, key=lambda item: item.relative_to(ROOT).as_posix().encode('utf-8'))


manifest = json.loads((ROOT / 'module.json').read_text(encoding='utf-8'))
module_id, version = manifest['id'], manifest['version']
if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', module_id):
    raise ValueError('Invalid module ID')
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?', version):
    raise ValueError('Invalid module version')

files = runtime_files()
index = []
for path in files:
    relative = path.relative_to(ROOT).as_posix()
    data = path.read_bytes()
    index.append({'path': relative, 'sha256': digest(data), 'bytes': len(data)})
fingerprint = digest(''.join(f"{item['path']}\0{item['sha256']}\n" for item in index).encode('utf-8'))

out = ROOT / 'dist'
out.mkdir(exist_ok=True)
archive = out / f'{module_id}-{version}.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for path in files:
        # Fixed timestamp and permissions make identical sources produce identical bytes.
        member = zipfile.ZipInfo(f'{module_id}/{path.relative_to(ROOT).as_posix()}', (2020, 1, 1, 0, 0, 0))
        member.compress_type = zipfile.ZIP_DEFLATED
        member.create_system = 3
        member.external_attr = 0o100644 << 16
        package.writestr(member, path.read_bytes(), compresslevel=9)

with zipfile.ZipFile(archive) as package:
    if package.testzip() is not None:
        raise ValueError('Runtime ZIP failed CRC validation')
    if len(package.namelist()) != len(index):
        raise ValueError('Runtime ZIP entry count differs from its source index')

package_sha = digest(archive.read_bytes())
archive.with_suffix('.sha256').write_text(f'{package_sha}  {archive.name}\n', encoding='utf-8')
build = {
    'format': 'astra-runtime-build-v1',
    'moduleId': module_id,
    'version': version,
    'fingerprintAlgorithm': FINGERPRINT_ALGORITHM,
    'sourceFingerprint': fingerprint,
    'archive': {'path': f'dist/{archive.name}', 'sha256': package_sha, 'bytes': archive.stat().st_size},
    'files': index
}
(out / 'build-manifest.json').write_text(json.dumps(build, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(build, ensure_ascii=False, indent=2))
