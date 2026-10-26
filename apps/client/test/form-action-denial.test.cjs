const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');
const ROOT = path.resolve(__dirname, '..');
class ApiError extends Error { constructor(message, statusCode) { super(message); this.statusCode = statusCode; } }
const context = { householdId:'house-a', membershipId:'member-a', effectivePermissions:{ archive:'MANAGE', favorites:'MANAGE', tasks:'MANAGE', recipes:'EDIT' } };
const field = { id:'field-a', key:'contact', label:'家庭联系人', valueType:'CONTACT', sensitive:true, visibility:'MANAGERS', version:3, valueVersion:7, hasValue:true, canEdit:true, grants:[], updatedAt:null };
const favorite = { id:'favorite-a', version:3, title:'私有收藏', type:'TEXT', text:'虚构收藏内容', visibility:'PRIVATE', tags:[], assetIds:[], createdById:'member-a', createdBy:{ id:'member-a', user:{ nickname:'虚构成员' } } };
const task = { id:'task-a', version:6, type:'TODO', title:'虚构待办', description:'虚构说明', assigneeMembershipId:'member-a', assignee:{ id:'member-a', user:{ nickname:'虚构成员' } }, createdBy:{ id:'member-a', user:{ nickname:'虚构成员' } }, priority:'NORMAL', status:'PENDING', dueAt:null, reminderAt:null, history:[] };
const allowed = (c,m,l='VIEW') => ({VIEW:1,EDIT:2,MANAGE:3}[c?.effectivePermissions?.[m]]||0)>={VIEW:1,EDIT:2,MANAGE:3}[l];
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function evaluate(source,deps,uni={}){
  const module={exports:{}};
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unexpected import '+id);},uni,Date,Math,Promise,Error,console});
  return module.exports;
}
const tripForm=evaluate(fs.readFileSync(path.join(ROOT,'src/services/trip-form.ts'),'utf8'),{});
function fixture(kind,api={}){
  const lifecycle={},toasts=[],modals=[];let access=context;
  const uni={showToast:input=>toasts.push(input.title),showModal:input=>modals.push(input),navigateTo(){}};
  const filename=path.join(ROOT,`src/pages/${kind}/index.vue`),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'form-action-denial',inlineTemplate:false});
  const page=evaluate(script.content,{
    vue,'@dcloudio/uni-app':{onShow:fn=>lifecycle.show=fn,onHide:fn=>lifecycle.hide=fn,onUnload:fn=>lifecycle.unload=fn,onLoad(){}},
    '../../services/session':{canAccess:allowed,getStoredSession:()=>access,refreshAccess:async()=>access},
    '../../services/transport':{ApiError},'../../services/trip-form':tripForm,
    '../../services/members-api':{listMembers:async()=>({items:[]})},
    '../../services/family-api':{listArchiveFields:async()=>[field],getArchiveValue:async()=>({value:'虚构已揭露私密内容',valueVersion:7}),
      listFavorites:async()=>[favorite],getFavorite:async()=>favorite,listTasks:async()=>[task],listTaskAssignees:async()=>[task.assignee],getTask:async()=>task,...api},
  },uni).default.setup({},{expose(){}});
  async function render(){
    const compiled=compileTemplate({source:descriptor.template.content,filename,id:'form-action-denial',compilerOptions:{bindingMetadata:script.bindings,isCustomElement:tag=>['view','text','input','textarea','picker','switch','image','button'].includes(tag)}});
    assert.deepEqual(compiled.errors,[]);
    const {render}=evaluate(compiled.code,{vue});let tree;
    const html=await renderToString(vue.createSSRApp({setup:()=>()=>{tree=render({},[],{},vue.proxyRefs(page));return tree;}}));
    const text=v=>Array.isArray(v)?v.map(text).join(''):v&&typeof v==='object'?text(v.children):typeof v==='string'?v:'';
    const find=label=>{const nodes=[];const visit=v=>{if(Array.isArray(v)){v.forEach(visit);return;}if(!v||typeof v!=='object')return;if(typeof v.props?.onTap==='function'&&text(v.children)===label)nodes.push(v);visit(v.children);};visit(tree);assert.equal(nodes.length,1,'Visible action '+label);return nodes[0];};
    return{html,tap:label=>find(label).props.onTap({type:'tap'})};
  }
  return{page,lifecycle,toasts,modals,render,setAccess:c=>access=c};
}
async function prepare(f,kind){await f.lifecycle.show();if(kind==='archive'){f.page.open(field);await f.page.beginEdit();}else if(kind==='favorites'){await f.page.openFavorite(favorite);f.page.editFavorite();}else{await f.page.openTask(task);f.page.editTask();}}
async function save(f,kind){return kind==='archive'?f.page.saveValue():f.page.save();}
for(const kind of ['archive','favorites','tasks'])for(const statusCode of [401,403]){
  test(`${kind} current ${statusCode} clears private rows, editor authority and revealed content`,async()=>{
    const reject=async()=>{throw new ApiError('权限已失效',statusCode);};
    const f=fixture(kind,{setArchiveValue:reject,updateFavorite:reject,updateTask:reject});
    await prepare(f,kind);await save(f,kind);
    assert.equal(f.page.session.value,undefined);assert.equal(f.page.selected.value,undefined);
    assert.equal(f.page[kind==='archive'?'fields':kind==='favorites'?'favorites':'tasks'].value.length,0);
    if(kind==='archive'){assert.equal(f.page.value.value,'');assert.equal(f.page.revealed.value,false);assert.equal(f.page.editingValue.value,false);}
    assert.doesNotMatch((await f.render()).html,/虚构已揭露私密内容|虚构收藏内容|虚构说明/);
    assert.equal(f.toasts.at(-1),'权限已失效');
  });
}
for(const kind of ['archive','favorites','tasks']){
  test(`${kind} 409 retains the same editable draft and original version`,async()=>{
    const reject=async()=>{throw new ApiError('版本冲突',409);};const f=fixture(kind,{setArchiveValue:reject,updateFavorite:reject,updateTask:reject});
    await prepare(f,kind);await save(f,kind);assert.ok(f.page.session.value);assert.ok(f.page.selected.value);
    if(kind==='archive'){assert.equal(f.page.value.value,'虚构已揭露私密内容');assert.equal(f.page.valueVersion.value,7);assert.equal(f.page.editingValue.value,true);}
    else{assert.equal(f.page.form.value.title,kind==='favorites'?favorite.title:task.title);assert.equal(f.page[kind==='favorites'?'showForm':'showingForm'].value,true);}
    assert.equal(f.toasts.at(-1),'版本冲突');
  });
  for(const leave of ['hide','new-identity'])test(`${kind} delayed denial after ${leave} cannot clear a newer page`,async()=>{
    const wait=deferred(),f=fixture(kind,{setArchiveValue:()=>wait.promise,updateFavorite:()=>wait.promise,updateTask:()=>wait.promise});await prepare(f,kind);
    const pending=save(f,kind);await new Promise(setImmediate);
    if(leave==='hide'){f.lifecycle.hide();await f.lifecycle.show();}
    else{f.page.session.value={...context,membershipId:'member-b'};}
    const next={...f.page.session.value};const rows=f.page[kind==='archive'?'fields':kind==='favorites'?'favorites':'tasks'].value.length;
    wait.reject(new ApiError('旧请求被拒绝',403));await pending;
    assert.equal(f.page.session.value?.membershipId,next.membershipId);assert.equal(f.page[kind==='archive'?'fields':kind==='favorites'?'favorites':'tasks'].value.length,rows);assert.ok(!f.toasts.includes('旧请求被拒绝'));
  });
}
test('Favorite committed create plus failed refresh keeps its target, shows saved outcome and retries reads only',async()=>{
  let writes=0,reads=0;const saved={...favorite,id:'favorite-new'};
  const f=fixture('favorites',{createFavorite:async()=>{writes++;return saved;},listFavorites:async()=>{if(++reads===2)throw new ApiError('列表读取失败',503);return[saved];},getFavorite:async()=>saved});
  await f.lifecycle.show();f.page.newFavorite();f.page.form.value.title='新灵感';f.page.form.value.text='虚构正文';await f.page.save();
  assert.equal(writes,1);assert.match((await f.render()).html,/已保存.*刷新失败/);
  await(await f.render()).tap('重试读取');assert.equal(writes,1);assert.equal(f.page.selected.value.id,saved.id);
});
test('Archive committed field create plus failed refresh keeps its target and retries reads only',async()=>{
  let writes=0,reads=0;const saved={...field,id:'field-new'};
  const f=fixture('archive',{createArchiveField:async()=>{writes++;return saved;},listArchiveFields:async()=>{if(++reads===2)throw new ApiError('列表读取失败',503);return[saved];}});
  await f.lifecycle.show();f.page.newField();f.page.form.value.key='new_contact';f.page.form.value.label='新字段';await f.page.saveField();
  assert.equal(writes,1);assert.match((await f.render()).html,/已保存.*刷新失败/);
  await(await f.render()).tap('重试读取');assert.equal(writes,1);assert.equal(f.page.selected.value.id,saved.id);assert.equal(f.page.revealed.value,false);
});

for(const kind of ['archive','favorites','tasks']){
  test(`${kind} current missing-resource response drops only its target and private editor`,async()=>{
    const reject=async()=>{throw new ApiError('资源不存在',404);};
    const f=fixture(kind,{setArchiveValue:reject,updateFavorite:reject,updateTask:reject});
    await prepare(f,kind);
    const list=f.page[kind==='archive'?'fields':kind==='favorites'?'favorites':'tasks'];
    list.value.push({...list.value[0],id:'unrelated-row'});
    await save(f,kind);
    assert.equal(f.page.session.value.membershipId,context.membershipId);
    assert.deepEqual(Array.from(list.value,row=>row.id),['unrelated-row']);
    assert.equal(f.page.selected.value,undefined);assert.equal(f.page.busy.value,false);
    assert.equal(f.page[kind==='archive'?'showFieldForm':kind==='favorites'?'showForm':'showingForm'].value,false);
    if(kind==='archive'){assert.equal(f.page.value.value,'');assert.equal(f.page.revealed.value,false);}
    assert.equal(f.toasts.at(-1),'资源不存在');
  });
  test(`${kind} delayed denial for an older resource cannot clear another open resource`,async()=>{
    const wait=deferred(),f=fixture(kind,{setArchiveValue:()=>wait.promise,updateFavorite:()=>wait.promise,updateTask:()=>wait.promise});
    await prepare(f,kind);const pending=save(f,kind);await new Promise(setImmediate);
    if(kind==='archive')f.page.open({...field,id:'field-b'});
    else if(kind==='favorites'){f.page.close();f.page.selected.value={...favorite,id:'favorite-b'};}
    else{f.page.closeTask();f.page.selected.value={...task,id:'task-b'};}
    const id=f.page.selected.value.id;
    wait.reject(new ApiError('旧资源已撤权',403));await pending;
    assert.equal(f.page.selected.value.id,id);assert.equal(f.page.session.value.membershipId,context.membershipId);
    assert.ok(!f.toasts.includes('旧资源已撤权'));assert.equal(f.page.busy.value,false);
  });
}

const denialActions={
  archive:[
    ['reveal',async f=>{f.page.revealed.value=false;await f.page.reveal();}],
    ['definition-save',async f=>{f.page.editField();await f.page.saveField();}],
    ['archive',async f=>{f.page.askArchive();await f.modals.at(-1).success({confirm:true});}],
  ],
  favorites:[
    ['detail',async f=>f.page.openFavorite(favorite)],
    ['archive',async f=>{f.page.askArchive();await f.modals.at(-1).success({confirm:true});}],
    ['conversion',async f=>{f.page.startConvert();await f.page.runConvert();}],
    ['image-preview',async f=>{f.page.selected.value={...favorite,assetIds:['asset-a']};await f.page.preview(0);}],
  ],
  tasks:[
    ['detail',async f=>f.page.openTask(task)],
    ['status',async f=>f.page.changeStatus('COMPLETED')],
    ['comment',async f=>{f.page.comment.value='虚构处理记录';await f.page.saveComment();}],
  ],
};
for(const kind of ['archive','favorites','tasks'])for(const statusCode of [401,403]){
  test(`${kind} all remaining action handlers clear authority on current ${statusCode}`,async()=>{
    for(const [action,run]of denialActions[kind]){
      let armed=false,calls=0;
      const denied=async fallback=>{if(armed){calls++;throw new ApiError('当前动作已撤权',statusCode);}return fallback;};
      const f=fixture(kind,{
        getArchiveValue:()=>denied({value:'虚构已揭露私密内容',valueVersion:7}),updateArchiveField:()=>denied(field),archiveArchiveField:()=>denied(field),
        getFavorite:()=>denied(favorite),archiveFavorite:()=>denied(favorite),convertFavorite:()=>denied({targetType:'RECIPE',targetId:'draft-a'}),getMediaReadUrl:()=>denied({path:'/virtual-image'}),publicMediaUrl:path=>path,
        getTask:()=>denied(task),updateTaskStatus:()=>denied(task),addTaskComment:()=>denied(task),
      });
      await prepare(f,kind);
      // These are direct detail actions, not editing-form submit actions.
      if(kind==='favorites')f.page.showForm.value=false;
      if(kind==='tasks')f.page.showingForm.value=false;
      armed=true;await run(f);
      assert.equal(calls,1,action);assert.equal(f.page.session.value,undefined,action);assert.equal(f.page.selected.value,undefined,action);
      assert.equal(f.page[kind==='archive'?'fields':kind==='favorites'?'favorites':'tasks'].value.length,0,action);
      if(kind==='archive'){assert.equal(f.page.value.value,'',action);assert.equal(f.page.revealed.value,false,action);}
      assert.doesNotMatch((await f.render()).html,/虚构已揭露私密内容|虚构收藏内容|虚构说明/);
      assert.equal(f.toasts.at(-1),'当前动作已撤权',action);
    }
  });
}

test('Favorite conversion conflict retains its original idempotency key and confirmed draft text',async()=>{
  const sent=[],f=fixture('favorites',{convertFavorite:async(_item,input)=>{sent.push(input);throw new ApiError('版本冲突',409);}});
  await f.lifecycle.show();await f.page.openFavorite(favorite);f.page.startConvert();
  f.page.convertTitle.value='保留的虚构草稿';f.page.convertDescription.value='确认说明';const key=f.page.convertKey.value;
  await f.page.runConvert();await f.page.runConvert();
  assert.equal(sent.length,2);assert.ok(key.length>=8);assert.equal(sent[0].idempotencyKey,key);assert.equal(sent[1].idempotencyKey,key);
  assert.equal(f.page.convertKey.value,key);assert.equal(f.page.convertOpen.value,true);
  assert.equal(f.page.convertTitle.value,'保留的虚构草稿');assert.equal(f.page.convertDescription.value,'确认说明');assert.equal(f.page.busy.value,false);
});

test('Task cancellation confirmation from a former identity cannot cancel the new identity task',async()=>{
  const sent=[],f=fixture('tasks',{updateTaskStatus:async(row,status)=>{sent.push({id:row.id,status});return{...row,status};}});
  await f.lifecycle.show();await f.page.openTask(task);f.page.cancelTask();
  f.page.session.value={...context,membershipId:'member-b'};
  f.page.selected.value={...task,id:'task-b',assigneeMembershipId:'member-b'};
  f.page.tasks.value=[f.page.selected.value];
  await f.modals.at(-1).success({confirm:true});await new Promise(setImmediate);
  assert.deepEqual(sent,[]);assert.equal(f.page.selected.value.id,'task-b');assert.equal(f.page.selected.value.status,'PENDING');
  assert.equal(f.page.session.value.membershipId,'member-b');assert.deepEqual(f.toasts,[]);
});

for(const change of ['target','version'])test(`Task old cancellation confirmation expires after same-identity ${change} changes`,async()=>{
  const sent=[],f=fixture('tasks',{updateTaskStatus:async(row,status)=>{sent.push({id:row.id,version:row.version,status});return{...row,status};}});
  await f.lifecycle.show();await f.page.openTask(task);f.page.cancelTask();
  if(change==='target')f.page.selected.value={...task,id:'task-b'};
  else f.page.selected.value.version++;
  const current={id:f.page.selected.value.id,version:f.page.selected.value.version};
  await f.modals.at(-1).success({confirm:true});await new Promise(setImmediate);
  assert.deepEqual(sent,[]);assert.equal(f.page.selected.value.id,current.id);assert.equal(f.page.selected.value.version,current.version);
  assert.equal(f.page.selected.value.status,'PENDING');assert.equal(f.page.session.value.membershipId,context.membershipId);assert.deepEqual(f.toasts,[]);
});

test('Task cancellation confirmation keeps its captured target and version on an unchanged authorized page',async()=>{
  const sent=[],f=fixture('tasks',{updateTaskStatus:async(row,status)=>{sent.push({id:row.id,version:row.version,status});return{...row,status,version:row.version+1};}});
  await f.lifecycle.show();await f.page.openTask(task);f.page.cancelTask();
  await f.modals.at(-1).success({confirm:true});await new Promise(setImmediate);
  assert.deepEqual(sent,[{id:task.id,version:task.version,status:'CANCELLED'}]);
  assert.equal(f.page.selected.value.status,'CANCELLED');assert.equal(f.page.selected.value.version,task.version+1);assert.equal(f.page.busy.value,false);
});

test('Task cancellation confirmation still rechecks current edit authority after a same-identity downgrade',async()=>{
  let sent=0;const f=fixture('tasks',{updateTaskStatus:async()=>{sent++;return task;}});
  await f.lifecycle.show();await f.page.openTask(task);f.page.cancelTask();
  f.page.session.value={...context,effectivePermissions:{tasks:'VIEW'}};
  await f.modals.at(-1).success({confirm:true});await new Promise(setImmediate);
  assert.equal(sent,0);assert.equal(f.page.selected.value.status,'PENDING');assert.equal(f.page.busy.value,false);
});
