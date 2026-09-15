import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {seedDevices} from './seed_devices.mjs';
test('a previous seed receipt blocks a repeat before any bridge operation',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'seed-receipt-'));
  try{
    const manifest={documentUuid:'test-document',parts:[{key:'part'}]};
    const filename=path.join(dir,'manifest.json');fs.writeFileSync(filename,JSON.stringify(manifest));
    const digest=crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    fs.writeFileSync(path.join(dir,'seed-request-'+digest+'.json'),JSON.stringify({status:'requires-reconciliation'}));
    await assert.rejects(seedDevices(filename,'test-document',dir),/already attempted/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
