const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');
const { parse, compileScript, compileTemplate } = require('vue/compiler-sfc');
const { renderToString } = require('vue/server-renderer');

const filename = path.resolve(__dirname, '../src/pages/favorites/index.vue');
const context = { householdId:'house-a', membershipId:'member-a', effectivePermissions:{ favorites:'EDIT', recipes:'EDIT', tasks:'EDIT' } };
const favorite = { id:'favorite-a', version:3, title:'周末早餐灵感', type:'TEXT', text:'自己记录的想法', visibility:'PRIVATE', tags:[], assetIds:[], createdById:'member-a', createdBy:{user:{nickname:'虚构成员'}} };
function evaluate(source, dependencies, uni) {
  const module = {exports:{}};
  const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  vm.runInNewContext(compiled.outputText, {module,exports:module.exports,require:id=>{
    if(id in dependencies)return dependencies[id];
    throw Error('Unexpected import '+id);
  },uni,Date,Math,Promise,Error,console});
  return module.exports;
}
function form(api={}) {
  const lifecycle={},toasts=[],routes=[];
  const uni={showToast:input=>toasts.push(input.title),navigateTo:input=>routes.push(input)};
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'favorite-navigation',inlineTemplate:false});
  const page=evaluate(script.content,{
    vue,
    '@dcloudio/uni-app':{onShow:fn=>lifecycle.show=fn,onHide:fn=>lifecycle.hide=fn,onUnload:fn=>lifecycle.unload=fn},
    '../../services/session':{canAccess:(c,m,l='VIEW')=>({VIEW:1,EDIT:2,MANAGE:3}[c?.effectivePermissions?.[m]]||0)>={VIEW:1,EDIT:2,MANAGE:3}[l],refreshAccess:async()=>context},
    '../../services/family-api':api,
  },uni).default.setup({},{expose(){}});
  page.session.value=context;page.selected.value={...favorite};page.startConvert();
  return{page,lifecycle,toasts,routes};
}
async function confirmUsingRenderedButton(page) {
  const {descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'favorite-navigation',inlineTemplate:false});
  const compiled=compileTemplate({source:descriptor.template.content,filename,id:'favorite-navigation',compilerOptions:{bindingMetadata:script.bindings,isCustomElement:tag=>['view','text','input','textarea','picker','image'].includes(tag)}});
  assert.deepEqual(compiled.errors,[]);
  const {render}=evaluate(compiled.code,{vue},{});let tree;
  await renderToString(vue.createSSRApp({setup:()=>()=>{tree=render({},[],{},vue.proxyRefs(page));return tree;}}));
  const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.children):typeof value==='string'?value:'';
  const buttons=[];
  const visit=value=>{if(Array.isArray(value)){value.forEach(visit);return;}if(!value||typeof value!=='object')return;
    if(value.type==='view'&&text(value.children)==='确认创建草稿')buttons.push(value);
    visit(value.children);
  };visit(tree);
  assert.equal(buttons.length,1);assert.equal(typeof buttons[0].props.onTap,'function');
  await buttons[0].props.onTap({});
}

for(const [index,targetType,prefix] of [[0,'RECIPE','recipe-editor'],[1,'TASK','tasks']]){
  test(`Favorite ${targetType}: failed navigation retries the original idempotent conversion`,async()=>{
    const requests=[],created=new Map();
    const {page,toasts,routes}=form({convertFavorite:async(item,input)=>{
      requests.push({id:item.id,version:item.version,...input});
      assert.ok(input.idempotencyKey.length>=8,'Retry must satisfy the real DTO minimum length');
      const repeated=created.has(input.idempotencyKey);
      if(!repeated)created.set(input.idempotencyKey,{targetType,targetId:'draft /a'});
      return{...created.get(input.idempotencyKey),repeated};
    }});
    page.convertIndex.value=index;
    const key=page.convertKey.value;
    await confirmUsingRenderedButton(page);
    assert.equal(requests.length,1);assert.equal(created.size,1);
    assert.equal(routes[0].url,`/pages/${prefix}/index?id=draft%20%2Fa`);
    routes[0].fail?.({errMsg:'navigateTo:fail page stack limit exceeded'});
    assert.match(toasts.at(-1),/草稿已.*打开失败.*重试/);
    assert.equal(page.convertKey.value,key);assert.equal(page.convertOpen.value,true);assert.equal(page.busy.value,false);
    await confirmUsingRenderedButton(page);
    assert.equal(requests.length,2);assert.equal(requests[1].idempotencyKey,key);
    assert.equal(requests[1].targetType,targetType);assert.equal(requests[1].confirmedTitle,favorite.title);
    assert.equal(created.size,1);assert.equal(routes[1].url,routes[0].url);
    assert.equal(toasts.includes('已打开原草稿'),false,'Do not claim an already-opened page before navigation succeeds');
  });
}

test('Favorite conversion navigation callbacks after hide, unload or another selection do not affect the new view',async()=>{
  for(const end of ['hide','unload','close']){
    const {page,lifecycle,toasts,routes}=form({convertFavorite:async()=>({targetType:'RECIPE',targetId:'draft-a',repeated:false})});
    await page.runConvert();const count=toasts.length;
    if(end==='close')page.close();else lifecycle[end]();
    page.session.value=context;page.selected.value={...favorite,id:'favorite-b'};page.startConvert();
    const newKey=page.convertKey.value;
    routes[0].fail?.({errMsg:'late navigation failure'});
    assert.equal(toasts.length,count);assert.equal(page.selected.value.id,'favorite-b');assert.equal(page.convertKey.value,newKey);
  }
});

test('Favorite conversion network retry retains the key, while denied targets and duplicate clicks cannot write',async()=>{
  const requests=[];let resolve,failed=true;
  const {page,routes}=form({convertFavorite:async(item,input)=>{
    requests.push(input.idempotencyKey);
    if(failed)throw Error('网络失败');
    return new Promise(yes=>resolve=yes);
  }});
  const key=page.convertKey.value;
  await page.runConvert();assert.equal(page.convertKey.value,key);assert.equal(routes.length,0);
  failed=false;const pending=page.runConvert();await page.runConvert();assert.equal(requests.length,2);
  resolve({targetType:'RECIPE',targetId:'draft-a',repeated:true});await pending;
  assert.deepEqual(requests,[key,key]);assert.equal(routes.length,1);
  page.session.value={...context,effectivePermissions:{favorites:'EDIT'}};
  await page.runConvert();assert.equal(requests.length,2);
});
