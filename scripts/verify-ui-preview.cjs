// Source-derived browser previews, NOT WeChat/device screenshots. No API requests.
// Requires client dependencies, plus playwright and sharp from NODE_PATH.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),client=path.join(root,'apps/client'),req=createRequire(path.join(client,'package.json'));
const vue=req('vue'),ts=req('typescript'),{parse,compileScript,compileTemplate}=req('vue/compiler-sfc'),{renderToString}=req('vue/server-renderer');
const {chromium}=require('playwright'),sharp=require('sharp'),assert=require('node:assert/strict');
const out=path.resolve(process.argv[2]||path.join(root,'.codex-tmp/ui-review-20261029/rendered'));
const baseline=process.env.UI_BASELINE||'5e8d921';
const identity={householdId:'fixture-house',membershipId:'fixture-me',householdName:'扣扣的家',roles:['ADMIN'],version:1,effectivePermissions:Object.fromEntries(['recipes','meals','inventory','shopping','trips','packing_templates','calendar','members','tasks','favorites','archive','dashboard','notifications'].map(k=>[k,'MANAGE']))};
const rank={VIEW:1,EDIT:2,MANAGE:3};
const groups=[{id:'fried',name:'炒菜',version:1},{id:'soup',name:'汤羹',version:1}];
const recipes=['番茄炒蛋','清蒸鲈鱼','香菇青菜'].map((name,i)=>({id:'dish'+i,name,status:'PUBLISHED',version:1,category:groups[0],ingredients:[{ingredient:{name:['番茄','鲈鱼','香菇'][i]},quantity:1,unit:'份'},{ingredient:{name:['鸡蛋','葱','青菜'][i]},quantity:2,unit:'个'}],seasonings:[{name:'盐'}],steps:['食材洗净备好。','烹饪至熟后装盘。']}));
const trip={id:'trip',version:1,title:'周末去溪边露营',destination:'溪边营地',startsAt:'2026-11-01T00:00:00Z',endsAt:null,status:'PENDING',members:[{membershipId:identity.membershipId,tripRole:'OWNER',status:'ACTIVE',canEdit:true,photoAdd:true,membership:{user:{nickname:'扣扣'}}}],preparationGroups:[],stops:[],legs:[]};
function source(file,mode){return mode==='before'?execFileSync('git',['show',baseline+':apps/client/src/'+file],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(client,'src',file),'utf8');}
function evaluate(code,deps,uni){const m={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:id=>{if(id in deps)return deps[id];throw Error('Unknown preview import: '+id);},uni,console,Date,Error,Promise,Set,Map,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){} });return m.exports;}
function helper(file,uni){return evaluate(fs.readFileSync(path.join(client,'src/services',file+'.ts'),'utf8'),file==='calendar-dates'?{'./trip-form':helper('trip-form',uni)}:{},uni);}
async function prepare(file,mode,state){
 const filename=path.join(client,'src',file),{descriptor}=parse(source(file,mode),{filename}),life={};
 const storage=new Map(),uni=new Proxy({getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)},{get:(obj,key)=>obj[key]||(()=>{})});
 const api=new Proxy({mealTypeCodes:{早餐:'BREAKFAST',午餐:'LUNCH',晚餐:'DINNER',加餐:'OTHER'},mealTypeLabel:()=> '晚餐',publicMediaUrl:v=>v},{get:(o,k)=>o[k]|| (async()=>[])});
 const emptyComponent={render:()=>vue.h('view',{'class':'preview-native-placeholder'},'路线与相册组件：另有行为回归，本图未渲染')};
 const deps={vue:{...vue,onUnmounted(){}},'@dcloudio/uni-app':Object.fromEntries(['onShow','onHide','onUnload','onLoad'].map(k=>[k,fn=>life[k]=fn])),
 '../../services/session':{canAccess:(s,m,l='VIEW')=>(rank[s?.effectivePermissions?.[m]]||0)>=rank[l],getStoredSession:()=>identity,refreshAccess:async()=>identity,getSessionEpoch:()=>0},
 '../../services/family-api':api,'../../services/members-api':api,'../../services/transport':{ApiError:class extends Error{}},
 '../../services/trip-form':helper('trip-form',uni),'../../services/calendar-dates':helper('calendar-dates',uni),
 '../../services/calendar-navigation':{takeCalendarTarget:()=>undefined},'../../services/trip-native':{},
 '../../services/recipe-draft':helper('recipe-draft',uni),
 '../../components/trip-itinerary.vue':{default:emptyComponent},'../../components/trip-photos.vue':{default:emptyComponent}};
 const script=compileScript(descriptor,{id:'preview',inlineTemplate:false}),scope=vue.effectScope();
 const page=scope.run(()=>evaluate(script.content,deps,uni).default.setup({}, {expose(){}}));
 const set=(key,value)=>{if(vue.isRef(page[key]))page[key].value=value;};
 set('session',identity);set('pageVisible',true);
 if(file.includes('/meal/')){
  set('date','2026-10-30');set('recipes',structuredClone(recipes));set('recipeCategories',groups);set('mealLoaded',true);
  set('meal',{id:'meal',version:1,status:'DRAFT',items:[{recipeId:'dish0',addedById:identity.membershipId},{recipeId:'dish1',addedById:'fixture-partner'}],menu:recipes.slice(0,2).map(r=>({recipeId:r.id,recipe:r,cookMultiplier:1,wantedBy:[{membershipId:r.id==='dish0'?identity.membershipId:'fixture-partner',nickname:r.id==='dish0'?'我':'家人'}]}))});
  if(state==='library')set('active','recipes');
  if(state==='long'){page.recipes.value[0].name='周末特别版番茄鸡蛋鲜虾菌菇时蔬营养家常炒菜';}
  if(state==='detail')page.openRecipeDetail('dish0','CURRENT');
  if(state==='empty'){set('recipes',[]);set('meal',undefined);}
  if(state==='loading')set('loading',true);
  if(state==='error')set('errorText','网络连接失败，请重试');
  if(state==='disabled')set('writing',true);
 }
 if(file.includes('/shopping/')){
  set('items',[{id:'s1',version:1,name:'洗衣液',quantity:2,unit:'瓶',status:'NEXT_TRIP'},{id:'s2',version:1,name:'鸡蛋',quantity:null,unit:'盒',status:'REPLENISH'}]);
  set('inventory',[{id:'i1',version:1,ingredient:{name:'面粉',kind:'FOOD'},quantity:null,unit:'kg',location:'橱柜',availability:'UNKNOWN'}]);
  if(state==='inventory'||state==='stock-form')set('active','inventory');
  if(state==='stock-form')set('showStockForm',true);
  if(state==='form')set('showShoppingForm',true);
 }
 if(file.includes('/recipe-editor/')){set('name','番茄炒蛋');set('ingredients',[{name:'番茄',quantity:'2',unit:'个'},{name:'鸡蛋',quantity:'3',unit:'个'}]);set('steps',['番茄切块，鸡蛋打散。']);}
 if(file.includes('/index/')){set('today','2026-10-30');set('current','2026-10-01');set('selected','2026-10-30');}
 if(file.includes('/camping/')){set('trips',[trip]);set('selectedTripId',trip.id);set('packingItems',[{id:'p1',name:'天幕',quantity:1,unit:'顶',status:'PENDING',version:1},{id:'p2',name:'折叠桌',quantity:1,unit:'张',status:'PACKED',version:1}]);}
 if(file.includes('/members/')){const person={id:'m1',version:1,status:'ACTIVE',user:{nickname:'家人小扣'},roles:['MEMBER'],overrides:[]};set('members',[person]);set('selected',person);set('roles',['MEMBER']);}
 if(file.includes('/archive/')){set('showFieldForm',true);set('members',[{id:'m1',user:{nickname:'家人小扣'}}]);}
 const compiled=compileTemplate({source:descriptor.template.content,filename,id:'preview',compilerOptions:{bindingMetadata:script.bindings,isCustomElement:tag=>!['TripItinerary','TripPhotos'].includes(tag)}});
 assert.deepEqual(compiled.errors,[]);
 const render=evaluate(compiled.code,{vue},uni).render;
 const html=await renderToString(vue.createSSRApp({setup:()=>()=>render({},[],{},vue.proxyRefs(page))}));
 let css=descriptor.styles.map(s=>s.src?fs.readFileSync(path.resolve(path.dirname(filename),s.src),'utf8'):s.content).join('\n');
 css=css.replace(/(-?[\d.]+)rpx/g,(_,n)=>'calc('+n+' * 100vw / 750)');
 scope.stop();
 return{html:html.replace(/<image\b/g,'<img').replace(/<\/image>/g,'').replace(/src="\/static\//g,'src="http://preview.local/static/'),css};
}
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({headless:true,channel:process.env.UI_BROWSER||'msedge'}),results=[];
 const cases=[['meal','default'],['meal','long'],['meal','library'],['meal','detail'],['meal','empty'],['meal','loading'],['meal','error'],['meal','disabled'],['shopping','list'],['shopping','form'],['shopping','inventory'],['shopping','stock-form'],['recipe-editor','form'],['index','calendar'],['profile','home'],['camping','detail'],['members','editor'],['archive','grants']];
 for(const [name,state]of cases)for(const mode of ['before','after']){
  const {html,css}=await prepare('pages/'+name+'/index.vue',mode,state);
  for(const width of [320,390,430]){
   const page=await browser.newPage({viewport:{width,height:844},deviceScaleFactor:1});
   await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.host==='preview.local'&&url.pathname.startsWith('/static/'))return route.fulfill({path:path.join(client,'src',url.pathname)});return route.abort();});
   const doc='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f7f6ef;font-family:"Microsoft YaHei",sans-serif;font-size:14px;color:#34453b;--home-bg:#f7f6ef;--home-ink:#34453b}view,scroll-view,picker{display:block}text{display:inline}button,input,textarea{font-family:inherit}button{border:0}img{object-fit:cover}input{height:44px;min-height:44px}textarea{resize:none} .preview-native-placeholder{padding:20px;border:1px dashed #aaa;color:#667267;font-size:12px}'+css+'</style><body>'+html+'</body></html>';
   await page.setContent(doc);await page.evaluate(()=>document.fonts.ready);
   const filename=name+'-'+state+'-'+mode+'-'+width+'.png';
   await page.screenshot({path:path.join(out,filename),fullPage:false});
   if(width===390)fs.writeFileSync(path.join(out,name+'-'+state+'-'+mode+'.html'),doc);
   const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('.order-card button.add')].map(b=>({label:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height,font:getComputedStyle(b).fontSize})),overflows:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)&&getComputedStyle(e).position!=='absolute';}).slice(0,8).map(e=>e.tagName+'.'+e.className)}));
   results.push({name,state,mode,filename,...metrics});await page.close();
  }
 }
 await browser.close();fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(results,null,2));
 const tiles=[];for(const [i,mode]of ['before','after'].entries()){const img=await sharp(path.join(out,'meal-default-'+mode+'-390.png')).png().toBuffer();tiles.push({input:img,left:i*410,top:50});}
 const header=Buffer.from('<svg width="800" height="50"><rect width="800" height="50" fill="#eef0e8"/><text x="18" y="32" font-size="18" font-family="Microsoft YaHei">调整前 · 同一份示例数据</text><text x="428" y="32" font-size="18" font-family="Microsoft YaHei">调整后 · 源码浏览器预览</text></svg>');
 await sharp({create:{width:800,height:894,channels:4,background:'#eef0e8'}}).composite([...tiles,{input:header,left:0,top:0}]).png().toFile(path.join(out,'meal-comparison.png'));
 const bad=results.filter(r=>r.mode==='after'&&r.scrollWidth>r.width);
 console.log(JSON.stringify({screenshots:results.length,overflow:bad,buttons:results.find(r=>r.name==='meal'&&r.state==='default'&&r.mode==='after'&&r.width===390)?.buttons},null,2));
 if(bad.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
