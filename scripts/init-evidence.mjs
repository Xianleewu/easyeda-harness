#!/usr/bin/env node
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const target=process.argv[2];if(!target)throw new Error('Usage: npm run evidence:init -- /absolute/path/token-evidence.json');
const out=path.resolve(target);if(existsSync(out))throw new Error(`Refusing to overwrite ${out}`);
mkdirSync(path.dirname(out),{recursive:true});
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
copyFileSync(path.join(root,'templates','token-evidence.template.json'),out);
console.log(`Created ${out}`);console.log('Edit every REPLACE_* value, then run EASYEDA_TOKEN_EVIDENCE='+out+' npm run wf -- lint');
