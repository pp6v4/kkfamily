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
test('Expired access token shares one rotation across identity and household renewal',async()=>{
  const uni=mockUni(),calls=[];let wechatLoginCalls=0;
  uni.login=input=>{wechatLoginCalls++;input.success({code:'should-not-be-used'});};
  uni.setStorageSync('kkfamily.accessToken','expired-access');uni.setStorageSync('kkfamily.refreshToken','old-refresh');
  const renewed={accessToken:'new-access',refreshToken:'new-refresh',user:{households:[{membershipId:'member-a',household:{id:'house-a',name:'虚构家庭'},status:'ACTIVE',roles:['MEMBER']}]}};
  const session=loadTs('src/services/session.ts',{'./transport':{ApiError,rawRequest:async(path,method,data)=>{calls.push({path,method,data});if(path==='/auth/me')throw new ApiError('expired',401);if(path==='/auth/refresh')return renewed;throw Error('Unexpected '+path);}}},uni);
  const [result,same,context]=await Promise.all([session.ensureIdentity(),session.ensureIdentity(),session.renewSession('house-a')]);assert.equal(result.accessToken,'new-access');assert.equal(same.accessToken,'new-access');assert.equal(context.accessToken,'new-access');assert.equal(uni.getStorageSync('kkfamily.refreshToken'),'new-refresh');assert.equal(wechatLoginCalls,0);
  assert.deepEqual(calls.map(item=>item.path),['/auth/me','/auth/refresh']);assert.equal(calls[1].data.refreshToken,'old-refresh');
});
test('Identity-scoped create or join retries once and returns the renewed access token',async()=>{
  const uni=mockUni(),calls=[];let joinAttempt=0,wechatLoginCalls=0;
  uni.login=input=>{wechatLoginCalls++;input.success({code:'should-not-be-used'});};
  uni.setStorageSync('kkfamily.accessToken','old-access');uni.setStorageSync('kkfamily.refreshToken','old-refresh');
  const user={households:[]},renewed={accessToken:'new-access',refreshToken:'new-refresh',user};
  const session=loadTs('src/services/session.ts',{'./transport':{ApiError,rawRequest:async(path,method,data,headers)=>{
    calls.push({path,method,data,headers});
    if(path==='/auth/me')return{user};
    if(path==='/auth/refresh')return renewed;
    if(path==='/invitations/redeem'&&joinAttempt++===0)throw new ApiError('expired',401);
    if(path==='/invitations/redeem')return{membershipId:'member-b'};
    throw Error('Unexpected '+path);
  }}},uni);
  const result=await session.identityRequest('/invitations/redeem','POST',{code:'fictional-code'});
  assert.equal(result.data.membershipId,'member-b');assert.equal(result.identity.accessToken,'new-access');assert.equal(wechatLoginCalls,0);
  assert.deepEqual(calls.map(item=>item.path),['/auth/me','/invitations/redeem','/auth/refresh','/invitations/redeem']);
  assert.equal(calls[1].headers.Authorization,'Bearer old-access');assert.equal(calls[3].headers.Authorization,'Bearer new-access');
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
  const current={accessToken:'fictional-token',user:{households:[]}};
  const page=loadPage('src/pages/join/index.vue',{'../../services/session':{ensureIdentity:async()=>current,identityRequest:async(path,method,body)=>{calls.push({path,method,code:body.code});return {identity:current,data:{membershipId:'member-b',roles:['MEMBER'],household:{id:'house-a',name:'虚构家庭'}}};},rememberSession:value=>stored=value}},uni);
  page.code.value='x'.repeat(32);await page.submit('join');
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/invitations/redeem');assert.equal(stored.householdId,'house-a');assert.equal(stored.membershipId,'member-b');assert.equal(page.code.value,'');assert.equal(page.busy.value,false);
});
test('Rejected join preserves input and exposes error instead of reporting success',async()=>{
  const uni=mockUni();let saved=false;
  const page=loadPage('src/pages/join/index.vue',{'../../services/session':{ensureIdentity:async()=>({accessToken:'fictional-token',user:{households:[]}}),identityRequest:async()=>{throw new Error('邀请码已失效');},rememberSession:()=>saved=true}},uni);
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
test('My home displays the approved ICP subject number and supports copying it',()=>{
  const source=fs.readFileSync(path.join(ROOT,'src/pages/profile/index.vue'),'utf8');
  assert.match(source,/辽ICP备2026020161号/);
  assert.match(source,/备案主体号/);
  assert.match(source,/setClipboardData/);
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
test('Family API retries an access-token 401 once with the same household after renewal',async()=>{
  const uni=mockUni(),sent=[];let attempt=0;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,renewSession:async preferred=>{assert.equal(preferred,'house-a');return{...family,accessToken:'renewed-token'};}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data,headers)=>{sent.push({path,method,data,headers});if(attempt++===0)throw new ApiError('expired',401);return[];}}},uni);
  await api.listRecipes();assert.equal(sent.length,2);assert.match(sent[0].headers.Authorization,/fictional-token/);assert.match(sent[1].headers.Authorization,/renewed-token/);assert.equal(sent[1].headers['X-Household-Id'],'house-a');
});
test('Camping API carries template and packing-item versions for safe updates',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const item={id:'packing-a',version:4,status:'PENDING'};
  await api.updatePackingTemplate({id:'template-a',version:6},{name:'新版模板'});
  await api.updateTripPackingItem('trip-a',item,{status:'PACKED'});await api.removeTripPackingItem('trip-a',item);
  assert.equal(sent[0].path,'/packing-templates/template-a');assert.equal(sent[0].method,'PATCH');assert.equal(sent[0].data.expectedVersion,6);assert.equal(sent[0].data.name,'新版模板');
  assert.equal(sent[1].path,'/trips/trip-a/packing-items/packing-a');assert.equal(sent[1].method,'PATCH');assert.equal(sent[1].data.expectedVersion,4);assert.equal(sent[1].data.status,'PACKED');
  assert.equal(sent[2].path,'/trips/trip-a/packing-items/packing-a?expectedVersion=4');assert.equal(sent[2].method,'DELETE');
});
test('Itinerary API carries trip and item versions, including confirmed stop removal',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const trip={id:'trip-a',version:7},stop={id:'stop-a',version:3};
  await api.createTripStop(trip,{title:'示例营地',stopType:'CAMPSITE',latitude:40.1,longitude:116.2});
  await api.removeTripStop(trip,stop,true);
  assert.equal(sent[0].path,'/trips/trip-a/stops');assert.equal(sent[0].method,'POST');assert.equal(sent[0].data.expectedTripVersion,7);
  assert.equal(sent[1].path,'/trips/trip-a/stops/stop-a?expectedVersion=3&expectedTripVersion=7&confirm=true');assert.equal(sent[1].method,'DELETE');
});
test('Trip and preparation-group edits carry their current versions',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  await api.updateTrip({id:'trip-a',version:7},{title:'新行程',endsAt:null});
  await api.updateTripPreparationGroup('trip-a',{id:'group-a',version:4},'我们家',['member-a']);
  assert.equal(sent[0].path,'/trips/trip-a');assert.equal(sent[0].data.expectedVersion,7);assert.equal(sent[0].data.endsAt,null);
  assert.equal(sent[1].path,'/trips/trip-a/preparation-groups/group-a');assert.equal(sent[1].data.expectedVersion,4);assert.deepEqual(sent[1].data.membershipIds,['member-a']);
});
test('Media client uploads bytes only through authenticated API path and builds same-domain read URL',async()=>{
  const uni=mockUni();let binary;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawRequest:async()=>({}),rawBinaryRequest:async(path,method,data,mime,headers)=>{binary={path,method,data,mime,headers};return{checksumSha256:'a'.repeat(64)};}}},uni);
  const bytes=new ArrayBuffer(8);await api.uploadMediaContent('/media/upload-intents/i/content',bytes,'image/png');
  assert.equal(binary.path,'/media/upload-intents/i/content');assert.equal(binary.method,'PUT');assert.equal(binary.data,bytes);assert.equal(binary.mime,'image/png');assert.match(binary.headers.Authorization,/^Bearer /);assert.equal(binary.headers['X-Household-Id'],family.householdId);
  assert.equal(api.publicMediaUrl('/media/public?token=token'),'https://example.test/api/v1/media/public?token=token');
});
test('Trip photo client binds upload intent and gallery listing to the selected trip version',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return[];}}},uni);
  await api.createMediaUploadIntent({ownerType:'TRIP',ownerId:'trip-a',expectedOwnerVersion:8,mimeType:'image/png',byteSize:16});await api.listTripPhotos('trip-a');
  assert.equal(sent[0].path,'/media/upload-intents');assert.equal(sent[0].data.ownerType,'TRIP');assert.equal(sent[0].data.expectedOwnerVersion,8);
  assert.equal(sent[1].path,'/trips/trip-a/photos');assert.equal(sent[1].method,'GET');
});
test('Task client sends optimistic version for content and status updates',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const task={id:'task-a',version:6,status:'PENDING'};
  await api.updateTask(task,{title:'清洗空调'});await api.updateTaskStatus(task,'IN_PROGRESS');
  assert.equal(sent[0].path,'/tasks/task-a');assert.equal(sent[0].method,'PATCH');assert.equal(sent[0].data.expectedVersion,6);assert.equal(sent[0].data.title,'清洗空调');
  assert.equal(sent[1].path,'/tasks/task-a/status');assert.equal(sent[1].method,'PATCH');assert.equal(sent[1].data.expectedVersion,6);assert.equal(sent[1].data.status,'IN_PROGRESS');
});
test('Favorite client preserves optimistic versions and a stable conversion idempotency key',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const favorite={id:'favorite-a',version:4,type:'LINK',title:'早餐灵感',visibility:'HOUSEHOLD'};
  await api.updateFavorite(favorite,{title:'周末早餐'});
  await api.convertFavorite(favorite,{targetType:'RECIPE',idempotencyKey:'same-conversion-key',confirmedTitle:'周末早餐草稿'});
  await api.archiveFavorite(favorite);
  await api.createMediaUploadIntent({ownerType:'FAVORITE',ownerId:favorite.id,expectedOwnerVersion:favorite.version,mimeType:'image/png',byteSize:16});
  assert.deepEqual(sent.slice(0,3).map(item=>[item.path,item.method,item.data.expectedVersion]),[
    ['/favorites/favorite-a','PATCH',4],['/favorites/favorite-a/convert','POST',4],['/favorites/favorite-a/archive','POST',4],
  ]);
  assert.equal(sent[1].data.idempotencyKey,'same-conversion-key');assert.equal(sent[1].data.targetType,'RECIPE');
  assert.equal(sent[3].data.ownerType,'FAVORITE');assert.equal(sent[3].data.expectedOwnerVersion,4);
});
test('Archive client sends separate field and encrypted-value versions without plaintext in URLs',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const field={id:'field-a',version:3,valueVersion:7};
  await api.updateArchiveField(field,{label:'家庭联系人'});await api.setArchiveValue(field.id,'虚构联系人 10086',field.valueVersion);await api.getArchiveValue(field.id);
  assert.equal(sent[0].path,'/archive/fields/field-a');assert.equal(sent[0].data.expectedVersion,3);
  assert.equal(sent[1].path,'/archive/fields/field-a/value');assert.equal(sent[1].method,'PUT');assert.equal(sent[1].data.expectedVersion,7);assert.equal(sent[1].data.value,'虚构联系人 10086');
  assert.equal(sent[2].path,'/archive/fields/field-a/value');assert.ok(!sent.some(item=>item.path.includes('10086')));
});
test('Dashboard client URL-encodes both date boundaries',async()=>{
  const uni=mockUni();let sent;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent={path,method,data};return{};}}},uni);
  await api.getDashboardSummary('2026-09-01T00:00:00+08:00','2026-10-01T00:00:00+08:00');
  assert.match(sent.path,/^\/dashboard\/summary\?from=/);assert.match(sent.path,/%2B08%3A00/);assert.match(sent.path,/&to=/);assert.equal(sent.method,'GET');
});
test('Notification client uses optimistic versions for preferences and inbox reads',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const preference={eventType:'TASK_REMINDER',version:2,enabled:true,leadMinutes:0,quietStart:'22:00',quietEnd:'08:00'};
  const item={id:'inbox-a',version:5,sourceType:'TASK',sourceId:'task-a'};
  await api.updateNotificationPreference(preference,{enabled:false,leadMinutes:0,quietStart:'22:00',quietEnd:'08:00'});await api.readInboxItem(item);
  assert.equal(sent[0].path,'/notification-preferences');assert.equal(sent[0].method,'PATCH');assert.equal(sent[0].data.expectedVersion,2);assert.equal(sent[0].data.enabled,false);
  assert.equal(sent[1].path,'/inbox/inbox-a/read');assert.equal(sent[1].data.expectedVersion,5);
});
test('Anniversary client preserves recurrence choices and optimistic versions',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return data||{};}}},uni);
  const anniversary={id:'anniversary-a',version:3};
  await api.createAnniversary({title:'结婚纪念日',localDate:'2024-02-29',recurrence:'YEARLY',leapPolicy:'MAR_1'});
  await api.updateAnniversary(anniversary,{title:'我们的纪念日',leapPolicy:'FEB_28'});
  await api.archiveAnniversary(anniversary);
  assert.equal(sent[0].path,'/calendar/anniversaries');assert.equal(sent[0].method,'POST');assert.equal(sent[0].data.recurrence,'YEARLY');assert.equal(sent[0].data.leapPolicy,'MAR_1');
  assert.equal(sent[1].path,'/calendar/anniversaries/anniversary-a');assert.equal(sent[1].method,'PATCH');assert.equal(sent[1].data.expectedVersion,3);
  assert.equal(sent[2].path,'/calendar/anniversaries/anniversary-a/archive');assert.equal(sent[2].data.expectedVersion,3);
});
