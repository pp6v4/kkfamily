const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript } = require('vue/compiler-sfc');
const ROOT=path.resolve(__dirname,'..');
class ApiError extends Error {constructor(message,statusCode){super(message);this.statusCode=statusCode;}}
const context={householdId:'house-a',membershipId:'actor-a',roles:['ADMIN'],version:3,effectivePermissions:{members:'MANAGE'}};
const member={id:'member-b',version:7,user:{id:'user-b',nickname:'家人'},roles:['CHEF'],overrides:[],status:'ACTIVE',effectivePermissions:{recipes:'EDIT'}};
const invitation={id:'invitation-a',version:2,roleCodes:['GUEST'],usedCount:0,maxUses:1,expiresAt:'2026-09-12T00:00:00Z',revokedAt:null};
const catalog={ADMIN:{members:'MANAGE',recipes:'MANAGE'},MEMBER:{recipes:'VIEW'},CHEF:{recipes:'EDIT',meals:'MANAGE'},GUEST:{},CAMPER:{trips:'EDIT'}};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{resolve,reject,promise};}
const tick=()=>new Promise(setImmediate);
function form(api={},access){
  let stored=context;const life={},modals=[],clipboard=[];
  const uni={showModal:input=>modals.push(input),setClipboardData:input=>clipboard.push(input.data)};
  const deps={vue,'@dcloudio/uni-app':{onShow:fn=>life.show=fn,onHide:fn=>life.hide=fn,onUnload:fn=>life.unload=fn},
    '../../services/session':{getStoredSession:()=>stored,refreshAccess:async()=>access?access():stored,canAccess:(c,m,l='VIEW')=>({VIEW:1,EDIT:2,MANAGE:3}[c?.effectivePermissions?.[m]]||0)>={VIEW:1,EDIT:2,MANAGE:3}[l]},'../../services/transport':{ApiError},
    '../../services/members-api':{listMembers:async()=>({items:[member],nextCursor:null}),listInvitations:async()=>[invitation],roleCatalog:async()=>catalog,...api}};
  const filename=path.join(ROOT,'src/pages/members/index.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename}),module={exports:{}};
  const code=ts.transpileModule(compileScript(descriptor,{id:'members-test',inlineTemplate:false}).content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unexpected import '+id);},uni,Date,Error,Map,Set,Promise,console});
  const page=module.exports.default.setup({},{expose(){}});return{page,life,modals,clipboard,setStored:value=>stored=value};
}

test('Members hide/unload clears member data, permission drafts and one-time codes, drops old reads',async()=>{
  for(const end of ['hide','unload']){
    const waiting=deferred(),{page,life}=form({listInvitations:()=>waiting.promise});const pending=life.show();await tick();page.newCode.value='fictional-code';page.roles.value=['ADMIN'];page.overrides.value=[{module:'members',effect:'DENY',level:'VIEW'}];life[end]();waiting.resolve([invitation]);await pending;
    assert.equal(page.members.value.length,0);assert.equal(page.invitations.value.length,0);assert.equal(page.newCode.value,'');assert.equal(page.roles.value.length,0);assert.equal(page.overrides.value.length,0);assert.equal(page.session.value,undefined);assert.equal(page.loading.value,false);
  }
});
test('Latest refresh wins over earlier success and failure',async()=>{
  for(const reject of [false,true]){let reads=0;const waiting=deferred(),{page,life}=form({listMembers:()=>++reads===1?waiting.promise:Promise.resolve({items:[{...member,id:'new'}],nextCursor:null})});
    const old=life.show();await tick();await life.show();if(reject)waiting.reject(Error('旧错误'));else waiting.resolve({items:[member],nextCursor:'old'});await old;
    assert.equal(page.members.value[0].id,'new');assert.equal(page.nextCursor.value,null);assert.equal(page.error.value,'');
  }
});
test('Permissions gate dependent reads and handler writes for view-only or denied members',async()=>{
  for(const permission of ['VIEW',undefined]){let members=0,adminReads=0,writes=0;
    const{page,life,setStored,modals}=form({listMembers:async()=>{members++;return{items:[member],nextCursor:null};},listInvitations:async()=>{adminReads++;return[];},roleCatalog:async()=>{adminReads++;return{};},saveMemberPermissions:async()=>writes++,createInvitation:async()=>writes++});
    setStored({...context,roles:['MEMBER'],effectivePermissions:permission?{members:permission}:{}});await life.show();page.edit(member);await page.invite('family');page.confirmChange(member);page.revoke(invitation);await page.save();
    assert.equal(members,permission?1:0);assert.equal(adminReads,0);assert.equal(writes,0);assert.equal(modals.length,0);assert.equal(page.selected.value,undefined);
  }
});
test('Account change during auth or reads stops stale private results',async()=>{
  const auth=deferred();let reads=0;const first=form({listMembers:async()=>{reads++;return{items:[],nextCursor:null};}},()=>auth.promise);const a=first.life.show();first.setStored({...context,householdId:'other'});auth.resolve(context);await a;assert.equal(reads,0);
  const rows=deferred(),second=form({listMembers:()=>rows.promise});const b=second.life.show();await tick();second.setStored({...context,membershipId:'other'});rows.resolve({items:[member],nextCursor:null});await b;assert.equal(second.page.members.value.length,0);assert.equal(second.page.invitations.value.length,0);assert.equal(second.page.session.value,undefined);
});
test('Pagination is single-flight, deduplicates ids and cannot append after refresh or hide',async()=>{
  for(const event of ['normal','refresh','hide']){
    const waiting=deferred();let more=0;const{page,life}=form({listMembers:cursor=>cursor?(more++,waiting.promise):Promise.resolve({items:[member],nextCursor:'cursor-a'})});await life.show();const pending=page.more();await page.more();assert.equal(more,1);
    if(event==='refresh')await page.load();if(event==='hide')life.hide();waiting.resolve({items:[{...member,version:8},{...member,id:'next'}],nextCursor:null});await pending;
    if(event==='normal'){assert.equal(page.members.value.length,2);assert.equal(page.members.value[0].version,8);assert.equal(page.nextCursor.value,null);}
    else if(event==='refresh'){assert.equal(page.members.value.length,1);assert.equal(page.members.value[0].version,7);assert.equal(page.nextCursor.value,'cursor-a');}else assert.equal(page.members.value.length,0);
    assert.equal(page.paging.value,false);
  }
});
test('Permission preview combines roles, explicit lower level replaces defaults, DENY always wins',async()=>{
  const{page,life}=form();await life.show();page.edit(member);page.toggleRole('MEMBER');page.permissionChange('recipes',{detail:{value:'2'}});assert.equal(page.preview.value.recipes,'VIEW');assert.equal(page.preview.value.meals,'MANAGE');
  page.permissionChange('recipes',{detail:{value:'1'}});assert.equal(page.preview.value.recipes,undefined);
  page.overrides.value.push({module:'recipes',effect:'ALLOW',level:'MANAGE'});assert.equal(page.preview.value.recipes,undefined);
  page.permissionChange('recipes',{detail:{value:'0'}});assert.equal(page.preview.value.recipes,'EDIT');
  page.permissionChange('made-up',{detail:{value:'4'}});page.permissionChange('recipes',{detail:{value:'99'}});assert.equal(page.overrides.value.length,0);
});
test('Save captures target/version and deep permission draft; inputs and duplicate submit stay locked',async()=>{
  const waiting=deferred(),sent=[],{page,life}=form({saveMemberPermissions:(target,roles,overrides)=>{sent.push({target,roles,overrides});return waiting.promise;}});await life.show();page.edit(member);page.permissionChange('recipes',{detail:{value:'1'}});const pending=page.save();
  page.toggleRole('ADMIN');page.cancelEdit();page.permissionChange('recipes',{detail:{value:'4'}});await page.save();assert.equal(page.selected.value.id,member.id);assert.equal(sent.length,1);assert.equal(sent[0].target.version,7);
  page.overrides.value[0].effect='ALLOW';assert.equal(sent[0].overrides[0].effect,'DENY');assert.deepEqual(Array.from(sent[0].roles),['CHEF']);waiting.resolve(member);await pending;assert.equal(page.selected.value,undefined);assert.match(page.notice.value,/权限已保存/);
});
test('409 preserves original editor/version; 401/403 clears all private fields',async()=>{
  for(const status of [401,403,409]){const{page,life}=form({saveMemberPermissions:async()=>{throw new ApiError('保存失败',status);}});await life.show();page.edit(member);page.permissionChange('recipes',{detail:{value:'1'}});await page.save();assert.equal(page.writing.value,false);
    if(status===409){assert.equal(page.selected.value.version,7);assert.equal(page.overrides.value[0].effect,'DENY');assert.match(page.error.value,/草稿已保留/);}else{assert.equal(page.selected.value,undefined);assert.equal(page.members.value.length,0);assert.equal(page.session.value,undefined);assert.equal(page.roles.value.length,0);}
  }
});
test('Status/transfer confirmations expire on identity, actor version, target version, editor, hide or new dialog',async()=>{
  for(const transfer of [false,true])for(const event of ['identity','actor','target','editor','hide','dialog','permission']){
    let writes=0;const{page,life,modals,setStored}=form({setMemberStatus:async()=>writes++,transferAdmin:async()=>writes++});await life.show();page.confirmChange(member,transfer);assert.equal(modals.length,1);
    if(event==='identity')setStored({...context,householdId:'other'});
    if(event==='actor')setStored({...context,version:4});
    if(event==='target')page.members.value=[{...member,version:8}];
    if(event==='editor')page.edit(member);
    if(event==='hide')life.hide();
    if(event==='dialog')page.confirmChange(member);
    if(event==='permission')setStored({...context,effectivePermissions:{members:'VIEW'}});
    await modals[0].success({confirm:true});assert.equal(writes,0,event);
  }
});
test('Status confirmation sends original target version once; cancellation and last-admin conflict do not invent state',async()=>{
  const waiting=deferred(),sent=[],{page,life,modals}=form({setMemberStatus:(target,status)=>{sent.push({target,status});return waiting.promise;}});await life.show();page.confirmChange(member);await modals[0].success({confirm:false});assert.equal(sent.length,0);
  page.confirmChange(member);const pending=modals[1].success({confirm:true});await modals[1].success({confirm:true});assert.equal(sent.length,1);assert.equal(sent[0].target.version,7);assert.equal(sent[0].status,'DISABLED');
  waiting.reject(new ApiError('必须保留一名有效管理员',409));await pending;assert.equal(page.members.value[0].status,'ACTIVE');assert.match(page.error.value,/有效管理员/);
});
test('Transfer uses both captured versions and reauthorizes, removing controls after self downgrade',async()=>{
  const sent=[];let f;f=form({transferAdmin:async(target,actorVersion)=>{sent.push({target,actorVersion});f.setStored({...context,roles:['MEMBER'],version:4,effectivePermissions:{members:'VIEW'}});return target;}});await f.life.show();f.page.confirmChange(member,true);await f.modals[0].success({confirm:true});
  assert.equal(sent[0].target.id,member.id);assert.equal(sent[0].target.version,7);assert.equal(sent[0].actorVersion,3);assert.equal(f.page.manager.value,false);assert.equal(f.page.invitations.value.length,0);assert.equal(f.page.newCode.value,'');assert.equal(f.page.session.value.version,4);
});
test('Non-admin manager cannot assign ADMIN or transfer; invalid/self/inactive targets are blocked',async()=>{
  let writes=0;const{page,life,modals,setStored}=form({saveMemberPermissions:async()=>writes++});setStored({...context,roles:['CHEF']});await life.show();page.edit(member);page.toggleRole('ADMIN');assert.equal(page.roles.value.includes('ADMIN'),false);page.roles.value=['ADMIN'];await page.save();page.confirmChange(member,true);assert.equal(writes,0);assert.equal(modals.length,0);
  setStored(context);await life.show();page.members.value=[{...member,id:context.membershipId},{...member,id:'disabled',status:'DISABLED'}];for(const row of page.members.value)page.confirmChange(row,true);assert.equal(modals.length,0);
});
test('Invitations send family/dining/camping roles precisely and clear code on refresh, hide or revocation',async()=>{
  const sent=[],{page,life,clipboard}=form({createInvitation:async(roles,grants)=>{sent.push({roles,grants});return{...invitation,code:'fictional-one-time'};}});await life.show();
  for(const kind of ['family','dining','camping'])await page.invite(kind);
  assert.deepEqual(sent.map(row=>Array.from(row.roles)),[['MEMBER'],['GUEST'],['CAMPER']]);assert.equal(sent[1].grants.length,2);assert.equal(sent[1].grants[0].module,'recipes');assert.equal(sent[1].grants[0].level,'VIEW');assert.equal(sent[1].grants[1].module,'meals');assert.equal(sent[1].grants[1].level,'EDIT');assert.equal(sent[2].grants.length,0);
  page.copyCode();assert.equal(clipboard.length,1);await page.load();assert.equal(page.newCode.value,'');page.copyCode();assert.equal(clipboard.length,1);await page.invite('dining');life.hide();page.copyCode();assert.equal(clipboard.length,1);assert.equal(page.newCode.value,'');
});
test('Revocation dialog binds invitation version and expires when changed, hidden or replaced',async()=>{
  for(const event of ['normal','version','hide','dialog']){let writes=0;const{page,life,modals}=form({revokeInvitation:async target=>{writes++;assert.equal(target.version,2);}});await life.show();page.revoke(invitation);
    if(event==='version')page.invitations.value=[{...invitation,version:3}];if(event==='hide')life.hide();if(event==='dialog')page.confirmChange(member);
    await modals[0].success({confirm:true});assert.equal(writes,event==='normal'?1:0);
  }
});
test('Old invitation result after hide/show never reveals code or authorizes a duplicate write',async()=>{
  const waiting=deferred();let writes=0;const{page,life}=form({createInvitation:()=>{writes++;return waiting.promise;}});await life.show();const pending=page.invite('family');life.hide();await life.show();await page.invite('family');assert.equal(writes,1);
  waiting.resolve({...invitation,code:'fictional-secret'});await pending;assert.equal(page.newCode.value,'');assert.equal(page.members.value.length,0);assert.equal(page.reloadRequired.value,true);assert.equal(page.writing.value,false);await page.invite('family');assert.equal(writes,1);
});
test('Successful mutation followed by failed refresh is not labeled failed save and cannot be retried blindly',async()=>{
  let reads=0,writes=0;const{page,life}=form({listMembers:async()=>{if(++reads===2)throw Error('刷新失败');return{items:[member],nextCursor:null};},saveMemberPermissions:async()=>writes++});await life.show();page.edit(member);await page.save();assert.equal(writes,1);assert.equal(page.reloadRequired.value,true);assert.match(page.error.value,/操作已成功.*刷新失败/);assert.equal(page.session.value,undefined);await page.save();assert.equal(writes,1);await page.load();assert.equal(page.reloadRequired.value,false);
});
test('Page return read is invalidated when the abandoned mutation completes later',async()=>{
  const save=deferred(),rows=deferred();let reads=0;const{page,life}=form({saveMemberPermissions:()=>save.promise,listMembers:()=>++reads===1?Promise.resolve({items:[member],nextCursor:null}):rows.promise});await life.show();page.edit(member);const pending=page.save();life.hide();const returning=life.show();await tick();save.resolve(member);await pending;rows.resolve({items:[member],nextCursor:null});await returning;
  assert.equal(page.members.value.length,0);assert.equal(page.reloadRequired.value,true);assert.equal(page.loading.value,false);
});
