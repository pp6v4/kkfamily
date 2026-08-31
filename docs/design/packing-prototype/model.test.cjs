const test = require('node:test');
const assert = require('node:assert/strict');
const { createModel } = require('./packing-model.js');
const rows = names => names.map(name => ({ name }));
function fixture() { const m=createModel(); const t=m.saveTemplate('', '烧烤', rows(['1','2','3'])); return {m,t}; }

test('empty start; any name saves exactly the user items', () => {
  const m=createModel(); assert.deepEqual(m.snapshot().templates,[]); assert.deepEqual(m.snapshot().items,[]);
  for (const title of ['烧烤','露营','随便起名字','<script>不是代码</script>']) {
    const t=m.saveTemplate('',title,rows(['1','2','3']));
    assert.equal(t.name,title);assert.deepEqual(t.items.map(i=>i.name),['1','2','3']);
  }
  assert.equal(m.snapshot().items.length,0);
});
test('same source repeated: 3 added then 0 added, 3 skipped',()=>{
  const {m,t}=fixture();assert.deepEqual(m.preview([t.id]).details,[{id:t.id,name:'烧烤',added:3,skipped:0}]);
  assert.equal(m.apply([t.id,t.id]).added,3);const result=m.apply([t.id]);assert.equal(result.added,0);assert.equal(result.skipped,3);assert.equal(m.snapshot().items.length,3);
});
test('same names from different templates remain distinct',()=>{
  const m=createModel(), a=m.saveTemplate('','甲',rows(['水'])), b=m.saveTemplate('','乙',rows(['水']));
  assert.equal(m.apply([a.id,b.id]).added,2);assert.deepEqual(m.snapshot().items.map(i=>i.name),['水','水']);
});
test('template edits and archive preserve trip names, quantity and source snapshots',()=>{
  const {m,t}=fixture();m.apply([t.id]);const before=m.snapshot().items;
  m.saveTemplate(t.id,'周末烧烤',t.items.map(i=>({...i,name:'新'+i.name,quantity:'2'})));
  assert.deepEqual(m.snapshot().items,before);m.archiveTemplate(t.id);assert.deepEqual(m.snapshot().items,before);assert.throws(()=>m.apply([t.id]),/归档/);
});
test('editing a trip item does not change template or source-name snapshot',()=>{
  const {m,t}=fixture();m.apply([t.id]);const item=m.snapshot().items[0];
  m.editItem(item.id,{name:'本次特例',quantity:'2.5',unit:'件'});
  assert.deepEqual(m.snapshot().templates[0],t);assert.equal(m.snapshot().items[0].sourceItemName,'1');assert.equal(m.snapshot().items[0].quantity,'2.5');
});
test('stable item IDs survive reordering; a new item alone is added on next apply',()=>{
  const {m,t}=fixture();m.apply([t.id]);const changed=m.saveTemplate(t.id,'换序',[t.items[2],t.items[0],{name:'4'}]);
  assert.deepEqual(changed.items.slice(0,2).map(i=>i.id),[t.items[2].id,t.items[0].id]);const result=m.apply([t.id]);assert.equal(result.added,1);assert.equal(result.skipped,2);assert.equal(m.snapshot().items.length,4);
});
test('explicitly removed source is not resurrected by reapply; explicit restore resets preparation',()=>{
  const {m,t}=fixture();m.apply([t.id]);const key=m.snapshot().items[0].id;m.setPacked(key,true);m.exclude(key);
  assert.equal(m.apply([t.id]).added,0);assert.equal(m.snapshot().items.filter(i=>!i.excluded).length,2);
  m.restore(key);assert.equal(m.snapshot().items.filter(i=>!i.excluded).length,3);assert.equal(m.snapshot().items[0].packed,false);
});
test('responsible member and group are validated; invalid assignment is atomic',()=>{
  const {m,t}=fixture();m.apply([t.id]);const key=m.snapshot().items[0].id;
  m.assign(key,'g2','m3');assert.equal(m.snapshot().items[0].memberId,'m3');const before=m.snapshot();
  assert.throws(()=>m.assign(key,'g1','m3'),/所选小组/);assert.throws(()=>m.assign(key,'outside','m3'),/不属于/);assert.throws(()=>m.assign(key,'','outsider'),/本行程/);assert.deepEqual(m.snapshot(),before);
  m.assign(key,'g2','');assert.equal(m.snapshot().items[0].memberId,'');
});
test('being assigned does not bypass readonly for any mutation',()=>{
  const {m,t}=fixture();m.apply([t.id]);const key=m.snapshot().items[0].id;m.assign(key,'g1','m1');m.setReadOnly(true);const before=m.snapshot();
  for(const action of [()=>m.saveTemplate('','x',rows(['x'])),()=>m.archiveTemplate(t.id),()=>m.apply([t.id]),()=>m.addItem({name:'x'}),()=>m.editItem(key,{name:'x'}),()=>m.assign(key,'',''),()=>m.setPacked(key,true),()=>m.exclude(key),()=>m.restore(key)])assert.throws(action,/只读/);
  assert.deepEqual(m.snapshot(),before);
});
test('invalid template fields reject without partially changing state',()=>{
  const {m,t}=fixture();const before=m.snapshot();
  for(const quantity of ['0','-1','1e3','NaN','1.2345','1000001'])assert.throws(()=>m.saveTemplate(t.id,'x',[{...t.items[0],quantity}]),/数量/);
  assert.throws(()=>m.saveTemplate(t.id,' ',t.items),/模板名称/);
  assert.throws(()=>m.saveTemplate(t.id,'x',[]),/至少/);
  assert.throws(()=>m.saveTemplate(t.id,'x',[{name:' ',quantity:'1'}]),/物品名称/);
  assert.throws(()=>m.saveTemplate(t.id,'x',[t.items[0],t.items[0]]),/标识/);
  assert.deepEqual(m.snapshot(),before);
});
test('multiple-template apply validates all sources before any addition',()=>{
  const {m,t}=fixture();assert.throws(()=>m.apply([t.id,'missing']),/不存在/);assert.deepEqual(m.snapshot().items,[]);
});
test('manual item remains independent; unset quantity is not converted to zero',()=>{
  const m=createModel();const item=m.addItem({name:'临时带的',quantity:'',note:'只用这次'});assert.equal(item.quantity,'');assert.equal(item.sourceItemId,null);assert.equal(item.packed,false);assert.equal(item.memberId,'');assert.deepEqual(m.snapshot().templates,[]);
});
test('public snapshots cannot mutate internal state',()=>{
  const {m,t}=fixture();const s=m.snapshot();s.templates[0].name='外部篡改';t.items[0].name='外部篡改';assert.equal(m.snapshot().templates[0].name,'烧烤');assert.equal(m.snapshot().templates[0].items[0].name,'1');
});
