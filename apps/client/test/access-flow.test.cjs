const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
const ROOT = path.resolve(__dirname, '..');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
function loadTs(relative, dependencies, uni) {
  const source=fs.readFileSync(path.join(ROOT,relative),'utf8');
  return evaluate(source,dependencies,uni);
}
function evaluate(source, dependencies, uni) {
  const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  const module={exports:{}};
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require:id=>{if(id in dependencies)return dependencies[id];throw Error('Unexpected import '+id);},uni,console,setTimeout,clearTimeout,Map,Set,Promise,Error,Date}, {timeout:1000});
  return module.exports;
}
function loadPage(relative, dependencies, uni) {
  const filename=path.join(ROOT,relative), {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'component-test',inlineTemplate:false});
  const module=evaluate(script.content,{'vue':vue,'@dcloudio/uni-app':{onShow(){},onLoad(){}},...dependencies},uni);
  return module.default.setup({}, {expose(){}});
}
function mockUni() {
  const values=new Map(), routes=[];
  return { values,routes,getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value),removeStorageSync:key=>values.delete(key),login:input=>input.success({code:'fictional-login-code'}),navigateTo:input=>{routes.push(input.url);input.complete?.();},switchTab:input=>routes.push(input.url),showToast(){},showModal(){},setClipboardData(){} };
}
const family={householdId:'house-a',householdName:'虚构家庭',membershipId:'member-a',roles:['ADMIN'],accessToken:'fictional-token',version:1,effectivePermissions:{members:'MANAGE'}};
function allowed(context,module,level='VIEW') {const ranks={VIEW:1,EDIT:2,MANAGE:3};return (ranks[context?.effectivePermissions?.[module]]||0)>=ranks[level];}

test('New identity is directed to join, never automatically creates a separate household',async()=>{
  const uni=mockUni(),calls=[];
  const session=loadTs('src/services/session.ts',{'./transport':{ApiError,rawRequest:async(path,method)=>{calls.push([path,method]);return {accessToken:'fictional-token',user:{households:[]}};}}},uni);
  await assert.rejects(session.ensureSession(),/创建家庭或输入/);
  assert.deepEqual(calls,[['/auth/wechat/login','POST']]);
  assert.deepEqual(uni.routes,['/pages/join/index']); assert.equal(uni.values.has('kkfamily.householdContext'),false);
});
test('Permission refresh updates cached roles/versions and 403 clears stale household context',async()=>{
  const uni=mockUni();let deny=false;
  const session=loadTs('src/services/session.ts',{'./transport':{ApiError,rawRequest:async()=>{if(deny)throw new ApiError('成员已停用',403);return {roles:['GUEST'],version:2,permissionVersion:2,effectivePermissions:{recipes:'VIEW'}};}}},uni);
  session.rememberSession(family);const current=await session.refreshAccess();
  assert.equal(session.canAccess(current,'recipes'),true);assert.equal(session.canAccess(current,'members'),false);assert.equal(current.version,2);
  deny=true;await assert.rejects(session.refreshAccess(),/停用/);assert.equal(session.getStoredSession(),undefined);
});
test('Join component redeems explicit code, selects returned household, and never POSTs a new household',async()=>{
  const uni=mockUni(),calls=[];let stored;
  const page=loadPage('src/pages/join/index.vue',{'../../services/session':{ensureIdentity:async()=>({accessToken:'fictional-token',user:{households:[]}}),rememberSession:value=>stored=value},'../../services/transport':{rawRequest:async(path,method,body)=>{calls.push({path,method,code:body.code});return {membershipId:'member-b',roles:['MEMBER'],household:{id:'house-a',name:'虚构家庭'}};}}},uni);
  page.code.value='x'.repeat(32);await page.submit('join');
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/invitations/redeem');assert.equal(stored.householdId,'house-a');assert.equal(stored.membershipId,'member-b');assert.equal(page.code.value,'');assert.equal(page.busy.value,false);
});
test('Rejected join preserves input and exposes error instead of reporting success',async()=>{
  const uni=mockUni();let saved=false;
  const page=loadPage('src/pages/join/index.vue',{'../../services/session':{ensureIdentity:async()=>({accessToken:'fictional-token',user:{households:[]}}),rememberSession:()=>saved=true},'../../services/transport':{rawRequest:async()=>{throw new Error('邀请码已失效');}}},uni);
  page.code.value='x'.repeat(32);await page.submit('join');
  assert.equal(page.code.value,'x'.repeat(32));assert.match(page.error.value,/已失效/);assert.equal(saved,false);assert.equal(page.busy.value,false);assert.equal(uni.routes.length,0);
});
test('Permission editor previews DENY and preserves draft on version conflict',async()=>{
  const uni=mockUni();const target={id:'member-b',version:7,roles:['CHEF'],overrides:[],status:'ACTIVE',user:{id:'user-b',nickname:'示例成员'},effectivePermissions:{recipes:'EDIT'}};let submitted;
  const page=loadPage('src/pages/members/index.vue',{'../../services/session':{canAccess:allowed,refreshAccess:async()=>family},'../../services/members-api':{saveMemberPermissions:async(member,roles,overrides)=>{submitted={version:member.version,roles,overrides};throw new Error('成员已更新，请刷新后重试');}}},uni);
  page.session.value=family;page.catalog.value={CHEF:{recipes:'EDIT'}};page.edit(target);page.permissionChange('recipes',{detail:{value:'1'}});
  assert.equal(page.preview.value.recipes,undefined);await page.save();
  assert.equal(submitted.version,7);assert.equal(submitted.overrides[0].effect,'DENY');assert.equal(page.selected.value.id,'member-b');assert.equal(page.overrides.value[0].effect,'DENY');assert.match(page.error.value,/草稿已保留/);
});
test('Calendar navigation preserves date/source, and consumption is scoped and one-shot',()=>{
  const nav=loadTs('src/services/calendar-navigation.ts',{},mockUni());
  nav.setCalendarTarget({type:'TRIP',date:'2026-09-01',sourceId:'trip-a'});
  assert.equal(nav.takeCalendarTarget('MEAL'),undefined);const target=nav.takeCalendarTarget('TRIP');assert.equal(target.date,'2026-09-01');assert.equal(target.sourceId,'trip-a');assert.equal(nav.takeCalendarTarget('TRIP'),undefined);
});

const mealSession={...family,effectivePermissions:{meals:'MANAGE',recipes:'VIEW',inventory:'EDIT',shopping:'EDIT'}};
function mealRecord(overrides={}) {return {id:'meal-a',version:7,snapshotVersion:1,localDate:'2026-09-01',slotKey:'',scheduledAt:'2026-09-01T18:00:00+08:00',mealType:'DINNER',status:'CONFIRMED',legacyWithoutSnapshot:false,items:[],menu:[],...overrides};}
function mealDependencies(overrides={}) {
  return {'../../services/session':{canAccess:allowed,refreshAccess:async()=>mealSession},'../../services/calendar-navigation':{takeCalendarTarget:()=>undefined},'../../services/family-api':{
    mealTypeCodes:{早餐:'BREAKFAST',午餐:'LUNCH',晚餐:'DINNER',加餐:'OTHER'},mealTypeLabel:()=> '晚餐',listMeals:async()=>[],listRecipes:async()=>[],recalculateMeal:async()=>[],listMealSnapshots:async()=>[],...overrides,
  }};
}
test('Meal confirmation modal never confirms when the user cancels',async()=>{
  const uni=mockUni();let modal,transitions=0;
  uni.showModal=input=>modal=input;
  const page=loadPage('src/pages/meal/index.vue',mealDependencies({transitionMeal:async meal=>{transitions++;return {...meal,status:'CONFIRMED'};}}),uni);
  page.session.value=mealSession;page.meal.value=mealRecord({status:'DRAFT',version:3});
  page.confirmAction('confirm');await modal.success({confirm:false,cancel:true});assert.equal(transitions,0);
  page.confirmAction('confirm');await modal.success({confirm:true,cancel:false});assert.equal(transitions,1);
});
test('Meal completion confirms explicitly, is retryable, and has no stock payload',async()=>{
  const uni=mockUni(),requests=[];let modal,fail=true;
  uni.showModal=input=>modal=input;
  const page=loadPage('src/pages/meal/index.vue',mealDependencies({completeMeal:async meal=>{requests.push(meal);if(fail)throw Error('网络中断');return mealRecord({status:'COMPLETED',version:8});}}),uni);
  page.session.value=mealSession;page.meal.value=mealRecord();page.finishCooking();await modal.success({confirm:false,cancel:true});assert.equal(requests.length,0);
  page.finishCooking();await modal.success({confirm:true,cancel:false});assert.equal(requests[0].version,7);assert.match(page.errorText.value,/网络中断/);
  fail=false;page.finishCooking();await modal.success({confirm:true,cancel:false});assert.equal(requests[1].version,7);
});
test('Shopping repeat reuses one request id after failure and status update carries the item version',async()=>{
  const uni=mockUni(),repeatIds=[],updates=[];let fail=true;
  const item={id:'shopping-a',version:6,name:'番茄',quantity:'2',unit:'个',status:'PURCHASED',sourceType:'MANUAL',sourceId:null,sourceVersion:null,purchasedAt:'2026-09-01',previousItemId:null};
  const page=loadPage('src/pages/shopping/index.vue',{'../../services/session':{canAccess:allowed,refreshAccess:async()=>mealSession},'../../services/family-api':{listShoppingLists:async()=>[],listInventory:async()=>[],repeatShoppingItem:async(_,requestId)=>{repeatIds.push(requestId);if(fail)throw Error('暂时失败');return item;},updateShoppingItem:async(value,status)=>{updates.push({value,status});return value;}}},uni);
  page.session.value=mealSession;await page.repeat(item);fail=false;await page.repeat(item);
  assert.equal(repeatIds[0],repeatIds[1]);await page.setStatus(item,'NEXT_TRIP');assert.equal(updates[0].value.version,6);assert.equal(updates[0].status,'NEXT_TRIP');
});
test('Family API serializes optimistic shopping version instead of a blind status write',async()=>{
  const uni=mockUni();let sent;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent={path,method,data};return data;}}},uni);
  const item={id:'shopping-a',version:9,status:'NEXT_TRIP'};await api.updateShoppingItem(item,'PURCHASED');
  assert.equal(sent.path,'/shopping-lists/items/shopping-a');assert.equal(sent.method,'PATCH');assert.equal(sent.data.expectedVersion,9);assert.equal(sent.data.status,'PURCHASED');
});
test('Media client uploads bytes only through authenticated API path and builds same-domain read URL',async()=>{
  const uni=mockUni();let binary;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawRequest:async()=>({}),rawBinaryRequest:async(path,method,data,mime,headers)=>{binary={path,method,data,mime,headers};return{checksumSha256:'a'.repeat(64)};}}},uni);
  const bytes=new ArrayBuffer(8);await api.uploadMediaContent('/media/upload-intents/i/content',bytes,'image/png');
  assert.equal(binary.path,'/media/upload-intents/i/content');assert.equal(binary.method,'PUT');assert.equal(binary.data,bytes);assert.equal(binary.mime,'image/png');assert.match(binary.headers.Authorization,/^Bearer /);assert.equal(binary.headers['X-Household-Id'],family.householdId);
  assert.equal(api.publicMediaUrl('/media/public/token'),'https://example.test/api/v1/media/public/token');
});
