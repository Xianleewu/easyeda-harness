import test from 'node:test';import assert from 'node:assert/strict';import {auditSourceCatalogBindings} from './source_catalog_audit.mjs';
const L=(type,id,atom)=>JSON.stringify({type,id})+'||'+JSON.stringify(atom);
const part=(id,ref,value='1uF')=>[L('COMPONENT',id,{partId:'catalog.1'}),L('ATTR',id+'d',{parentId:id,key:'Designator',value:ref}),
  L('ATTR',id+'s',{parentId:id,key:'Symbol',value:'symbol'}),L('ATTR',id+'v',{parentId:id,key:'Device',value:'device'}),
  L('ATTR',id+'p',{parentId:id,key:'Supplier Part',value:'supplier-id'}),L('ATTR',id+'n',{parentId:id,key:'Name',value}),L('ATTR',id+'x',{parentId:id,key:'Value',value})];
const src=items=>items.flat().join('|\n');
test('an added placement passes only as an exact catalog clone of one verified donor',()=>{
  const before=src([part('a','C1')]),candidate=src([part('a','C1'),part('b','C2')]);
  const result=auditSourceCatalogBindings(before,candidate);assert.equal(result.pass,true);assert.equal(result.rows.at(-1).donor,'C1');
});
test('catalog clone audit catches the value mismatch that creates supplier warnings',()=>{
  const before=src([part('a','C1')]),candidate=src([part('a','C1'),part('b','C2','1uF / 50V')]);
  const result=auditSourceCatalogBindings(before,candidate);assert.equal(result.pass,false);assert.equal(result.findings[0].kind,'added-catalog-clone-unproven');
});
test('existing binding changes and removed fitted parts fail closed',()=>{
  const before=src([part('a','C1')]);
  assert.equal(auditSourceCatalogBindings(before,src([part('a','C1','2uF')])).pass,false);
  assert.equal(auditSourceCatalogBindings(before,src([])).findings[0].kind,'catalog-part-removed');
});
test('a catalog binding repair passes only with exact before/after values and verification source',()=>{
  const before=src([part('a','C1')]);
  const candidate=before.replace('"key":"Device","value":"device"','"key":"Device","value":"device-fixed"');
  const repairs={C1:{verified:true,source:'catalog readback',changes:{Device:{before:'device',current:'device-fixed'}}}};
  const ok=auditSourceCatalogBindings(before,candidate,{bindingRepairs:repairs});
  assert.equal(ok.pass,true);assert.equal(ok.rows[0].disposition,'verified-binding-repair');
  assert.equal(auditSourceCatalogBindings(before,candidate,{bindingRepairs:{C1:{...repairs.C1,source:''}}}).pass,false);
  assert.equal(auditSourceCatalogBindings(before,candidate,{bindingRepairs:{C1:{...repairs.C1,changes:{Device:{before:'other',current:'device-fixed'}}}}}).pass,false);
});
