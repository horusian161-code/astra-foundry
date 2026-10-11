/** Optional development bundler. Standalone output has no network or runtime imports. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let esbuild;
try{esbuild=require(process.env.ASTRA_ESBUILD_PATH?path.resolve(process.env.ASTRA_ESBUILD_PATH):'esbuild');}
catch{throw new Error('Self-contained workflow preview requires optional esbuild@0.25.12. Set ASTRA_ESBUILD_PATH to an existing package or install the pinned development dependency.');}
if(esbuild.version!=='0.25.12')throw new Error(`Expected esbuild 0.25.12; received ${esbuild.version}.`);
const template=await fs.readFile(path.join(root,'tools/workflow-preview.html'),'utf8');
const source=template.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
const result=await esbuild.build({stdin:{contents:source,resolveDir:path.join(root,'tools'),sourcefile:'workflow-preview-entry.mjs'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',legalComments:'none',minify:false});
const javascript=result.outputFiles[0].text;
execFileSync(process.execPath,['--check'],{input:javascript,encoding:'utf8'});
if(/\b(?:eval|Function)\s*\(/.test(javascript)||/^\s*import\s/m.test(javascript)||/\bimport\s*\(/.test(javascript))throw new Error('Forbidden runtime eval/import in standalone bundle');
const css=await fs.readFile(path.join(root,'styles/workflow.css'),'utf8');
const uiKitCSS=await fs.readFile(path.join(root,'styles/ui-kit.css'),'utf8');
const policy='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'none\'; font-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">';
const html=template.replace('<meta name="viewport"',`${policy}<meta name="viewport"`).replace('<link rel="stylesheet" href="../styles/workflow.css">',`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`).replace('<link rel="stylesheet" href="../styles/ui-kit.css">',`<style>${uiKitCSS.replace(/<\/style/gi,'<\\/style')}</style>`).replace(/<script type="module">[\s\S]*?<\/script>/,`<script>${javascript.replace(/<\/script/gi,'<\\/script')}</script>`);
if(/<(?:script|link)\b[^>]*(?:src=|href=)/i.test(html))throw new Error('External runtime asset reference remains');
const output=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'tools/REDLINE-Workflow-Alpha-0.3.html');
await fs.writeFile(output,html);
console.log(JSON.stringify({output,esbuildVersion:esbuild.version,bytes:Buffer.byteLength(html),sha256:crypto.createHash('sha256').update(html).digest('hex'),syntaxChecked:true,externalRuntimeImports:false,networkAllowed:false},null,2));
