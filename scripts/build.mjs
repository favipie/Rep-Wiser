import {spawnSync} from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const r=spawnSync(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk('out/_next/static').filter(p=>/\.(js|css|woff2)$/.test(p)).map(p=>'/'+p.replaceAll('\\','/').replace(/^out\//,''));
fs.writeFileSync('out/offline-assets.json',JSON.stringify(files));
const digest=createHash('sha256').update(files.join('\n')).digest('hex').slice(0,12);const sw=fs.readFileSync('out/sw.js','utf8').replace('repwise-shell-v1','repwise-shell-'+digest);fs.writeFileSync('out/sw.js',sw);
