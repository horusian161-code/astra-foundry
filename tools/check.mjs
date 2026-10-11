import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=process.cwd(),manifest=JSON.parse(await fs.readFile(path.join(root,'module.json'),'utf8'));
if(manifest.compatibility.minimum!=='12'||manifest.compatibility.maximum!=='12.999'||'verified'in manifest.compatibility)throw Error('Compatibility must be v12 alpha without verified');
async function walk(directory){let result=[];for(const entry of await fs.readdir(directory,{withFileTypes:true})){const p=path.join(directory,entry.name);if(entry.isDirectory())result.push(...await walk(p));else result.push(p);}return result;}
const files=await walk(path.join(root,'scripts'));
for(const file of files.filter(file=>file.endsWith('.mjs'))){execFileSync(process.execPath,['--check',file]);const text=await fs.readFile(file,'utf8');for(const forbidden of [/\b(?:eval|Function)\s*\(/,/\.update\s*\(/,/\.updateEmbeddedDocuments\s*\(/,/\.createEmbeddedDocuments\s*\(/,/\.deleteEmbeddedDocuments\s*\(/,/\.nextTurn\s*\(/,/\.executeAsGM\s*\(/])if(forbidden.test(text))throw Error(`Forbidden game mutation/eval pattern in ${file}`);}
for(const file of [...manifest.esmodules,...manifest.styles,manifest.license,'templates/hud.hbs'])await fs.access(path.join(root,file));
console.log(`Checked ${files.length} runtime modules, manifest paths, v12 alpha metadata and explicit mutation-pattern guard.`);
