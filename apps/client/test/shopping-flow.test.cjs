const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
const ROOT = path.resolve(__dirname, '..');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode=statusCode; } }
const context={householdId:'house-a',membershipId:'member-a',effectivePermissions:{shopping:'EDIT',inventory:'EDIT'}};
const item={id:'item-a',version:4,name:'番茄',quantity:'2',unit:'个',status:'PURCHASED'};
const stock={id:'stock-a',version:7,ingredient:{name:'番茄',kind:'FOOD'},quantity:'350',unit:'g',location:'厨房',availability:'PRESENT',expiresAt:'2026-09-10T16:00:00Z'};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{resolve,reject,promise};}
const tick=()=>new Promise(setImmediate);
function evaluate(source,deps,uni){
  const module={exports:{}};const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unexpected import '+id);},uni,Date,Error,Map,Promise,console});return module.exports;
}
const dates=evaluate(fs.readFileSync(path.join(ROOT,'src/services/trip-form.ts'),'utf8'),{},{});
function form(api={},access){
  let stored=context;const life={},toasts=[];
  const uni={showToast:value=>toasts.push(value.title)};
  const deps={vue,'@dcloudio/uni-app':{onShow:fn=>life.show=fn,onHide:fn=>life.hide=fn,onUnload:fn=>life.unload=fn},
    '../../services/session':{getStoredSession:()=>stored,refreshAccess:async()=>access?access():stored,canAccess:(c,m,l='VIEW')=>({VIEW:1,EDIT:2,MANAGE:3}[c?.effectivePermissions?.[m]]||0)>={VIEW:1,EDIT:2,MANAGE:3}[l]},
    '../../services/transport':{ApiError},'../../services/trip-form':dates,
    '../../services/family-api':{listShoppingLists:async()=>[{items:[item]}],listInventory:async()=>[stock],...api}};
  const filename=path.join(ROOT,'src/pages/shopping/index.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const page=evaluate(compileScript(descriptor,{id:'shopping-test',inlineTemplate:false}).content,deps,uni).default.setup({},{expose(){}});
  return{page,life,toasts,setStored:value=>stored=value};
}

test('Shopping and stock privacy: hide/unload clears lists, forms and ignores old reads',async()=>{
  for(const end of ['hide','unload']){
    const waiting=deferred(),{page,life}=form({listInventory:()=>waiting.promise});
    const pending=life.show();await tick();page.newItem.value.name='私人愿望';page.stockItem.value.location='私有位置';life[end]();waiting.resolve([stock]);await pending;
    assert.equal(page.items.value.length,0);assert.equal(page.inventory.value.length,0);assert.equal(page.session.value,undefined);assert.equal(page.newItem.value.name,'');assert.equal(page.stockItem.value.name,'');assert.equal(page.loading.value,false);
    if(end==='unload'){await life.show();assert.equal(page.items.value.length,0);}
  }
});
test('Newest refresh wins; stale errors do not replace new lists or show a toast',async()=>{
  for(const rejected of [false,true]){
    const waiting=deferred();let reads=0;const{page,life,toasts}=form({listShoppingLists:()=>++reads===1?waiting.promise:Promise.resolve([{items:[{...item,id:'new'}]}])});
    const old=life.show();await tick();await life.show();if(rejected)waiting.reject(Error('旧失败'));else waiting.resolve([{items:[item]}]);await old;
    assert.equal(page.items.value[0].id,'new');assert.equal(page.loading.value,false);assert.equal(toasts.length,0);
  }
});
test('Identity change during auth or reads clears private data and stops dependent requests',async()=>{
  const auth=deferred();let reads=0;const first=form({listShoppingLists:async()=>{reads++;return[];}},()=>auth.promise);
  const pending=first.life.show();first.setStored({...context,householdId:'house-b'});auth.resolve(context);await pending;assert.equal(reads,0);assert.equal(first.page.session.value,undefined);
  const wait=deferred(),second=form({listInventory:()=>wait.promise});const late=second.life.show();await tick();second.setStored({...context,membershipId:'member-b'});wait.resolve([stock]);await late;
  assert.equal(second.page.inventory.value.length,0);assert.equal(second.page.items.value.length,0);assert.match(second.page.errorText.value,/账号或家庭/);
});
test('Denied modules do not read or write and inventory-only access selects the available tab',async()=>{
  let shopping=0,stocks=0,writes=0;const f=form({listShoppingLists:async()=>{shopping++;return[];},listInventory:async()=>{stocks++;return[stock];},addShoppingItem:async()=>writes++,setInventoryItem:async()=>writes++});
  f.setStored({...context,effectivePermissions:{inventory:'VIEW'}});await f.life.show();await f.page.createItem();await f.page.saveStock();
  assert.equal(shopping,0);assert.equal(stocks,1);assert.equal(writes,0);assert.equal(f.page.active.value,'inventory');
});
test('Shopping validates fields before writes, trims data, and supports all three pending categories',async()=>{
  const sent=[],{page,life}=form({addShoppingItem:async data=>sent.push(data)});await life.show();
  for(const value of ['0','-1','1e3','Infinity','1.0001','1000000000','abc']){page.newItem.value={name:'番茄',quantity:value,unit:'个'};await page.createItem();}
  page.newItem.value={name:' '.repeat(2),quantity:'1',unit:'个'};await page.createItem();page.newItem.value={name:'a'.repeat(81),quantity:'1',unit:'个'};await page.createItem();
  page.newItem.value={name:'番茄',quantity:'1',unit:'x'.repeat(13)};await page.createItem();assert.equal(sent.length,0);
  for(let index=0;index<3;index++){page.newStatus.value=index;page.newItem.value={name:' 番茄 ',quantity:index===0?'':'0.001',unit:' 个 '};await page.createItem();}
  assert.equal(sent.length,3);assert.deepEqual(sent.map(x=>x.status),['WISHLIST','NEXT_TRIP','REPLENISH']);assert.equal(sent[0].quantity,undefined);assert.equal(sent[1].quantity,0.001);assert.equal(sent[0].name,'番茄');assert.equal(sent[0].unit,'个');assert.equal(page.newItem.value.name,'');
});
test('Only current item versions can change status; buying does not call inventory APIs',async()=>{
  let inventoryWrites=0;const sent=[],{page,life}=form({updateShoppingItem:async(row,status)=>sent.push({row,status}),setInventoryItem:async()=>inventoryWrites++});await life.show();
  await page.setStatus({...item,version:3},'NEXT_TRIP');assert.equal(sent.length,0);await page.setStatus(item,'NEXT_TRIP');
  assert.equal(sent[0].row.version,4);assert.equal(sent[0].status,'NEXT_TRIP');page.items.value=[{...item,status:'NEXT_TRIP'}];await page.setStatus(page.items.value[0],'PURCHASED');assert.equal(sent[1].status,'PURCHASED');assert.equal(inventoryWrites,0);
});
test('Single-flight survives hide/show; old write cannot clear new form or toast',async()=>{
  const waiting=deferred();let writes=0,reads=0;const{page,life,toasts}=form({addShoppingItem:()=>{writes++;return waiting.promise;},listShoppingLists:async()=>{reads++;return[{items:[item]}];}});
  await life.show();page.newItem.value.name='旧物品';const pending=page.createItem();await page.createItem();page.switchView('inventory');assert.equal(page.active.value,'shopping');
  life.hide();await life.show();page.newItem.value.name='新草稿';await page.createItem();assert.equal(writes,1);waiting.resolve(item);await pending;
  assert.equal(page.newItem.value.name,'新草稿');assert.equal(page.writing.value,false);assert.equal(reads,2);assert.equal(toasts.length,0);assert.equal(page.reloadRequired.value,true);await page.createItem();assert.equal(writes,1);
});
test('An abandoned write invalidates a returning read that started before commit',async()=>{
  const saved=deferred(),rows=deferred();let reads=0;const{page,life}=form({addShoppingItem:()=>saved.promise,listShoppingLists:()=>++reads===1?Promise.resolve([{items:[item]}]):rows.promise});
  await life.show();page.newItem.value.name='新买的';const write=page.createItem();life.hide();const refresh=life.show();await tick();saved.resolve(item);await write;
  rows.resolve([{items:[item]}]);await refresh;assert.equal(page.items.value.length,0);assert.equal(page.reloadRequired.value,true);assert.equal(page.loading.value,false);assert.match(page.errorText.value,/刷新数据确认结果/);
});
test('Repeat retries reuse request ids for one identity, not another; purchased history remains',async()=>{
  const ids=[];let failure=true;const{page,life,setStored}=form({repeatShoppingItem:async(id,requestId)=>{ids.push(requestId);if(failure)throw Error('不确定的网络结果');return item;}});
  await life.show();await page.repeat(item);life.hide();await life.show();await page.repeat(item);assert.equal(ids[0],ids[1]);
  setStored({...context,householdId:'house-b'});await life.show();failure=false;await page.repeat(item);assert.notEqual(ids[1],ids[2]);assert.equal(page.items.value[0].id,item.id);assert.equal(page.items.value[0].status,'PURCHASED');
  await page.repeat({...item,status:'NEXT_TRIP',version:3});assert.equal(ids.length,3);
});
test('Manual stock input matches DTO: zero allowed, unknown blank, seasoning omits quantity/unit',async()=>{
  const sent=[],{page,life}=form({setInventoryItem:async input=>sent.push(input)});await life.show();
  assert.equal(page.stockText({...stock,quantity:null,availability:'PRESENT'}),'有 · 数量待确认');assert.equal(page.stockText({...stock,quantity:'0',availability:'ABSENT'}),'0 g');assert.equal(page.stockText({...stock,ingredient:{kind:'SEASONING'},quantity:null,availability:'UNKNOWN'}),'待确认');
  page.stockItem.value={...page.stockItem.value,name:' 番茄 ',quantity:'0',unit:' g '};await page.saveStock();assert.equal(sent[0].quantity,0);assert.equal(sent[0].availability,undefined);assert.equal(sent[0].name,'番茄');
  page.stockItem.value={...page.stockItem.value,name:'鸡蛋',quantity:'',availability:'UNKNOWN'};await page.saveStock();assert.equal(sent[1].quantity,undefined);assert.equal(sent[1].availability,'UNKNOWN');
  page.chooseKind('SEASONING');page.stockItem.value.name='盐';page.stockItem.value.quantity='999';page.stockItem.value.unit='g';page.chooseAvailability('PRESENT');await page.saveStock();assert.equal(sent[2].kind,'SEASONING');assert.equal(sent[2].quantity,undefined);assert.equal(sent[2].unit,undefined);assert.equal(sent[2].availability,'PRESENT');
});
test('Inventory editor captures original version and Shanghai expiry; clearing date omits expiry for server full replacement',async()=>{
  const sent=[],{page,life}=form({setInventoryItem:async input=>sent.push(input)});await life.show();page.editStock(stock);assert.equal(page.stockItem.value.expiresAt,'2026-09-11');
  page.chooseKind('SEASONING');assert.equal(page.stockItem.value.kind,'FOOD');page.stockItem.value.quantity='200.125';page.chooseExpiry('');await page.saveStock();
  assert.equal(sent[0].id,'stock-a');assert.equal(sent[0].expectedVersion,7);assert.equal(sent[0].quantity,200.125);assert.equal(sent[0].location,'厨房');assert.equal(sent[0].expiresAt,undefined);assert.equal(page.editingStock.value,undefined);
  page.editStock(stock);page.chooseExpiry('2026-10-01');await page.saveStock();assert.equal(sent[1].expiresAt,'2026-10-01T23:59:59+08:00');
});
test('Invalid stock values or impossible dates send no writes; conflict retains draft and version',async()=>{
  let writes=0;const{page,life}=form({setInventoryItem:async()=>{writes++;throw new ApiError('版本冲突',409);}});await life.show();page.editStock(stock);
  for(const value of ['-1','1.2345','1e3','1000000000']){page.stockItem.value.quantity=value;await page.saveStock();}page.stockItem.value.quantity='5';page.chooseExpiry('2026-02-30');await page.saveStock();assert.equal(writes,0);
  page.chooseExpiry('2026-02-28');await page.saveStock();assert.equal(writes,1);assert.equal(page.stockItem.value.quantity,'5');assert.equal(page.editingStock.value.version,7);assert.equal(page.writing.value,false);assert.match(page.errorText.value,/版本冲突/);
});
test('Stock editor cannot switch targets, reset or change selectors while saving; payload is captured',async()=>{
  const waiting=deferred(),sent=[],other={...stock,id:'stock-b'};const{page,life}=form({listInventory:async()=>[stock,other],setInventoryItem:input=>{sent.push(input);return waiting.promise;}});await life.show();page.editStock(stock);page.stockItem.value.quantity='100';const pending=page.saveStock();
  page.editStock(other);page.resetStock();page.chooseExpiry('');page.chooseAvailability('ABSENT');assert.equal(page.editingStock.value.id,stock.id);assert.equal(page.stockItem.value.expiresAt,'2026-09-11');assert.equal(page.stockItem.value.availability,'PRESENT');
  page.stockItem.value.quantity='999';await page.saveStock();assert.equal(sent.length,1);assert.equal(sent[0].quantity,100);waiting.resolve(stock);await pending;
});
test('Successful write with failed reload blocks retry and distinguishes saved state from failure',async()=>{
  let reads=0,writes=0;const{page,life}=form({listShoppingLists:async()=>{if(++reads===2)throw Error('刷新断网');return[{items:[item]}];},addShoppingItem:async()=>writes++});await life.show();page.newItem.value.name='纸巾';await page.createItem();
  assert.equal(writes,1);assert.equal(page.reloadRequired.value,true);assert.equal(page.items.value.length,0);assert.match(page.errorText.value,/已保存.*刷新失败/);page.newItem.value.name='纸巾';await page.createItem();assert.equal(writes,1);await page.loadPage();assert.equal(page.reloadRequired.value,false);assert.equal(page.items.value.length,1);
});
test('401/403 on mutations or followup reads clear private state, while 409 keeps shopping draft',async()=>{
  for(const status of [401,403,409])for(const followup of [false,true]){
    let reads=0;const{page,life}=form({addShoppingItem:async()=>{if(!followup)throw new ApiError('拒绝',status);},listShoppingLists:async()=>{if(++reads>1&&followup)throw new ApiError('拒绝',status);return[{items:[item]}];}});
    await life.show();page.newItem.value.name='私人草稿';await page.createItem();assert.equal(page.writing.value,false);
    if(status!==409){assert.equal(page.items.value.length,0);assert.equal(page.inventory.value.length,0);assert.equal(page.session.value,undefined);assert.equal(page.newItem.value.name,'');}
    else if(!followup){assert.equal(page.newItem.value.name,'私人草稿');assert.equal(page.items.value.length,1);}
  }
});
test('Live permission revocation or account change prevents direct-handler writes',async()=>{
  for(const change of ['permission','identity']){
    let writes=0;const{page,life,setStored}=form({updateShoppingItem:async()=>writes++,setInventoryItem:async()=>writes++});await life.show();page.editStock(stock);
    setStored(change==='permission'?{...context,effectivePermissions:{shopping:'VIEW',inventory:'VIEW'}}:{...context,membershipId:'other'});
    await page.setStatus(item,'NEXT_TRIP');await page.saveStock();assert.equal(writes,0);assert.equal(page.items.value.length,0);assert.equal(page.inventory.value.length,0);
  }
});
