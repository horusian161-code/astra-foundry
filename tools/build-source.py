#!/usr/bin/env python3
"""Separate reproducible source handoff, never an additional Foundry module."""
import json
import pathlib
import zipfile

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'module.json').read_text(encoding='utf-8'))
excluded = {'node_modules', 'dist', '.git', '__pycache__'}
files = sorted((p for p in root.rglob('*') if p.is_file() and not p.is_symlink()
                and not any(part in excluded for part in p.relative_to(root).parts)
                and p.suffix != '.pyc'), key=lambda p: p.relative_to(root).as_posix())
out = root / 'dist' / f"Astra-Foundry-{manifest['version']}-Source.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        member = zipfile.ZipInfo(f"astra-foundry/{file.relative_to(root).as_posix()}", (2020, 1, 1, 0, 0, 0))
        member.compress_type = zipfile.ZIP_DEFLATED
        member.create_system = 3
        member.external_attr = 0o100644 << 16
        archive.writestr(member, file.read_bytes(), compresslevel=9)
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
print(json.dumps({'path': str(out), 'bytes': out.stat().st_size, 'files': len(files)}))
