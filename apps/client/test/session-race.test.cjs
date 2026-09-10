const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const ROOT=path.resolve(__dirname,'..');
class ApiError extends Error{constructor(message,statusCode){super(message);this.statusCode=statusCode;}}
const family={householdId:'house-a',membershipId:'member-a',householdName:'家',roles:['MEMBER'],version:1,permissionVersion:1,effectivePermissions:{recipes:'VIEW'},accessToken:'fictional-old'};
const user={id:'user-a',households:[{membershipId:'member-a',household:{id:'house-a',name:'家'},roles:['MEMBER'],status:'ACTIVE'}]};
const login={accessToken:'fictional-new',refreshToken:'fictional-refresh-new',user};
const access={roles:['MEMBER'],version:2,permissionVersion:2,effectivePermissions:{recipes:'EDIT'}};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const tick=()=>new Promise(setImmediate);
function setup(request,options={}){
 const values=new Map(),routes=[],codes=[],calls=[];
 const uni={getStorageSync:key=>values.get(key),setStorageSync:(key,value)=>values.set(key,value),removeStorageSync:key=>values.delete(key),navigateTo:value=>{routes.push(value.url);value.complete?.();},login:input=>options.holdCode?codes.push(input):input.success({code:'fictional-code'})};
 function load(file,deps){const module={exports:{}},code=ts.transpileModule(fs.readFileSync(path.join(ROOT,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unexpected import '+id);},uni,Date,Error,Promise,Map,Set});return module.exports;}
 const transport={ApiError,rawRequest:async(...args)=>{calls.push(args);return request(...args);},rawBinaryRequest:async(...args)=>{calls.push(args);return request(...args);}};
 const session=load('src/services/session.ts',{'./transport':transport});
 return{session,values,calls,routes,codes,api:file=>load(file,{'./session':session,'./transport':transport,'./config':{API_BASE_URL:'https://example.test/api/v1'}})};
}
test('Clearing session invalidates an in-flight permission read without restoring storage',async()=>{
 const wait=deferred(),f=setup(()=>wait.promise);f.session.rememberSession(family);const result=f.session.refreshAccess().catch(e=>e);await tick();f.session.clearSession();wait.resolve(access);assert.ok(await result instanceof Error);assert.equal(f.session.getStoredSession(),undefined);assert.equal(f.values.size,0);
});
test('Switched household is not overwritten or removed by a previous permission result or 403',async()=>{
 for(const reject of [false,true]){const wait=deferred(),f=setup(()=>wait.promise);f.session.rememberSession(family);const result=f.session.refreshAccess().catch(e=>e);await tick();f.session.rememberSession({...family,householdId:'house-b',membershipId:'member-b'});if(reject)wait.reject(new ApiError('disabled',403));else wait.resolve(access);assert.ok(await result instanceof Error);assert.equal(f.session.getStoredSession().householdId,'house-b');}
});
test('Logout clears locally immediately, and its late failure does not clear a new login',async()=>{
 const wait=deferred(),f=setup(()=>wait.promise);f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');const result=f.session.logoutSession().catch(e=>e);assert.equal(f.session.getStoredSession(),undefined);f.session.rememberSession({...family,householdId:'house-b'});wait.reject(Error('offline'));assert.ok(await result instanceof Error);assert.equal(f.session.getStoredSession().householdId,'house-b');
});
test('Late refresh tokens and WeChat login responses cannot resurrect a cleared account',async()=>{
 for(const mode of ['refresh','wechat']){const wait=deferred(),f=setup(()=>wait.promise);if(mode==='refresh')f.values.set('kkfamily.refreshToken','fictional-r');const result=(mode==='refresh'?f.session.renewIdentity():f.session.ensureIdentity()).catch(e=>e);await tick();f.session.clearSession();wait.resolve(login);assert.ok(await result instanceof Error);assert.equal(f.values.size,0);}
});
test('Clearing while wx.login awaits code prevents the subsequent login network request',async()=>{
 const f=setup(async()=>login,{holdCode:true});const result=f.session.ensureIdentity().catch(e=>e);f.session.clearSession();f.codes[0].success({code:'late-code'});assert.ok(await result instanceof Error);assert.equal(f.calls.length,0);assert.equal(f.values.size,0);
});
test('Old promise cleanup does not remove a new pending login or cause a third request',async()=>{
 const first=deferred(),second=deferred();let requests=0;const f=setup(()=>++requests===1?first.promise:second.promise);
 const old=f.session.ensureIdentity().catch(e=>e);await tick();f.session.clearSession();const current=f.session.ensureIdentity();await tick();first.resolve(login);await old;const joined=f.session.ensureIdentity();await tick();const count=requests;second.resolve(login);await Promise.all([current,joined]);assert.equal(count,2);
});
test('Network refresh failure does not silently discard refresh token and restart WeChat login',async()=>{
 const f=setup(async()=>{throw Error('offline');});f.values.set('kkfamily.refreshToken','fictional-r');await assert.rejects(f.session.renewIdentity(),/offline/);assert.equal(f.values.get('kkfamily.refreshToken'),'fictional-r');assert.equal(f.calls.length,1);
});
test('A slower old access read cannot roll back newer permission version',async()=>{
 const wait=deferred();let reads=0;const f=setup(()=>++reads===1?wait.promise:Promise.resolve({...access,version:3,permissionVersion:3}));f.session.rememberSession(family);const old=f.session.refreshAccess().catch(e=>e);await tick();await f.session.refreshAccess();wait.resolve(access);await old;assert.equal(f.session.getStoredSession().permissionVersion,3);
});
test('Permission response preserves a token rotated while it was in flight',async()=>{
 const wait=deferred(),f=setup(async endpoint=>endpoint==='/auth/refresh'?login:wait.promise);f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');const pending=f.session.refreshAccess();await tick();await f.session.renewIdentity();wait.resolve(access);await pending;assert.equal(f.session.getStoredSession().accessToken,login.accessToken);
});
test('Renewal never switches to another available household when the requested one is unavailable',async()=>{
 const f=setup(async()=>({...login,user:{...user,households:[{...user.households[0],household:{id:'house-b',name:'另一个家'}}]}}));f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');await assert.rejects(f.session.renewSession('house-a'));assert.notEqual(f.session.getStoredSession()?.householdId,'house-b');
});
for(const mode of ['family-json','family-binary','members']){
 test(mode+' API drops stale success/401 after logout or household switch without renewing or retrying',async()=>{
  for(const change of ['logout','household'])for(const status of [200,401]){
   const wait=deferred(),f=setup(()=>wait.promise);f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');
   const api=f.api(mode==='members'?'src/services/members-api.ts':'src/services/family-api.ts');
   const pending=(mode==='members'?api.createInvitation(['GUEST'],[]):mode==='family-binary'?api.uploadMediaContent('/media/upload-intents/a/content',new ArrayBuffer(1),'image/png'):api.addShoppingItem({name:'苹果'})).catch(e=>e);
   await tick();if(change==='logout')f.session.clearSession();else f.session.rememberSession({...family,householdId:'house-b',membershipId:'member-b'});
   if(status===401)wait.reject(new ApiError('expired',401));else wait.resolve({id:'old'});assert.ok(await pending instanceof Error);assert.equal(f.calls.length,1);
   assert.equal(f.session.getStoredSession()?.householdId,change==='logout'?undefined:'house-b');
  }
 });
}
test('API request cancelled while awaiting session does not send its body under a new identity',async()=>{
 const f=setup(async()=>({}));f.session.rememberSession(family);const api=f.api('src/services/members-api.ts');const pending=api.createInvitation(['GUEST'],[]).catch(e=>e);f.session.rememberSession({...family,householdId:'house-b',membershipId:'member-b'});assert.ok(await pending instanceof Error);assert.equal(f.calls.length,0);
});
test('Simultaneous and delayed 401 responses share a single token rotation, keeping original headers',async()=>{
 const late=deferred();let reads=0,rotations=0;
 const f=setup(async(endpoint,method,data,headers)=>{
  if(endpoint==='/auth/refresh'){rotations++;return login;}
  reads++;if(headers.Authorization==='Bearer fictional-old'){if(reads===1)throw new ApiError('expired',401);return late.promise;}
  assert.equal(headers['X-Household-Id'],'house-a');return[];
 });f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');const api=f.api('src/services/family-api.ts');
 const first=api.listRecipes(),second=api.listInventory();await first;late.reject(new ApiError('expired',401));await second;assert.equal(rotations,1);assert.equal(reads,4);assert.equal(f.session.getStoredSession().accessToken,'fictional-new');
});
test('Permission retry that returns 403 clears household context, and does not retry again',async()=>{
 let reads=0;const f=setup(async endpoint=>{if(endpoint==='/auth/refresh')return login;if(++reads===1)throw new ApiError('expired',401);throw new ApiError('disabled',403);});f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');await assert.rejects(f.session.refreshAccess(),e=>e.statusCode===403);assert.equal(f.session.getStoredSession(),undefined);assert.equal(reads,2);
});
test('Older forbidden access result cannot clear the newest successful authorization',async()=>{
 const wait=deferred();let reads=0;const f=setup(()=>++reads===1?wait.promise:Promise.resolve(access));f.session.rememberSession(family);const old=f.session.refreshAccess().catch(e=>e);await tick();await f.session.refreshAccess();wait.reject(new ApiError('old-forbidden',403));await old;assert.equal(f.session.getStoredSession().permissionVersion,2);
});
test('Identity-scoped write does not retry under a different user returned by renewal',async()=>{
 let writes=0;const f=setup(async(endpoint,method)=>{if(endpoint==='/auth/me')return{user};if(endpoint==='/auth/refresh')return{...login,user:{...user,id:'different-user'}};writes++;throw new ApiError('expired',401);});f.session.rememberSession(family);f.values.set('kkfamily.refreshToken','fictional-r');await assert.rejects(f.session.identityRequest('/invitations/redeem','POST',{code:'fictional'}),/账号已变化/);assert.equal(writes,1);assert.equal(f.session.getStoredSession(),undefined);
});
test('New concurrent renewals still join after a cleared older rotation settles',async()=>{
 const first=deferred(),second=deferred();let calls=0;const f=setup(()=>++calls===1?first.promise:second.promise);f.values.set('kkfamily.refreshToken','first-r');const old=f.session.renewIdentity().catch(e=>e);f.session.clearSession();f.values.set('kkfamily.refreshToken','second-r');const current=f.session.renewIdentity();first.resolve(login);await old;const joined=f.session.renewIdentity();await tick();assert.equal(calls,2);second.resolve(login);await Promise.all([current,joined]);assert.equal(f.values.get('kkfamily.refreshToken'),login.refreshToken);
});
