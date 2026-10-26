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
const context = { householdId:'house-a', membershipId:'member-a', version:1, effectivePermissions:{trips:'EDIT',packing_templates:'MANAGE'} };
const trip = {id:'trip-a',version:8,title:'周末露营',status:'PENDING',startsAt:'2026-11-01T00:00:00.000Z',endsAt:null,members:[{membershipId:'member-a',tripRole:'OWNER',status:'ACTIVE',canEdit:true,photoAdd:true,version:1,membership:{user:{id:'user-a',nickname:'虚构成员'}}}],preparationGroups:[],stops:[],legs:[]};
const template = {id:'template-a',version:3,createdById:'member-a',archived:false,name:'烧烤准备',description:null,items:[{id:'template-item-a',version:1,name:'天幕',defaultQuantity:null,unit:'顶',note:null,sortOrder:0}]};
class ApiError extends Error { constructor(message,statusCode){super(message);this.statusCode=statusCode;} }
const permission = (session,module,level='VIEW') => ({VIEW:1,EDIT:2,MANAGE:3}[session?.effectivePermissions?.[module]]||0) >= {VIEW:1,EDIT:2,MANAGE:3}[level];
function evaluate(source,dependencies,uni){
  const module={exports:{}};
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  vm.runInNewContext(compiled.outputText,{module,exports:module.exports,require:id=>{if(id in dependencies)return dependencies[id];throw Error('Unexpected import '+id);},uni,Date,Math,Promise,Error,console,setInterval:()=>1,clearInterval(){}},{timeout:1000});
  return module.exports;
}
function load(relative,dependencies,uni,props={}){
  const filename=path.join(ROOT,relative),{descriptor}=parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=compileScript(descriptor,{id:'camping-recovery',inlineTemplate:false});
  const unmounts=[],scope=vue.effectScope(),events=[];
  const page=scope.run(()=>evaluate(script.content,{vue:{...vue,onUnmounted:fn=>unmounts.push(fn)},...dependencies},uni).default.setup(props,{expose(){},emit(...args){events.push(args);}}));
  return{page,props,events,filename,descriptor,script,unmount(){unmounts.forEach(fn=>fn());scope.stop();}};
}
function camping(api={}){
  const lifecycle={},toasts=[];let stored={...context};
  const uni={showToast:input=>toasts.push(input.title),showModal(){}};
  const session={canAccess:permission,getStoredSession:()=>stored,refreshAccess:async()=>stored};
  const target=load('src/pages/camping/index.vue',{
    '@dcloudio/uni-app':{onShow:fn=>lifecycle.show=fn,onHide:fn=>lifecycle.hide=fn,onUnload:fn=>lifecycle.unload=fn},
    '../../components/trip-itinerary.vue':{},'../../components/trip-photos.vue':{},
    '../../services/session':session,'../../services/calendar-navigation':{takeCalendarTarget:()=>undefined},
    '../../services/trip-form':{},'../../services/transport':{ApiError},'../../services/trip-native':{},
    '../../services/family-api':{listTrips:async()=>[trip],getTrip:async()=>trip,listTripPackingItems:async()=>[],listTripCandidates:async()=>[],listPackingTemplates:async()=>[],...api},
  },uni);
  target.page.pageVisible.value=true;target.page.session.value=stored;
  return{...target,uni,lifecycle,toasts,setStored:value=>{stored=value;}};
}
function itinerary(api={},extras={}){
  const dialogs=[],toasts=[],props=vue.reactive({trip:{...trip},canEdit:true,active:true,...extras});
  const uni={showToast:input=>toasts.push(input.title),showModal:input=>dialogs.push(input)};
  const target=load('src/components/trip-itinerary.vue',{
    '../services/trip-form':{},'../services/transport':{ApiError},
    '../services/family-api':{getTripItinerary:async()=>({tripVersion:trip.version,stops:[],legs:[],accommodations:[]}),...api},
  },uni,props);
  return{...target,dialogs,toasts};
}
function text(value){return Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.children):typeof value==='string'?value:'';}
async function rendered(target){
  const compiled=compileTemplate({source:target.descriptor.template.content,filename:target.filename,id:'camping-recovery',compilerOptions:{bindingMetadata:target.script.bindings,isCustomElement:tag=>['view','text','input','textarea','picker','image','map','checkbox','checkbox-group','label'].includes(tag)}});
  assert.deepEqual(compiled.errors,[]);
  const {render}=evaluate(compiled.code,{vue},{}),nodes=[];
  function visit(node){if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;nodes.push(node);visit(node.children);}
  await renderToString(vue.createSSRApp({setup:()=>()=>{const tree=render({},[],target.props,vue.proxyRefs(target.page));visit(tree);return tree;}}));
  return nodes;
}
async function tapText(target,label){const nodes=await rendered(target),button=nodes.find(node=>text(node.children)===label&&typeof node.props?.onTap==='function');assert.ok(button,`Missing rendered action: ${label}`);await button.props.onTap({});}
function newTemplate(target){target.page.switchView('templates');target.page.newTemplate();target.page.templateForm.value.name=template.name;target.page.templateForm.value.items[0].name='天幕';}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const point=(id,title)=>({id,version:1,title,stopType:'CAMPSITE',latitude:39,longitude:116,arriveAt:null,leaveAt:null,note:null});
const a=point('a','集合点'),b=point('b','营地'),c=point('c','民宿');
const leg=(id,fromStop,toStop)=>({id,version:5,fromStopId:fromStop.id,toStopId:toStop.id,fromStop,toStop,mode:'DRIVING',routeKind:'SCHEMATIC',geometryJson:null,staleAt:'2026-10-23T00:00:00.000Z'});

test('A saved template survives failed list refresh; its rendered retry reads only and never POSTs again',async()=>{
  let writes=0,reads=0;const target=camping({createPackingTemplate:async()=>{writes++;return template;},listPackingTemplates:async()=>{if(++reads===1)throw Error('网络中断');return[template];}});
  newTemplate(target);await target.page.saveTemplate();
  assert.equal(writes,1);assert.equal(target.page.showingTemplateForm.value,false);assert.equal(target.page.editingTemplateId.value,template.id);
  assert.equal(target.page.templates.value[0].version,template.version);assert.match(target.toasts.at(-1),/已保存.*刷新失败/);
  await target.page.saveTemplate();assert.equal(writes,1,'A stale save event must not submit the already-saved form again');
  await tapText(target,'重新读取模板列表');
  assert.equal(writes,1);assert.equal(reads,2);assert.equal(target.page.templates.value.length,1);assert.equal(target.page.templateRefreshFailed.value,false);
  target.unmount();
});

test('Saved template edits retain new item IDs and version even when refreshed lists fail',async()=>{
  let writes=0;const saved={...template,name:'新的准备模板',version:4,items:[{...template.items[0],id:'new-item',version:1}]};
  const target=camping({updatePackingTemplate:async(row,input)=>{writes++;assert.equal(row.version,3);assert.equal(input.name,saved.name);return saved;},listPackingTemplates:async()=>{throw Error('列表超时');}});
  target.page.switchView('templates');target.page.templates.value=[template];target.page.editTemplate(template);target.page.templateForm.value.name=saved.name;await target.page.saveTemplate();
  assert.equal(writes,1);assert.equal(target.page.templates.value[0].version,4);assert.equal(target.page.templates.value[0].items[0].id,'new-item');assert.equal(target.page.showingTemplateForm.value,false);
  target.page.editTemplate(target.page.templates.value[0]);assert.equal(target.page.templateForm.value.items[0].id,'new-item');assert.match(target.toasts.at(-1),/已保存.*刷新失败/);target.unmount();
});

test('Template refresh recovery retains the original trip target and returns there after read-only retry',async()=>{
  let writes=0,reads=0;const target=camping({createPackingTemplate:async()=>{writes++;return template;},listPackingTemplates:async()=>{if(++reads===1)throw Error('断网');return[template];}});
  target.page.trips.value=[trip];target.page.selectedTripId.value=trip.id;target.page.openTemplateLibrary(true);
  target.page.templateForm.value.name=template.name;target.page.templateForm.value.items[0].name='天幕';await target.page.saveTemplate();
  assert.equal(target.page.templateTripTarget.value.id,trip.id);assert.equal(target.page.active.value,'templates');
  await tapText(target,'重新读取模板列表');assert.equal(writes,1);assert.equal(reads,2);assert.equal(target.page.active.value,'trips');assert.equal(target.page.selectedTripId.value,trip.id);assert.equal(target.page.showingTemplatePicker.value,true);assert.equal(target.page.pageBusy.value,false);target.unmount();
});

test('Failed writes preserve the original draft and never claim successful save or offer read-only retry',async()=>{
  const target=camping({createPackingTemplate:async()=>{throw new ApiError('同名冲突',409);}});newTemplate(target);await target.page.saveTemplate();
  assert.equal(target.page.showingTemplateForm.value,true);assert.equal(target.page.templateForm.value.name,template.name);assert.equal(target.page.editingTemplateId.value,'');assert.equal(target.page.templates.value.length,0);assert.equal(target.page.templateRefreshFailed.value,false);assert.equal(target.toasts.at(-1),'同名冲突');target.unmount();
});

test('Late template save or refresh cannot restore private data after hide or stored identity replacement',async()=>{
  for(const boundary of ['write-hide','write-identity','read-hide','read-identity']){
    const gate=deferred(),target=camping({createPackingTemplate:()=>boundary.startsWith('write')?gate.promise:Promise.resolve(template),listPackingTemplates:()=>gate.promise});
    newTemplate(target);const saving=target.page.saveTemplate();await new Promise(setImmediate);
    if(boundary.endsWith('hide'))target.lifecycle.hide();else target.setStored({...context,membershipId:'another-member'});
    const snapshot={templates:target.page.templates.value.length,toasts:target.toasts.length};
    gate.resolve(boundary.startsWith('write')?template:[template]);await saving;
    assert.equal(target.page.templates.value.length,snapshot.templates,boundary);assert.equal(target.toasts.length,snapshot.toasts,boundary);target.unmount();
  }
});

test('Template refresh auth failure clears private state and never leaves a recovery action for a revoked account',async()=>{
  for(const status of [401,403,404]){
    const target=camping({createPackingTemplate:async()=>template,listPackingTemplates:async()=>{throw new ApiError('访问撤销',status);}});
    newTemplate(target);await target.page.saveTemplate();assert.equal(target.page.templates.value.length,0,status);assert.equal(target.page.session.value,undefined,status);assert.equal(target.page.templateRefreshFailed.value,false,status);target.unmount();
  }
});

test('Template read-only retry is single-flight and late replies cannot reopen a hidden or replaced view',async()=>{
  for(const ending of ['success','hide','identity','hide-forbidden']){
    let reads=0,writes=0;const retry=deferred();
    const target=camping({createPackingTemplate:async()=>{writes++;return template;},listPackingTemplates:async()=>{if(++reads===1)throw Error('首次刷新失败');return retry.promise;}});
    newTemplate(target);await target.page.saveTemplate();
    const pending=target.page.retryTemplateRefresh();await target.page.retryTemplateRefresh();assert.equal(reads,2,ending);assert.equal(target.page.pageBusy.value,true,ending);
    if(ending.startsWith('hide'))target.lifecycle.hide();
    if(ending==='identity')target.setStored({...context,membershipId:'replacement'});
    const before={templates:target.page.templates.value.length,toasts:target.toasts.length};
    if(ending==='hide-forbidden')retry.reject(new ApiError('旧账号撤权',403));else retry.resolve([template]);await pending;
    assert.equal(writes,1,ending);assert.equal(target.page.templates.value.length,ending==='success'?1:before.templates,ending);
    assert.equal(target.toasts.length,ending==='success'?before.toasts+1:before.toasts,ending);
    if(ending==='success')assert.equal(target.page.pageBusy.value,false);target.unmount();
  }
});

test('Current template retry access failure clears saved rows and permits no further retry',async()=>{
  for(const status of [401,403,404]){
    let reads=0;const target=camping({createPackingTemplate:async()=>template,listPackingTemplates:async()=>{if(++reads===1)throw Error('网络失败');throw new ApiError('权限变更',status);}});
    newTemplate(target);await target.page.saveTemplate();await target.page.retryTemplateRefresh();
    assert.equal(target.page.session.value,undefined,status);assert.equal(target.page.templates.value.length,0,status);assert.equal(target.page.templateRefreshFailed.value,false,status);
    await target.page.retryTemplateRefresh();assert.equal(reads,2,status);target.unmount();
  }
});

test('Starting a different template draft retires the previous save recovery and cannot discard that draft by retrying',async()=>{
  for(const next of ['new','edit']){
    let writes=0,reads=0;const target=camping({createPackingTemplate:async()=>{writes++;return template;},listPackingTemplates:async()=>{reads++;throw Error('刷新失败');}});
    target.page.trips.value=[trip];target.page.selectedTripId.value=trip.id;target.page.openTemplateLibrary(true);
    target.page.templateForm.value.name=template.name;target.page.templateForm.value.items[0].name='天幕';await target.page.saveTemplate();
    assert.equal(target.page.templateRefreshFailed.value,true);
    if(next==='new')target.page.newTemplate();else target.page.editTemplate(target.page.templates.value[0]);
    target.page.templateForm.value.name='还没保存的新草稿';
    assert.equal(target.page.templateRefreshFailed.value,false,next);
    const nodes=await rendered(target);assert.equal(nodes.some(node=>text(node.children)==='重新读取模板列表'),false,next);
    await target.page.retryTemplateRefresh();
    assert.equal(writes,1,next);assert.equal(reads,1,next);assert.equal(target.page.active.value,'templates',next);
    assert.equal(target.page.showingTemplateForm.value,true,next);assert.equal(target.page.templateForm.value.name,'还没保存的新草稿',next);
    assert.equal(target.page.templateTripTarget.value.id,trip.id,next);target.unmount();
  }
});

test('Reordered nonadjacent routes remain visible and their rendered delete action preserves exact versions',async()=>{
  const ab=leg('ab',a,b),bc=leg('bc',b,c),writes=[];const snapshot={tripVersion:8,stops:[a,c,b],legs:[ab,bc],accommodations:[]};
  const target=itinerary({getTripItinerary:async()=>snapshot,removeTripLeg:async(row,item)=>{writes.push([row.id,row.version,item.id,item.version]);return{removed:true,tripVersion:9};}});await new Promise(setImmediate);
  let nodes=await rendered(target);const orphanRows=nodes.filter(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg'));
  assert.equal(orphanRows.length,2);assert.match(text(orphanRows[0].children),/集合点.*营地/);assert.match(text(orphanRows[1].children),/营地.*民宿/);
  const remove=orphanRows[0].children.find(node=>node?.props?.class?.includes('danger')&&typeof node.props.onTap==='function');assert.ok(remove);await remove.props.onTap({});assert.equal(target.dialogs.length,1);assert.match(target.dialogs[0].content,/集合点.*营地/);await target.dialogs[0].success({confirm:true});
  assert.deepEqual(writes,[['trip-a',8,'ab',5]]);nodes=await rendered(target);assert.ok(nodes.some(node=>text(node.children)==='节点已变化，路线待重新规划'));assert.equal(target.page.itinerary.value.legs[0].staleAt,ab.staleAt);target.unmount();
});

test('Nonadjacent route mode changes use the selected row and are not confused with adjacent routes',async()=>{
  const ac=leg('ac',a,c),ab=leg('ab',a,b),writes=[];const snapshot={tripVersion:8,stops:[a,c,b],legs:[ac,ab],accommodations:[]};
  const target=itinerary({getTripItinerary:async()=>snapshot,updateTripLeg:async(row,item,input)=>{writes.push([row.id,row.version,item.id,item.version,input.mode]);return{tripVersion:9};}});await new Promise(setImmediate);
  const nodes=await rendered(target),rows=nodes.filter(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg'));assert.equal(rows.length,1);assert.match(text(rows[0].children),/集合点.*营地/);
  const picker=rows[0].children.find(node=>node?.type==='picker');assert.ok(picker);await picker.props.onChange({detail:{value:'2'}});assert.deepEqual(writes,[['trip-a',8,'ab',5,'FLIGHT']]);target.unmount();
});

test('Historical nonadjacent routes are readable but show no mode or removal actions',async()=>{
  const snapshot={tripVersion:8,stops:[a,c,b],legs:[leg('ab',a,b)],accommodations:[]};
  const target=itinerary({getTripItinerary:async()=>snapshot},{trip:{...trip,status:'COMPLETED'},canEdit:false});await new Promise(setImmediate);
  const nodes=await rendered(target),row=nodes.find(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg'));assert.ok(row);assert.match(text(row.children),/集合点.*营地/);assert.equal(row.children.some(node=>node?.type==='picker'||typeof node?.props?.onTap==='function'),false);assert.equal(target.dialogs.length,0);target.unmount();
});

test('A nonadjacent deletion confirmation expires when edit rights disappear',async()=>{
  let writes=0;const snapshot={tripVersion:8,stops:[a,c,b],legs:[leg('ab',a,b)],accommodations:[]};
  const target=itinerary({getTripItinerary:async()=>snapshot,removeTripLeg:async()=>{writes++;return{tripVersion:9};}});await new Promise(setImmediate);
  const nodes=await rendered(target),row=nodes.find(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg'));assert.ok(row);const remove=row.children.find(node=>typeof node?.props?.onTap==='function');await remove.props.onTap({});target.props.canEdit=false;await target.dialogs[0].success({confirm:true});assert.equal(writes,0);target.unmount();
});

test('Nonadjacent actions preserve stale routes on conflict and clear private rows for current authorization failures',async()=>{
  for(const status of [401,403,409]){
    const saved=leg('ab',a,b),snapshot={tripVersion:8,stops:[a,c,b],legs:[saved],accommodations:[]};let writes=0;
    const target=itinerary({getTripItinerary:async()=>snapshot,updateTripLeg:async(row,item,input)=>{writes++;assert.equal(row.id,trip.id);assert.equal(item.id,saved.id);assert.deepEqual({...input},{mode:'FLIGHT'});throw new ApiError('模拟拒绝',status);}});await new Promise(setImmediate);
    const nodes=await rendered(target),row=nodes.find(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg'));
    await row.children.find(node=>node?.type==='picker').props.onChange({detail:{value:'2'}});
    assert.equal(writes,1,status);assert.equal(target.page.busy.value,false,status);
    assert.equal(target.events.some(event=>event[0]==='changed'),false,status);
    if(status===409){assert.equal(target.page.itinerary.value.legs[0].staleAt,saved.staleAt);assert.equal(target.toasts.at(-1),'模拟拒绝');assert.equal(target.events.length,0);}
    else{assert.equal(target.page.itinerary.value.legs.length,0,status);assert.deepEqual(target.events,[['accessLost',trip.id]],status);}
    target.unmount();
  }
});

test('Nonadjacent mode changes are single-flight and old success or forbidden replies cannot affect a new trip',async()=>{
  for(const ending of ['success','forbidden']){
    const gate=deferred(),oldSnapshot={tripVersion:8,stops:[a,c,b],legs:[leg('ab',a,b)],accommodations:[]},newSnapshot={tripVersion:12,stops:[c,b,a],legs:[leg('ca',c,a)],accommodations:[]};let writes=0;
    const target=itinerary({getTripItinerary:async id=>id===trip.id?oldSnapshot:newSnapshot,updateTripLeg:()=>{writes++;return gate.promise;}});await new Promise(setImmediate);
    const nodes=await rendered(target),row=nodes.find(node=>String(node.props?.class||'').split(' ').includes('non-adjacent-leg')),picker=row.children.find(node=>node?.type==='picker');
    const pending=picker.props.onChange({detail:{value:'2'}});await picker.props.onChange({detail:{value:'3'}});
    const remove=row.children.find(node=>typeof node?.props?.onTap==='function');await remove.props.onTap({});assert.equal(writes,1,ending);assert.equal(target.dialogs.length,0,ending);
    target.props.trip={...trip,id:'trip-new',version:12};await new Promise(setImmediate);
    if(ending==='success')gate.resolve({tripVersion:9});else gate.reject(new ApiError('旧行程撤权',403));await pending;
    assert.equal(target.page.itinerary.value.tripVersion,12,ending);assert.equal(target.page.itinerary.value.legs[0].id,'ca',ending);assert.equal(target.events.length,0,ending);assert.equal(target.toasts.length,0,ending);target.unmount();
  }
});

test('Packing unknown amounts retain saved units without inventing zero or performing conversions',()=>{
  const target=camping();for(const [quantity,unit,expected] of [[null,'箱','箱'],[null,null,''],['2.000','箱','2 箱'],[1.5,'kg','1.5 kg'],[0,'个','0 个']])assert.equal(target.page.quantityText(quantity,unit),expected);target.unmount();
});
