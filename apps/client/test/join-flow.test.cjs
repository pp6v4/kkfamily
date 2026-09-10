const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),vue=require('vue');
const {parse,compileScript}=require('vue/compiler-sfc');
const ROOT=path.resolve(__dirname,'..');
class ApiError extends Error{constructor(message,statusCode){super(message);this.statusCode=statusCode;}}
const account={accessToken:'fictional-access',refreshToken:'fictional-refresh',user:{id:'user-a',nickname:'小扣',households:[{membershipId:'member-a',household:{id:'house-a',name:'家'},roles:['MEMBER'],status:'ACTIVE'}]}};
const joined={membershipId:'member-b',roles:['GUEST'],household:{id:'house-b',name:'朋友家'}};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{resolve,reject,promise};}
const tick=()=>new Promise(setImmediate);
function form(api={}){
 let epoch=0;const life={},stored=[],routes=[],modals=[],toasts=[];
 const uni={switchTab:input=>{routes.push(input.url);api.navigate?.(input);},showModal:input=>modals.push(input),showToast:input=>toasts.push(input.title)};
 const session={ensureIdentity:async()=>account,identityRequest:async()=>({identity:account,data:joined}),updateMyProfile:async nickname=>({...account,user:{...account.user,nickname}}),...api,getSessionEpoch:()=>epoch,rememberSession:value=>{stored.push(value);epoch++;},logoutSession:()=>{epoch++;return api.logoutSession?api.logoutSession():Promise.resolve();}};
 const deps={vue,'@dcloudio/uni-app':{onShow:fn=>life.show=fn,onHide:fn=>life.hide=fn,onUnload:fn=>life.unload=fn},'../../services/session':session,'../../services/transport':{ApiError}};
 const filename=path.join(ROOT,'src/pages/join/index.vue'),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename}),module={exports:{}};
 const code=ts.transpileModule(compileScript(descriptor,{id:'join-test',inlineTemplate:false}).content,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unexpected import '+id);},uni,Error,Promise,Date,console});
 return{page:module.exports.default.setup({},{expose(){}}),life,stored,routes,modals,toasts,changeSession:()=>epoch++};
}
test('Join login clears private data and ignores responses after hide/unload or session replacement',async()=>{
 for(const change of ['hide','unload','session']){const wait=deferred(),f=form({ensureIdentity:()=>wait.promise});const pending=f.life.show();f.page.code.value='private-code';f.page.profileName.value='private-name';if(change==='session')f.changeSession();else f.life[change]();wait.resolve(account);await pending;
  assert.equal(f.page.identity.value,undefined);assert.equal(f.page.code.value,'');assert.equal(f.page.profileName.value,'');assert.equal(f.page.loading.value,false);
 }
});
test('Newest login response wins, including older failures',async()=>{
 for(const reject of [false,true]){const wait=deferred();let calls=0;const f=form({ensureIdentity:()=>++calls===1?wait.promise:Promise.resolve({...account,user:{...account.user,nickname:'新名字'}})});const old=f.life.show();await f.page.login();if(reject)wait.reject(Error('旧错误'));else wait.resolve(account);await old;
  assert.equal(f.page.profileName.value,'新名字');assert.equal(f.page.error.value,'');assert.equal(f.page.loading.value,false);
 }
});
test('Create and redeem validate inputs and submit exact captured fields once',async()=>{
 const sent=[],wait=deferred(),f=form({identityRequest:(url,method,data)=>{sent.push({url,method,data});return wait.promise;}});await f.life.show();
 for(const value of ['', 'x'.repeat(31),'中'.repeat(32)]){f.page.code.value=value;await f.page.submit('join');}
 f.page.name.value=' '.repeat(2);await f.page.submit('create');f.page.name.value='a'.repeat(41);await f.page.submit('create');assert.equal(sent.length,0);
 f.page.code.value='  '+'x'.repeat(32)+' ';const pending=f.page.submit('join');f.page.code.value='y'.repeat(32);await f.page.submit('create');await f.page.submit('join');assert.equal(sent.length,1);assert.equal(sent[0].url,'/invitations/redeem');assert.equal(sent[0].data.code,'x'.repeat(32));
 wait.resolve({identity:account,data:joined});await pending;assert.equal(f.stored[0].householdId,'house-b');assert.deepEqual(Array.from(f.stored[0].roles),['GUEST']);assert.equal(f.routes[0],'/pages/profile/index');assert.equal(f.page.code.value,'');assert.equal(f.page.busy.value,false);
 const created=[],g=form({identityRequest:async(url,method,data)=>{created.push({url,data});return{identity:account,data:{id:'new-house',name:data.name,membershipId:'new-member'}};}});await g.life.show();g.page.name.value=' 幸福的家 ';await g.page.submit('create');assert.equal(created[0].url,'/households');assert.equal(created[0].data.name,'幸福的家');assert.equal(g.stored[0].membershipId,'new-member');assert.equal(g.stored[0].roles[0],'ADMIN');
});
test('Create/redeem finishing after hide, unload or account switch never selects a household or navigates',async()=>{
 for(const change of ['hide','unload','session'])for(const action of ['create','join']){const wait=deferred(),f=form({identityRequest:()=>wait.promise});await f.life.show();f.page.code.value='x'.repeat(32);const pending=f.page.submit(action);if(change==='session')f.changeSession();else f.life[change]();wait.resolve({identity:account,data:action==='create'?{id:'house',name:'家',membershipId:'member'}:joined});await pending;
  assert.equal(f.stored.length,0);assert.equal(f.routes.length,0);assert.equal(f.page.identity.value,undefined);assert.equal(f.page.busy.value,false);
 }
});
test('Returning while an old write is pending does not log in again or allow duplicate household creation',async()=>{
 const wait=deferred();let reads=0,writes=0;const f=form({ensureIdentity:async()=>{reads++;return account;},identityRequest:()=>{writes++;return wait.promise;}});await f.life.show();const pending=f.page.submit('create');f.life.hide();await f.life.show();await f.page.submit('create');await f.page.login();assert.equal(reads,1);assert.equal(writes,1);wait.resolve({identity:account,data:{id:'house',name:'家',membershipId:'member'}});await pending;assert.match(f.page.error.value,/重新读取账号确认/);assert.equal(f.stored.length,0);assert.equal(f.routes.length,0);
});
test('Existing household selection refreshes identity, uses stable membership id and the fresh token',async()=>{
 let reads=0;const fresh={...account,accessToken:'fictional-rotated'};const f=form({ensureIdentity:async()=>++reads===1?account:fresh});await f.life.show();await f.page.enterExisting('member-a');assert.equal(reads,2);assert.equal(f.stored[0].accessToken,'fictional-rotated');assert.equal(f.stored[0].membershipId,'member-a');assert.equal(f.routes.length,1);
});
test('Former membership and changed user cannot enter a cached household',async()=>{
 for(const change of ['disabled','different-user']){let reads=0;const f=form({ensureIdentity:async()=>++reads===1?account:{...account,user:{...account.user,id:change==='different-user'?'user-b':'user-a',households:change==='disabled'?[]:account.user.households}}});await f.life.show();await f.page.enterExisting('member-a');assert.equal(f.stored.length,0);assert.equal(f.routes.length,0);assert.match(f.page.error.value,/已变化/);}
});
test('Old logout dialog cannot log out after a new login, session selection, or page hiding',async()=>{
 for(const change of ['login','session','hide','dialog']){let logs=0;const f=form({logoutSession:async()=>logs++});await f.life.show();f.page.logout();if(change==='login')await f.page.login();if(change==='session')f.changeSession();if(change==='hide')f.life.hide();if(change==='dialog')f.page.logout();await f.modals[0].success({confirm:true});assert.equal(logs,0);}
});
test('Logout clears visible identity immediately, prevents duplicate confirmation and reports remote failure honestly',async()=>{
 const wait=deferred();let logs=0;const f=form({logoutSession:()=>{logs++;return wait.promise;}});await f.life.show();f.page.code.value='private-code';f.page.logout();const pending=f.modals[0].success({confirm:true});await f.modals[0].success({confirm:true});assert.equal(logs,1);assert.equal(f.page.identity.value,undefined);assert.equal(f.page.code.value,'');assert.equal(f.page.signedOut.value,true);
 wait.reject(Error('offline'));await pending;assert.match(f.page.error.value,/本机已退出.*远端会话撤销未确认/);assert.equal(f.toasts.length,0);f.life.hide();await f.life.show();assert.equal(f.page.identity.value,undefined);await f.page.login();assert.equal(f.page.identity.value.user.id,'user-a');assert.equal(f.page.signedOut.value,false);
});
test('Logout result arriving after leaving does not show a success toast on a different page',async()=>{
 const wait=deferred(),f=form({logoutSession:()=>wait.promise});await f.life.show();f.page.logout();const pending=f.modals[0].success({confirm:true});f.life.hide();wait.resolve();await pending;assert.equal(f.toasts.length,0);assert.equal(f.page.busy.value,false);
});
test('Nickname validation, captured value, failed draft retention and successful refresh match actual return',async()=>{
 const sent=[];let fail=true;const f=form({updateMyProfile:async nickname=>{sent.push(nickname);if(fail)throw Error('冲突');return{...account,user:{...account.user,nickname}};}});await f.life.show();for(const value of ['','a'.repeat(31)]){f.page.profileName.value=value;await f.page.saveProfile();}assert.equal(sent.length,0);
 f.page.profileName.value=' 老婆 ';await f.page.saveProfile();assert.equal(sent[0],'老婆');assert.equal(f.page.profileName.value,' 老婆 ');fail=false;await f.page.saveProfile();assert.equal(f.page.profileName.value,'老婆');assert.equal(f.page.identity.value.user.nickname,'老婆');
});
test('Nickname result after leaving and permission failures never expose old identity',async()=>{
 const wait=deferred(),f=form({updateMyProfile:()=>wait.promise});await f.life.show();const pending=f.page.saveProfile();f.life.hide();wait.resolve(account);await pending;assert.equal(f.page.identity.value,undefined);assert.equal(f.toasts.length,0);
 for(const status of [401,403]){const g=form({identityRequest:async()=>{throw new ApiError('denied',status);}});await g.life.show();g.page.code.value='x'.repeat(32);await g.page.submit('join');assert.equal(g.page.identity.value,undefined);assert.equal(g.page.code.value,'');assert.equal(g.page.busy.value,false);}
});
test('Navigation failure says household was selected rather than inviting a duplicate creation',async()=>{
 const f=form({navigate:input=>input.fail({errMsg:'navigation failed'})});await f.life.show();f.page.code.value='x'.repeat(32);await f.page.submit('join');assert.equal(f.stored.length,1);assert.match(f.page.error.value,/家庭已选定.*跳转失败/);assert.equal(f.page.code.value,'');await f.page.submit('create');assert.equal(f.stored.length,1);assert.equal(f.page.selectedFamily.value,true);
});
