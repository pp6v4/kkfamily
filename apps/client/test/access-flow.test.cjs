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
  const module=evaluate(script.content,{'vue':vue,'@dcloudio/uni-app':{onShow(){},onLoad(){},onHide(){},onUnload(){}},...dependencies},uni);
  return module.default.setup({}, {expose(){}});
}
function mockUni() {
  const values=new Map(), routes=[];
  return { values,routes,getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value),removeStorageSync:key=>values.delete(key),login:input=>input.success({code:'fictional-login-code'}),navigateTo:input=>{routes.push(input.url);input.complete?.();},navigateBack(){},switchTab:input=>routes.push(input.url),setNavigationBarTitle(){},showToast(){},showModal(){},setClipboardData(){} };
}
const family={householdId:'house-a',householdName:'虚构家庭',membershipId:'member-a',roles:['ADMIN'],accessToken:'fictional-token',version:1,effectivePermissions:{members:'MANAGE'}};
function allowed(context,module,level='VIEW') {const ranks={VIEW:1,EDIT:2,MANAGE:3};return (ranks[context?.effectivePermissions?.[module]]||0)>=ranks[level];}

test('JSON and binary requests directly use the verified HTTPS API without redirects',async()=>{
  const config=loadTs('src/services/config.ts',{},{});
  assert.equal(config.API_BASE_URL,'https://pp6v4.com/api/v1');
  const requests=[],uni={request(options){requests.push(options);options.success({statusCode:200,data:{data:{ok:true}}});}};
  const transport=loadTs('src/services/transport.ts',{'./config':config},uni);
  await transport.rawRequest('/auth/wechat/login','POST',{code:'fictional-code'});
  await transport.rawBinaryRequest('/media/uploads/fictional','PUT',new ArrayBuffer(4),'image/png');
  assert.deepEqual(requests.map(row=>[row.url,row.method]),[
    ['https://pp6v4.com/api/v1/auth/wechat/login','POST'],
    ['https://pp6v4.com/api/v1/media/uploads/fictional','PUT'],
  ]);
  assert.equal(requests[0].data.code,'fictional-code');
  assert.equal(requests[1].data.byteLength,4);
});

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
test('Account profile update keeps current tokens and replaces the identity display name',async()=>{
  const uni=mockUni(),calls=[];
  const current={accessToken:'access-a',refreshToken:'refresh-a',user:{id:'user-a',nickname:null,avatarUrl:null,households:[]}};
  const session=loadTs('src/services/session.ts',{'./transport':{ApiError,rawRequest:async(path,method,data,headers)=>{calls.push({path,method,data,headers});if(path==='/auth/me'&&method==='GET')return{user:current.user};if(path==='/auth/me'&&method==='PATCH')return{user:{...current.user,nickname:'小扣'}};throw Error('Unexpected '+path);}}},uni);
  uni.setStorageSync('kkfamily.accessToken',current.accessToken);uni.setStorageSync('kkfamily.refreshToken',current.refreshToken);
  const updated=await session.updateMyProfile('小扣');
  assert.equal(updated.user.nickname,'小扣');assert.equal(updated.accessToken,'access-a');assert.equal(updated.refreshToken,'refresh-a');
  assert.equal(calls[1].path,'/auth/me');assert.equal(calls[1].method,'PATCH');assert.equal(calls[1].data.nickname,'小扣');assert.match(calls[1].headers.Authorization,/access-a/);
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
test('Account page trims and saves the display name while preserving failed input',async()=>{
  const uni=mockUni();let submitted='',fail=false;
  const current={accessToken:'access-a',refreshToken:'refresh-a',user:{id:'user-a',nickname:null,avatarUrl:null,households:[]}};
  const page=loadPage('src/pages/join/index.vue',{'../../services/session':{ensureIdentity:async()=>current,updateMyProfile:async nickname=>{submitted=nickname;if(fail)throw Error('暂时失败');return{...current,user:{...current.user,nickname}};}}},uni);
  page.identity.value=current;page.profileName.value='  小扣  ';await page.saveProfile();
  assert.equal(submitted,'小扣');assert.equal(page.identity.value.user.nickname,'小扣');assert.equal(page.profileName.value,'小扣');
  fail=true;page.profileName.value='老婆';await page.saveProfile();assert.equal(page.profileName.value,'老婆');assert.match(page.error.value,/暂时失败/);
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
test('Calendar quick actions and event drill-down require the corresponding module permission',()=>{
  const uni=mockUni(),targets=[],toasts=[];
  uni.showToast=input=>toasts.push(input.title);
  const calendarSession={...family,effectivePermissions:{calendar:'VIEW',meals:'EDIT'}};
  const page=loadPage('src/pages/date-detail/index.vue',{
    '../../services/session':{canAccess:allowed,refreshAccess:async()=>calendarSession},
    '../../services/calendar-navigation':{setCalendarTarget:target=>targets.push(target)},
    '../../services/family-api':{},
  },uni);
  page.date.value='2026-09-03';page.session.value=calendarSession;
  assert.equal(page.canPlanMeal.value,true);assert.equal(page.canPlanTrip.value,false);assert.equal(page.canPlanTask.value,false);assert.equal(page.quickActionCount.value,1);
  page.planMeal();assert.equal(targets.length,1);assert.equal(targets[0].type,'MEAL');assert.equal(targets[0].date,'2026-09-03');assert.deepEqual(uni.routes,['/pages/meal/index']);
  page.planTrip();page.planTask();page.openEvent({id:'task-event',type:'TASK',title:'清洗空调',startsAt:'2026-09-03',sourceId:'task-a'});
  assert.deepEqual(uni.routes,['/pages/meal/index']);assert.deepEqual(toasts,['尚未获得露营编辑权限','尚未获得待办编辑权限','尚未获得待办详情权限']);
});
test('My home displays the approved website ICP filing number and supports copying it',()=>{
  const source=fs.readFileSync(path.join(ROOT,'src/pages/profile/index.vue'),'utf8');
  assert.match(source,/辽ICP备2026020161号-1/);
  assert.match(source,/ICP备案号/);
  assert.match(source,/setClipboardData/);
});

const mealSession={...family,effectivePermissions:{meals:'MANAGE',recipes:'VIEW',inventory:'EDIT',shopping:'EDIT'}};
function mealRecord(overrides={}) {return {id:'meal-a',version:7,snapshotVersion:1,localDate:'2026-09-01',slotKey:'',scheduledAt:'2026-09-01T18:00:00+08:00',mealType:'DINNER',status:'CONFIRMED',legacyWithoutSnapshot:false,items:[],menu:[],...overrides};}
function mealDependencies(overrides={}) {
  return {'../../services/session':{canAccess:allowed,refreshAccess:async()=>mealSession},'../../services/calendar-navigation':{takeCalendarTarget:()=>undefined},'../../services/family-api':{
    mealTypeCodes:{早餐:'BREAKFAST',午餐:'LUNCH',晚餐:'DINNER',加餐:'OTHER'},mealTypeLabel:()=> '晚餐',listMeals:async()=>[],listRecipeCategories:async()=>[],listRecipes:async()=>[],recalculateMeal:async()=>[],listMealSnapshots:async()=>[],...overrides,
  }};
}
test('Recipe manager can add, edit, order and archive categories, then update recipe lifecycle',async()=>{
  const uni=mockUni(),categories=[],categoryUpdates=[],categoryArchives=[],statuses=[];
  const manager={...mealSession,effectivePermissions:{...mealSession.effectivePermissions,recipes:'MANAGE'}};
  const recipe={id:'recipe-a',version:4,name:'烤鱼',status:'PUBLISHED',category:null,ingredients:[],seasonings:[],steps:['烤熟']};
  const page=loadPage('src/pages/meal/index.vue',mealDependencies({createRecipeCategory:async(name,sortOrder)=>{categories.push({name,sortOrder});return{id:'category-a',name,sortOrder,version:1};},updateRecipeCategory:async(value,input)=>{categoryUpdates.push({version:value.version,...input});return{...value,...input,version:value.version+1};},archiveRecipeCategory:async value=>{categoryArchives.push(value.version);return{...value,version:value.version+1,archivedAt:'2026-09-03'};},updateRecipeStatus:async(value,status)=>{statuses.push({version:value.version,status});return{...value,status,version:value.version+1};}}),uni);
  page.session.value=manager;page.recipeCategories.value=[{id:'category-old',name:'主食',sortOrder:0,version:2}];page.categoryName.value='  海鲜  ';await page.saveCategory();
  assert.deepEqual(categories,[{name:'海鲜',sortOrder:1}]);assert.equal(page.categoryName.value,'');assert.equal(page.recipeCategories.value[1].name,'海鲜');
  page.startCategoryEdit(page.recipeCategories.value[0]);page.categoryEditName.value='  家常菜 ';page.categoryEditOrder.value='5';await page.saveCategoryEdit();
  assert.deepEqual(categoryUpdates,[{version:2,name:'家常菜',sortOrder:5}]);const edited=page.recipeCategories.value.find(item=>item.id==='category-old');assert.equal(edited.version,3);
  await page.applyCategoryArchive(edited);assert.deepEqual(categoryArchives,[3]);assert.equal(page.recipeCategories.value.some(item=>item.id==='category-old'),false);
  page.recipes.value=[recipe];await page.applyRecipeStatus(recipe,'ARCHIVED');
  assert.deepEqual(statuses,[{version:4,status:'ARCHIVED'}]);assert.equal(page.recipes.value[0].version,5);assert.equal(page.recipes.value[0].status,'ARCHIVED');
});
test('Recipe editor preserves an archived historical category unless the user explicitly clears it',async()=>{
  const uni=mockUni(),updates=[];
  const archived={id:'category-old',name:'旧分类',sortOrder:4,version:3,archivedAt:'2026-09-03T00:00:00.000Z'};
  const recipe={id:'recipe-a',version:6,name:'旧菜',status:'DRAFT',coverAssetId:null,category:archived,ingredients:[{ingredientId:'food-a',quantity:'1',unit:'份',optional:false,ingredient:{id:'food-a',name:'食材'}}],seasonings:[],steps:['完成']};
  const page=loadPage('src/pages/recipe-editor/index.vue',{'../../services/family-api':{listRecipeCategories:async()=>[],getRecipe:async()=>recipe,updateRecipe:async(id,input)=>{updates.push({id,input});return{...recipe,...input,version:input.expectedVersion+1};}}},uni);
  await page.loadPage({id:recipe.id});assert.match(page.categoryName.value,/旧分类.*已归档/);page.name.value='旧菜新做法';await page.persist(false);
  assert.equal(Object.prototype.hasOwnProperty.call(updates[0].input,'categoryId'),false);assert.equal(page.originalCategoryId.value,'category-old');
  page.categoryIndex.value=0;await page.persist(false);assert.equal(updates[1].input.categoryId,null);assert.equal(page.originalCategoryId.value,null);
});
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
test('Family API sends category maintenance and recipe lifecycle versions to their database endpoints',async()=>{
  const uni=mockUni(),sent=[];
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent.push({path,method,data});return{...data,id:'saved'};}}},uni);
  const category={id:'category-a',name:'海鲜',sortOrder:3,version:4};await api.createRecipeCategory('海鲜',3);await api.updateRecipeCategory(category,{name:'水产',sortOrder:2});await api.archiveRecipeCategory({...category,version:5});await api.updateRecipeStatus({id:'recipe-a',version:7},'ARCHIVED');
  assert.equal(sent[0].path,'/recipes/categories');assert.equal(sent[0].method,'POST');assert.equal(sent[0].data.name,'海鲜');assert.equal(sent[0].data.sortOrder,3);
  assert.equal(sent[1].path,'/recipes/categories/category-a');assert.equal(sent[1].method,'PATCH');assert.equal(sent[1].data.expectedVersion,4);assert.equal(sent[1].data.name,'水产');assert.equal(sent[1].data.sortOrder,2);
  assert.equal(sent[2].path,'/recipes/categories/category-a/archive');assert.equal(sent[2].method,'POST');assert.equal(sent[2].data.expectedVersion,5);
  assert.equal(sent[3].path,'/recipes/recipe-a/status');assert.equal(sent[3].method,'PATCH');assert.equal(sent[3].data.status,'ARCHIVED');assert.equal(sent[3].data.expectedVersion,7);
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
test('Task reopen requires a non-empty reason before sending and trims the accepted reason',async()=>{
  const uni=mockUni(),toasts=[],updates=[];
  uni.showToast=input=>toasts.push(input.title);
  const taskSession={...family,effectivePermissions:{tasks:'EDIT'}};
  const completed={id:'task-a',version:6,type:'TODO',title:'清洗空调',description:null,assigneeMembershipId:'member-a',assignee:{id:'member-a',user:{nickname:'小扣'}},createdBy:{id:'member-a',user:{nickname:'小扣'}},priority:'NORMAL',status:'COMPLETED',dueAt:null,reminderAt:null,history:[]};
  const page=loadPage('src/pages/tasks/index.vue',{
    '../../services/session':{canAccess:allowed,refreshAccess:async()=>taskSession},
    '../../services/family-api':{updateTaskStatus:async(task,status,reason)=>{updates.push({task,status,reason});return{...task,status,version:task.version+1};}},
  },uni);
  page.session.value=taskSession;page.selected.value=completed;page.reopenReason.value='   ';
  await page.changeStatus('PENDING',page.reopenReason.value);assert.equal(updates.length,0);assert.equal(page.busy.value,false);assert.deepEqual(toasts,['请填写重新打开原因']);
  page.reopenReason.value='  还需要再处理一次  ';await page.changeStatus('PENDING',page.reopenReason.value);
  assert.equal(updates.length,1);assert.equal(updates[0].task.version,6);assert.equal(updates[0].reason,'还需要再处理一次');assert.equal(page.selected.value.status,'PENDING');assert.equal(page.selected.value.version,7);assert.equal(page.reopenReason.value,'');
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
function archivePage(api={},access=async()=>({...family,effectivePermissions:{archive:'VIEW'}})){
  const lifecycle={},uni=mockUni();
  const page=loadPage('src/pages/archive/index.vue',{
    '@dcloudio/uni-app':{onShow:fn=>lifecycle.show=fn,onHide:fn=>lifecycle.hide=fn,onUnload:fn=>lifecycle.unload=fn},
    '../../services/session':{canAccess:allowed,refreshAccess:access},
    '../../services/members-api':{},'../../services/family-api':api,
  },uni);
  return{page,lifecycle};
}
const archiveField={id:'field-a',valueVersion:7,canEdit:true,label:'家庭联系人'};
test('Archive permission refresh clears revealed data immediately and stays empty after revocation',async()=>{
  let resolveAccess,listCalls=0;
  const {page}=archivePage({listArchiveFields:async()=>{listCalls++;return[archiveField];}},()=>new Promise(resolve=>resolveAccess=resolve));
  page.session.value=family;page.fields.value=[archiveField];page.open(archiveField);page.value.value='虚构敏感内容';page.revealed.value=true;
  const pending=page.load();assert.equal(page.value.value,'');assert.equal(page.revealed.value,false);assert.equal(page.selected.value,undefined);assert.equal(page.fields.value.length,0);
  resolveAccess({...family,effectivePermissions:{}});await pending;
  assert.equal(listCalls,0);assert.equal(page.fields.value.length,0);assert.equal(page.manager.value,false);assert.equal(page.busy.value,false);
});
test('Archive discards a late plaintext response after hiding or choosing another field',async()=>{
  let resolveValue;const {page,lifecycle}=archivePage({getArchiveValue:()=>new Promise(resolve=>resolveValue=resolve)});
  page.open(archiveField);const pending=page.reveal();lifecycle.hide();resolveValue({value:'过期明文',valueVersion:8});assert.equal(await pending,false);
  assert.equal(page.value.value,'');assert.equal(page.selected.value,undefined);assert.equal(page.revealed.value,false);
  page.open(archiveField);const other=page.reveal();page.open({...archiveField,id:'field-b'});resolveValue({value:'另一个字段明文',valueVersion:9});assert.equal(await other,false);
  assert.equal(page.selected.value.id,'field-b');assert.equal(page.value.value,'');assert.equal(page.revealed.value,false);
});
test('Archive does not restore old household details or a list response arriving after unload',async()=>{
  let resolveList;const {page,lifecycle}=archivePage({listArchiveFields:()=>new Promise(resolve=>resolveList=resolve)},async()=>({...family,householdId:'house-b',effectivePermissions:{archive:'VIEW'}}));
  page.session.value=family;page.open(archiveField);
  const switched=page.load();await new Promise(setImmediate);resolveList([{...archiveField,id:'field-b'}]);await switched;
  assert.equal(page.session.value.householdId,'house-b');assert.equal(page.selected.value,undefined);assert.equal(page.fields.value[0].id,'field-b');
  const hidden=page.load();await new Promise(setImmediate);lifecycle.unload();resolveList([archiveField]);await hidden;
  assert.equal(page.fields.value.length,0);assert.equal(page.session.value,undefined);assert.equal(page.value.value,'');
});
test('Archive save refreshes field versions and returns the content to a masked state',async()=>{
  let current={...archiveField},saved;
  const {page}=archivePage({listArchiveFields:async()=>[current],getArchiveValue:async()=>({value:'旧内容',valueVersion:7}),setArchiveValue:async(id,value,version)=>{saved={id,value,version};current={...current,valueVersion:8};return{valueVersion:8};}});
  await page.load();page.open(page.fields.value[0]);await page.beginEdit();assert.equal(page.editingValue.value,true);
  page.value.value='新内容';await page.saveValue();
  assert.deepEqual(saved,{id:'field-a',value:'新内容',version:7});assert.equal(page.selected.value.id,'field-a');assert.equal(page.valueVersion.value,8);assert.equal(page.value.value,'');assert.equal(page.revealed.value,false);assert.equal(page.busy.value,false);
});
test('Archive ignores a save response after the page is hidden',async()=>{
  let resolveSave,lists=0;
  const {page,lifecycle}=archivePage({setArchiveValue:()=>new Promise(resolve=>resolveSave=resolve),listArchiveFields:async()=>{lists++;return[archiveField];}});
  page.open(archiveField);page.value.value='正在保存的虚构内容';const pending=page.saveValue();lifecycle.hide();resolveSave({valueVersion:8});await pending;
  assert.equal(lists,0);assert.equal(page.selected.value,undefined);assert.equal(page.value.value,'');assert.equal(page.revealed.value,false);
});
test('Dashboard client URL-encodes both date boundaries',async()=>{
  const uni=mockUni();let sent;
  const api=loadTs('src/services/family-api.ts',{'./session':{ensureSession:async()=>family,clearSession(){}},'./config':{API_BASE_URL:'https://example.test/api/v1'},'./transport':{ApiError,rawBinaryRequest:async()=>({}),rawRequest:async(path,method,data)=>{sent={path,method,data};return{};}}},uni);
  await api.getDashboardSummary('2026-09-01T00:00:00+08:00','2026-10-01T00:00:00+08:00');
  assert.match(sent.path,/^\/dashboard\/summary\?from=/);assert.match(sent.path,/%2B08%3A00/);assert.match(sent.path,/&to=/);assert.equal(sent.method,'GET');
});
function privatePage(name,api,access){
  const lifecycle={},uni=mockUni();
  const page=loadPage(`src/pages/${name}/index.vue`,{
    '@dcloudio/uni-app':{onShow:fn=>lifecycle.show=fn,onHide:fn=>lifecycle.hide=fn,onUnload:fn=>lifecycle.unload=fn,onLoad:fn=>lifecycle.load=fn},
    '../../services/session':{canAccess:allowed,refreshAccess:access},'../../services/family-api':api,
  },uni);return{page,lifecycle,uni};
}
for(const name of ['dashboard','notifications','tasks','favorites']){
  test(`${name} clears cached household data before permission refresh and rejects late data after hide`,async()=>{
    let denied=true,resolveAccess,resolveData,calls=0;
    const context={...family,effectivePermissions:{[name]:'VIEW'}};
    const fetch=()=>{calls++;return new Promise(resolve=>resolveData=resolve);};
    const api={getDashboardSummary:fetch,listInbox:fetch,listNotificationPreferences:async()=>[],getPublicNotificationSettings:async()=>({}),listTasks:fetch,listFavorites:fetch};
    const {page,lifecycle}=privatePage(name,api,()=>denied?new Promise(resolve=>resolveAccess=resolve):Promise.resolve(context));
    page.session.value=context;
    if(name==='dashboard')page.summary.value={recipes:{publishedCount:8}};
    if(name==='notifications'){page.inbox.value=[{id:'old-message'}];page.preference.value={enabled:true};page.settings.value={taskReminderTemplateId:'old-template'};}
    if(name==='tasks'){page.tasks.value=[{id:'old-task'}];page.selected.value={id:'old-task'};page.form.value.title='旧家庭内容';}
    if(name==='favorites'){page.favorites.value=[{id:'old-favorite'}];page.selected.value={id:'old-favorite'};page.previews.value=['old-url'];page.form.value.text='旧家庭内容';}
    const pending=page.load();assert.equal(page.session.value,undefined);
    if(name==='dashboard')assert.equal(page.summary.value,undefined);
    if(name==='notifications'){assert.equal(page.inbox.value.length,0);assert.equal(page.preference.value,undefined);assert.equal(page.settings.value,undefined);}
    if(name==='tasks'){assert.equal(page.tasks.value.length,0);assert.equal(page.selected.value,undefined);assert.equal(page.form.value.title,'');}
    if(name==='favorites'){assert.equal(page.favorites.value.length,0);assert.equal(page.selected.value,undefined);assert.equal(page.previews.value.length,0);assert.equal(page.form.value.text,'');}
    resolveAccess({...family,effectivePermissions:{}});await pending;assert.equal(calls,0);
    denied=false;const loading=page.load();await new Promise(setImmediate);assert.equal(calls,1);lifecycle.hide();resolveData(name==='dashboard'?{recipes:{publishedCount:9}}:[{id:'late'}]);await loading;
    assert.equal(page.session.value,undefined);
    if(name==='dashboard')assert.equal(page.summary.value,undefined);
    if(name==='notifications')assert.equal(page.inbox.value.length,0);
    if(name==='tasks')assert.equal(page.tasks.value.length,0);
    if(name==='favorites')assert.equal(page.favorites.value.length,0);
  });
}
const favoriteSession={...family,effectivePermissions:{favorites:'EDIT',recipes:'EDIT'}};
function favoriteRecord(overrides={}){return{id:'favorite-a',version:3,type:'TEXT',title:'早餐灵感',text:'自己记的想法',sourceUrl:null,assetIds:[],tags:[],visibility:'PRIVATE',createdById:'member-a',createdBy:{id:'member-a',user:{nickname:'小扣'}},conversions:[],...overrides};}
test('Favorite detail requests respect navigation order and lose edit controls after downgrade',async()=>{
  const responses=[];const {page}=privatePage('favorites',{getFavorite:()=>new Promise(resolve=>responses.push(resolve))},async()=>favoriteSession);
  page.session.value=favoriteSession;const first=page.openFavorite({id:'a'}),last=page.openFavorite({id:'b'});
  responses[1](favoriteRecord({id:'b'}));await last;responses[0](favoriteRecord({id:'a'}));await first;assert.equal(page.selected.value.id,'b');assert.equal(page.editable.value,true);
  page.session.value={...favoriteSession,effectivePermissions:{favorites:'VIEW'}};assert.equal(page.editable.value,false);page.editFavorite();assert.equal(page.showForm.value,false);
});
test('Favorite save reloads authorized details and ignores a response after leaving',async()=>{
  let saved,resolveUpdate;const item=favoriteRecord();
  const {page,lifecycle}=privatePage('favorites',{createFavorite:async input=>{saved=input;return item;},listFavorites:async()=>[item],getFavorite:async()=>item,updateFavorite:()=>new Promise(resolve=>resolveUpdate=resolve)},async()=>favoriteSession);
  page.session.value=favoriteSession;page.newFavorite();page.form.value.title=' 早餐 ';page.form.value.text=' 做点什么 ';await page.save();
  assert.equal(saved.title,'早餐');assert.equal(saved.text,'做点什么');assert.equal(page.selected.value.id,item.id);assert.equal(page.showForm.value,false);
  page.editFavorite();page.form.value.text='修改中';const pending=page.save();lifecycle.hide();resolveUpdate({...item,version:4});await pending;
  assert.equal(page.selected.value,undefined);assert.equal(page.form.value.text,'');
});
test('Favorite media chooser can hide and restore the page, then upload with the current owner version',async()=>{
  const calls=[];let choose,current=favoriteRecord();
  const {page,lifecycle,uni}=privatePage('favorites',{
    getFavorite:async()=>current,listFavorites:async()=>[current],
    createMediaUploadIntent:async input=>{calls.push(['intent',input]);return{id:'intent-a',uploadPath:'/upload'};},
    uploadMediaContent:async(path,bytes,mime)=>{calls.push(['bytes',path,bytes.byteLength,mime]);return{checksumSha256:'checksum'};},
    confirmMediaAsset:async(id,checksum)=>{calls.push(['confirm',id,checksum]);current={...current,version:5,assetIds:['asset-a']};},
    getMediaReadUrl:async()=>({path:'/fresh-image'}),publicMediaUrl:path=>path,
  },async()=>favoriteSession);
  uni.chooseMedia=input=>choose=input;uni.getFileSystemManager=()=>({readFile:input=>input.success({data:new ArrayBuffer(4)})});
  page.session.value=favoriteSession;page.selected.value=current;const uploading=page.addImage();assert.equal(page.uploading.value,true);
  lifecycle.hide();assert.equal(page.selected.value,undefined);assert.equal(page.favorites.value.length,0);
  await lifecycle.show();current={...current,version:4};choose.success({tempFiles:[{tempFilePath:'chosen.png',size:4}]});await uploading;
  assert.equal(calls[0][1].ownerId,'favorite-a');assert.equal(calls[0][1].expectedOwnerVersion,4);
  assert.deepEqual(calls[1],['bytes','/upload',4,'image/png']);assert.deepEqual(calls[2],['confirm','intent-a','checksum']);
  assert.equal(page.selected.value.version,5);assert.equal(page.previews.value[0],'/fresh-image');assert.equal(page.uploading.value,false);
});
for(const mode of ['switched-household','revoked-permission','unloaded']){
  test(`Favorite upload stops after chooser when ${mode}`,async()=>{
    let choose,intents=0,context=favoriteSession;const item=favoriteRecord();
    const {page,lifecycle,uni}=privatePage('favorites',{listFavorites:async()=>[],getFavorite:async()=>item,createMediaUploadIntent:async()=>{intents++;throw Error('must not upload');}},async()=>context);
    uni.chooseMedia=input=>choose=input;page.session.value=context;page.selected.value=item;const pending=page.addImage();lifecycle.hide();
    if(mode==='switched-household')context={...favoriteSession,householdId:'house-b',membershipId:'member-b'};
    if(mode==='revoked-permission')context={...favoriteSession,effectivePermissions:{favorites:'VIEW'}};
    if(mode==='unloaded')lifecycle.unload();else await lifecycle.show();
    choose.success({tempFiles:[{tempFilePath:'chosen.png',size:4}]});await pending;
    assert.equal(intents,0);assert.equal(page.selected.value,undefined);assert.equal(page.previews.value.length,0);assert.equal(page.uploading.value,false);
  });
}
test('Favorite preview renews signed URLs and returns through a fresh authorized load',async()=>{
  let reads=0,previewed;const item=favoriteRecord({assetIds:['asset-a']});
  const {page,lifecycle,uni}=privatePage('favorites',{getMediaReadUrl:async()=>({path:`/signed-${++reads}`}),publicMediaUrl:path=>path,listFavorites:async()=>[item],getFavorite:async()=>item},async()=>favoriteSession);
  page.session.value=favoriteSession;page.selected.value=item;page.previews.value=['expired'];uni.previewImage=input=>{previewed=input;lifecycle.hide();};
  await page.preview(0);assert.equal(previewed.current,'/signed-1');assert.equal(page.previews.value.length,0);assert.equal(page.selected.value,undefined);
  await lifecycle.show();assert.equal(page.selected.value.id,item.id);assert.equal(page.previews.value[0],'/signed-2');
});
test('Cancelling favorite image selection restores the authorized favorite without uploading',async()=>{
  let choose,intents=0;const item=favoriteRecord();
  const {page,lifecycle,uni}=privatePage('favorites',{listFavorites:async()=>[item],getFavorite:async()=>item,createMediaUploadIntent:async()=>intents++},async()=>favoriteSession);
  uni.chooseMedia=input=>choose=input;page.session.value=favoriteSession;page.selected.value=item;const pending=page.addImage();lifecycle.hide();choose.fail({errMsg:'chooseMedia:fail cancel'});await pending;
  assert.equal(page.selected.value,undefined);assert.equal(page.uploading.value,false);assert.equal(intents,0);
  await lifecycle.show();assert.equal(page.selected.value.id,item.id);assert.equal(page.editable.value,true);
});
test('Favorite upload completion while hidden stays blank until the next authorized show',async()=>{
  let choose,lists=0,confirmed=0;const item=favoriteRecord();
  const {page,lifecycle,uni}=privatePage('favorites',{listFavorites:async()=>{lists++;return[item];},getFavorite:async()=>item,createMediaUploadIntent:async()=>({id:'intent-a',uploadPath:'/upload'}),uploadMediaContent:async()=>({checksumSha256:'checksum'}),confirmMediaAsset:async()=>confirmed++},async()=>favoriteSession);
  uni.chooseMedia=input=>choose=input;uni.getFileSystemManager=()=>({readFile:input=>input.success({data:new ArrayBuffer(4)})});
  page.session.value=favoriteSession;page.selected.value=item;const pending=page.addImage();lifecycle.hide();choose.success({tempFiles:[{tempFilePath:'chosen.png',size:4}]});await pending;
  assert.equal(confirmed,1);assert.equal(lists,0);assert.equal(page.selected.value,undefined);assert.equal(page.session.value,undefined);
  await lifecycle.show();assert.equal(lists,1);assert.equal(page.selected.value.id,item.id);
});
test('Favorite conversion preserves retry identity and never navigates after hiding',async()=>{
  const keys=[];let fail=true,resolveConversion;const item=favoriteRecord();
  const {page,lifecycle,uni}=privatePage('favorites',{convertFavorite:async(item,input)=>{keys.push(input.idempotencyKey);if(fail)throw Error('网络中断');return new Promise(resolve=>resolveConversion=resolve);}},async()=>favoriteSession);
  page.session.value=favoriteSession;page.selected.value=item;page.startConvert();await page.runConvert();assert.notEqual(page.convertKey.value,'');
  fail=false;const pending=page.runConvert();lifecycle.hide();resolveConversion({targetType:'RECIPE',targetId:'recipe-a'});await pending;
  assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal(uni.routes.length,0);assert.equal(page.convertOpen.value,false);
});
test('Dashboard uses the newest range result and allows recipe-only navigation',async()=>{
  const results=[];const {page,uni}=privatePage('dashboard',{getDashboardSummary:()=>new Promise(resolve=>results.push(resolve))},async()=>({...family,effectivePermissions:{dashboard:'VIEW',recipes:'VIEW'}}));
  const first=page.load();await new Promise(setImmediate);page.rangeIndex.value=1;const second=page.load();await new Promise(setImmediate);
  results[1]({recipes:{publishedCount:2}});await second;results[0]({recipes:{publishedCount:1}});await first;
  assert.equal(page.summary.value.recipes.publishedCount,2);page.open('meals');assert.equal(uni.routes.length,0);page.open('recipes');assert.deepEqual(uni.routes,['/pages/meal/index']);
});
test('Task day shortcut survives loading and delayed status updates do not reopen a hidden page',async()=>{
  let resolveStatus;const context={...family,effectivePermissions:{tasks:'EDIT'}};
  const {page,lifecycle}=privatePage('tasks',{listTasks:async()=>[],listTaskAssignees:async()=>[{id:'member-a',user:{nickname:'小扣'}}],updateTaskStatus:()=>new Promise(resolve=>resolveStatus=resolve)},async()=>context);
  lifecycle.load({date:'2026-09-07'});await page.load();assert.equal(page.showingForm.value,true);assert.equal(page.form.value.dueDate,'2026-09-07');assert.equal(page.busy.value,false);
  const task={id:'task-a',status:'PENDING',assigneeMembershipId:'member-a',createdBy:{id:'member-a'},version:3};page.selected.value=task;
  const pending=page.changeStatus('COMPLETED');lifecycle.hide();resolveStatus({...task,status:'COMPLETED',version:4});await pending;
  assert.equal(page.selected.value,undefined);assert.equal(page.tasks.value.length,0);assert.equal(page.showingForm.value,false);
});
test('Task detail opened last wins and a cancelled confirmation cannot affect a different task',async()=>{
  const details=[];let modal,statusCalls=0;
  const {page,uni}=privatePage('tasks',{getTask:()=>new Promise(resolve=>details.push(resolve)),updateTaskStatus:async()=>{statusCalls++;}},async()=>family);
  page.session.value={...family,effectivePermissions:{tasks:'MANAGE'}};uni.showModal=input=>modal=input;
  const first=page.openTask({id:'task-a'}),second=page.openTask({id:'task-b'});
  details[1]({id:'task-b',status:'PENDING'});await second;details[0]({id:'task-a',status:'PENDING'});await first;assert.equal(page.selected.value.id,'task-b');
  page.cancelTask();page.closeTask();await modal.success({confirm:true});assert.equal(statusCalls,0);
});
test('Notification read and preference responses cannot navigate or refill a hidden page',async()=>{
  let resolveRead,resolvePreference;
  const context={...family,effectivePermissions:{notifications:'VIEW',tasks:'VIEW'}};
  const {page,lifecycle,uni}=privatePage('notifications',{readInboxItem:()=>new Promise(resolve=>resolveRead=resolve),updateNotificationPreference:()=>new Promise(resolve=>resolvePreference=resolve)},async()=>context);
  const item={id:'message-a',sourceType:'TASK',sourceId:'task-a',version:1,readAt:null};page.session.value=context;page.inbox.value=[item];
  const reading=page.open(item);lifecycle.hide();resolveRead({version:2,readAt:'2026-09-07'});await reading;assert.equal(uni.routes.length,0);assert.equal(page.inbox.value.length,0);
  page.session.value=context;page.preference.value={version:1,enabled:true};const saving=page.toggle(false);lifecycle.hide();resolvePreference({version:2,enabled:false});await saving;assert.equal(page.preference.value,undefined);
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
