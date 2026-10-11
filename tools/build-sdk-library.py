"""Build an optional neutral v12 library from the exact tested SDK sources."""
import hashlib, json, pathlib, shutil, zipfile

root = pathlib.Path(__file__).resolve().parents[1]
out = root / 'dist'
stage = out / 'sdk-package' / 'astra-sdk-core'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True, exist_ok=True)
shutil.copytree(root / 'scripts/sdk', stage / 'scripts/sdk', dirs_exist_ok=True)
shutil.copy2(root / 'scripts/core/lifecycle.mjs', stage / 'scripts/lifecycle.mjs')
shutil.copy2(root / 'LICENSE', stage / 'LICENSE')
shutil.copy2(root / 'docs/SDK-LIBRARY.md', stage / 'README.md')
shutil.copy2(root / 'docs/sdk-operation-engine.md', stage / 'OPERATION-ENGINE.md')
shutil.copy2(root / 'docs/SDK-REUSE.md', stage / 'REUSE.md')
(stage / 'scripts/foundry-library.mjs').write_text("""import * as kernel from './sdk/index.mjs';
import {Scope,RefreshScheduler} from './lifecycle.mjs';
export const API=Object.freeze({version:'0.2.0-alpha',...kernel,Scope,RefreshScheduler});
Hooks.once('init',()=>{
  const module=game.modules.get('astra-sdk-core');
  if(module)module.api=API;
});
""")
manifest = {'id':'astra-sdk-core','title':'Astra SDK Core · Alpha','description':'Neutral operation engine, CAS storage, lifecycle and contracts. No system rules, Studio, sockets or game mutations are registered automatically.','version':'0.2.0-alpha.1','authors':[{'name':'Astra / REDLINE project'}],'compatibility':{'minimum':'12','maximum':'12.999'},'library':True,'esmodules':['scripts/foundry-library.mjs'],'license':'LICENSE'}
(stage/'module.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
hashes = {}
for p in sorted((root/'scripts/sdk').glob('*.mjs')):
    target=stage/'scripts/sdk'/p.name
    assert p.read_bytes()==target.read_bytes()
    hashes[str(target.relative_to(stage))]=hashlib.sha256(p.read_bytes()).hexdigest()
(stage/'SOURCE-HASHES.json').write_text(json.dumps(hashes,indent=2)+'\n')
archive=out/'astra-sdk-core-0.2.0-alpha.1.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(stage.rglob('*')):
        if p.is_file():z.write(p,'astra-sdk-core/'+p.relative_to(stage).as_posix())
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
archive.with_suffix('.sha256').write_text(digest+'  '+archive.name+'\n')
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':digest,'sourceCopiesVerified':True},indent=2))
