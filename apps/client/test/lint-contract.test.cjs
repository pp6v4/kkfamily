const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {ESLint}=require('eslint');
const ROOT=path.resolve(__dirname,'..');
const eslint=new ESLint({cwd:ROOT,overrideConfigFile:path.join(ROOT,'eslint.config.mjs')});
const check=async(source,file)=>{const [result]=await eslint.lintText(source,{filePath:path.join(ROOT,file)});return result.messages;};

test('Lint understands Vue script setup, TypeScript, template-used refs and uni-app runtime globals',async()=>{
 const messages=await check('<script setup lang="ts">import { ref } from "vue";const title=ref<string>("家");function open(){uni.showToast({title:title.value});const timer=setInterval(()=>console.info(title.value),100);clearInterval(timer);}</script><template><view @tap="open">{{title}}</view></template>','src/pages/rule-check/index.vue');
 assert.deepEqual(messages,[]);
});
test('Lint rejects the previously observed undefined onLaunch runtime pattern',async()=>{
 const messages=await check('<script setup lang="ts">onLaunch(()=>{});</script><template><view/></template>','src/pages/rule-check/index.vue');
 assert.ok(messages.some(message=>message.ruleId==='no-undef'&&message.message.includes('onLaunch')));
});
test('Lint checks TypeScript source rather than merely parsing Vue templates',async()=>{
 const messages=await check('const unused: any = 3; export {};','src/services/rule-check.ts');
 assert.ok(messages.some(message=>message.ruleId==='@typescript-eslint/no-unused-vars'));
 assert.ok(messages.some(message=>message.ruleId==='@typescript-eslint/no-explicit-any'));
});
test('Lint rejects invalid template expressions and v-for/v-if conflicts',async()=>{
 const messages=await check('<script setup lang="ts">const items=[1];</script><template><view v-for="item in items" v-if="item>0" :key="item">{{item}}</view></template>','src/pages/rule-check/index.vue');
 assert.ok(messages.some(message=>message.ruleId==='vue/no-use-v-if-with-v-for'));
 const malformed=await check('<template><view>{{ a + }}</view></template>','src/pages/rule-check/index.vue');
 assert.ok(malformed.some(message=>message.fatal||message.ruleId==='vue/no-parsing-error'));
});
test('Lint keeps readonly props and computed purity checks active',async()=>{
 const messages=await check('<script setup lang="ts">import { computed } from "vue";const props=defineProps<{count:number}>();const doubled=computed(()=>{props.count++;return props.count*2;});</script><template><view>{{doubled}}</view></template>','src/pages/rule-check/index.vue');
 assert.ok(messages.some(message=>message.ruleId==='vue/no-mutating-props'));
 assert.ok(messages.some(message=>message.ruleId==='vue/no-side-effects-in-computed-properties'));
});
test('Lint rejects rethrowing errors without their original cause',async()=>{
 const messages=await check('export function run(){try{JSON.parse("bad");}catch(error){throw new Error(String(error));}}','src/services/rule-check.ts');
 assert.ok(messages.some(message=>message.ruleId==='preserve-caught-error'));
});
test('Lint includes every client TS/Vue source and registered route, while excluding build output',async()=>{
 function sources(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const full=path.join(dir,entry.name);return entry.isDirectory()?sources(full):/\.(ts|vue)$/.test(entry.name)?[full]:[];});}
 const expected=sources(path.join(ROOT,'src')).sort();
 const results=await eslint.lintFiles(['src/**/*.{ts,vue}']);
 assert.deepEqual(results.map(result=>result.filePath).sort(),expected);
 assert.equal(results.reduce((sum,result)=>sum+result.errorCount+result.warningCount,0),0);
 const pages=JSON.parse(fs.readFileSync(path.join(ROOT,'src/pages.json'),'utf8')).pages;
 for(const page of pages)assert.ok(expected.includes(path.join(ROOT,'src',page.path+'.vue')),page.path);
 assert.equal(await eslint.isPathIgnored(path.join(ROOT,'dist/build/mp-weixin/app.js')),true);
});
