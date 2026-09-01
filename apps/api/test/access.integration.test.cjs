const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ValidationPipe } = require('@nestjs/common');
const { FastifyAdapter } = require('@nestjs/platform-fastify');
const { JwtService } = require('@nestjs/jwt');
const { PrismaService } = require('../dist/prisma/prisma.service');
process.env.JWT_ACCESS_SECRET = 'isolated-verification-signing-key-not-for-production';
process.env.NODE_ENV = 'test';
process.env.MEDIA_DRIVER = 'memory';
const { AppModule } = require('../dist/app.module');
const { configureImageBodyParser } = require('../dist/media/binary-parser');
let app, db, jwt;
const TEST_PNG = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52]);

before(async () => {
  assert.match(process.env.DATABASE_URL || '', /kk-verify-db-[a-f0-9]+:5432\/verify(?:\?|$)/, 'Run only against an isolated verification database');
  process.env.JWT_ACCESS_SECRET = 'isolated-verification-signing-key-not-for-production';
  app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'], abortOnError: false });
  configureImageBodyParser(app);
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  db = app.get(PrismaService); jwt = app.get(JwtService);
});
after(async () => { if (app) await app.close(); });

async function identity() {
  const user = await db.user.create({ data: { openId: 'verification-' + randomUUID(), nickname: '虚构测试成员' } });
  return { userId: user.id, token: await jwt.signAsync({ sub: user.id }) };
}
async function call(who, method, path, payload, household = who?.householdId) {
  const headers = {};
  if (who?.token) headers.authorization = `Bearer ${who.token}`;
  if (household !== undefined) headers['x-household-id'] = household;
  const response = await app.inject({ method, url: '/v1' + path, headers, ...(payload === undefined ? {} : { payload }) });
  return { status: response.statusCode, body: response.json() };
}
async function callRaw(who,path,payload,contentType='image/png',household=who?.householdId){
  const headers={authorization:`Bearer ${who.token}`,'x-household-id':household,'content-type':contentType};
  const response=await app.inject({method:'PUT',url:'/v1'+path,headers,payload});
  return{status:response.statusCode,body:response.json()};
}
async function owner() {
  const who = await identity();
  const response = await call(who, 'POST', '/households', { name: '虚构验证家庭' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...who, householdId: response.body.data.id, memberId: response.body.data.membershipId };
}
async function invite(who, roles = ['MEMBER'], grants = []) {
  const response = await call(who, 'POST', `/households/${who.householdId}/invitations`, { roleCodes: roles, grants, maxUses: 1 });
  assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.data;
}
async function join(who, roles = ['MEMBER'], grants = []) {
  const invitation = await invite(who, roles, grants), guest = await identity();
  const response = await call(guest, 'POST', '/invitations/redeem', { code: invitation.code });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...guest, householdId: who.householdId, memberId: response.body.data.id, member: response.body.data };
}
async function permissions(who, memberId, version, roles, overrides = []) {
  return call(who, 'PATCH', `/members/${memberId}/permissions`, { version, roleCodes: roles, overrides });
}
async function attachReadyCover(who,recipe,bytes=TEST_PNG){
  const intent=await call(who,'POST','/media/upload-intents',{ownerType:'RECIPE',ownerId:recipe.id,expectedOwnerVersion:recipe.version,mimeType:'image/png',byteSize:bytes.length});
  assert.equal(intent.status,201,JSON.stringify(intent.body));
  const uploaded=await callRaw(who,intent.body.data.uploadPath,bytes);assert.equal(uploaded.status,200,JSON.stringify(uploaded.body));
  const confirmed=await call(who,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:uploaded.body.data.checksumSha256});
  assert.equal(confirmed.status,201,JSON.stringify(confirmed.body));
  return{...recipe,version:confirmed.body.data.ownerVersion,coverAssetId:confirmed.body.data.asset.id};
}

test('A01: unauthenticated household data returns 401', async () => {
  assert.equal((await call(null, 'GET', '/recipes')).status, 401);
});
test('A02: every implemented household listing rejects missing/blank headers', async () => {
  const who = await owner();
  for (const path of ['/recipes', '/inventory', '/shopping-lists', '/trips', '/packing-templates', '/members', '/households/current/access', '/meals?from=2026-08-01&to=2026-09-01', '/calendar/events?from=2026-08-01&to=2026-09-01']) {
    for (const header of [undefined, '', ' ']) assert.equal((await call({ token: who.token }, 'GET', path, undefined, header)).status, 400, path);
  }
});
test('A03: valid token cannot select another household', async () => {
  const one = await owner(), two = await owner();
  for (const path of ['/recipes', '/members', '/trips', '/inventory', '/shopping-lists']) assert.equal((await call(one, 'GET', path, undefined, two.householdId)).status, 403, path);
});
test('A04: explicit DENY defeats chef role and explicit VIEW replaces EDIT', async () => {
  const who = await owner(), chef = await join(who, ['CHEF']);
  let result = await permissions(who, chef.memberId, 1, ['CHEF'], [{ module: 'recipes', level: 'VIEW', effect: 'DENY' }]);
  assert.equal(result.status, 200); assert.equal((await call(chef, 'GET', '/recipes')).status, 403);
  result = await permissions(who, chef.memberId, 2, ['CHEF'], [{ module: 'recipes', level: 'VIEW', effect: 'ALLOW' }]);
  assert.equal(result.status, 200); assert.equal((await call(chef, 'GET', '/recipes')).status, 200);
  const denied = await call(chef, 'POST', '/recipes', { name: '测试菜', ingredients: [{ name: '番茄', unit: 'g', quantity: 10 }], seasonings: [], steps: ['炒熟'] });
  assert.equal(denied.status, 403);
});
test('A05: concurrent redemption of one remaining use admits exactly one user', async () => {
  const who = await owner(), invitation = await invite(who), first = await identity(), second = await identity();
  const results = await Promise.all([first, second].map(user => call(user, 'POST', '/invitations/redeem', { code: invitation.code })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 410]);
  assert.equal((await db.householdInvitation.findUnique({ where: { id: invitation.id } })).usedCount, 1);
  assert.equal(await db.invitationRedemption.count({ where: { invitationId: invitation.id } }), 1);
  assert.equal(await db.membership.count({ where: { householdId: who.householdId } }), 2);
});
test('A06: same user concurrent retries reuse membership and do not consume twice', async () => {
  const who = await owner(), invitation = await invite(who), guest = await identity();
  const results = await Promise.all([1,2].map(() => call(guest, 'POST', '/invitations/redeem', { code: invitation.code })));
  assert.ok(results.every(r => r.status === 201), JSON.stringify(results));
  assert.equal(results[0].body.data.id, results[1].body.data.id);
  const stored = await db.householdInvitation.findUnique({ where: { id: invitation.id } });
  assert.equal(stored.usedCount, 1); assert.equal(stored.codeHash, createHash('sha256').update(invitation.code).digest('hex'));
  const list = await call(who, 'GET', `/households/${who.householdId}/invitations`);
  assert.ok(!JSON.stringify(list.body).includes(invitation.code)); assert.ok(!JSON.stringify(list.body).includes(stored.codeHash));
});
test('A07: last administrator cannot be disabled, stripped, or denied member management', async () => {
  const who = await owner();
  assert.equal((await call(who, 'PATCH', `/members/${who.memberId}/status`, { version:1,status:'DISABLED' })).status, 409);
  assert.equal((await permissions(who, who.memberId, 1, [])).status, 409);
  assert.equal((await permissions(who, who.memberId, 1, ['ADMIN'], [{module:'members',level:'VIEW',effect:'DENY'}])).status, 409);
  const stored = await db.membership.findUnique({where:{id:who.memberId}}); assert.equal(stored.status,'ACTIVE'); assert.equal(stored.version,1);
});
test('A08: dining guest can read recipe materials and select meals but cannot read stock or edit recipes', async () => {
  const who = await owner(), guest = await join(who, ['GUEST'], [{module:'recipes',level:'VIEW',effect:'ALLOW'}, {module:'meals',level:'EDIT',effect:'ALLOW'}]);
  assert.equal((await call(guest,'GET','/recipes')).status,200);
  assert.equal((await call(guest,'GET','/inventory')).status,403);
  assert.equal((await call(guest,'GET','/members')).status,403);
  const meal = await call(guest,'POST','/meals',{scheduledAt:'2026-08-31T18:00:00+08:00',mealType:'晚餐'});
  assert.equal(meal.status,201);
  assert.equal((await call(guest,'POST',`/meals/${meal.body.data.id}/recalculate`)).status,403);
});
test('Expired, revoked and disabled-member invites fail without changing membership', async () => {
  const who = await owner(), invitation = await invite(who), guest = await identity();
  await db.householdInvitation.update({where:{id:invitation.id},data:{expiresAt:new Date('2000-01-01')}});
  assert.equal((await call(guest,'POST','/invitations/redeem',{code:invitation.code})).status,410);
  const second = await invite(who);
  assert.equal((await call(who,'DELETE',`/invitations/${second.id}`,{version:1})).status,200);
  assert.equal((await call(guest,'POST','/invitations/redeem',{code:second.code})).status,410);
  const member = await join(who); await call(who,'PATCH',`/members/${member.memberId}/status`,{version:1,status:'DISABLED'});
  const third=await invite(who); assert.equal((await call(member,'POST','/invitations/redeem',{code:third.code})).status,403);
  assert.equal((await call(member,'GET','/recipes')).status,403);
});
test('Optimistic permissions: stale version returns 409 and preserves the newer setting', async () => {
  const who=await owner(), member=await join(who);
  assert.equal((await permissions(who,member.memberId,1,['GUEST'])).status,200);
  assert.equal((await permissions(who,member.memberId,1,['ADMIN'])).status,409);
  const context=await call(member,'GET','/households/current/access');
  assert.deepEqual(context.body.data.roles,['GUEST']); assert.equal(context.body.data.version,2);
});
test('Delegated manager cannot grant permissions above their own', async () => {
  const who=await owner(), manager=await join(who,['GUEST'],[{module:'members',level:'MANAGE',effect:'ALLOW'}]);
  assert.equal((await call(manager,'POST',`/households/${who.householdId}/invitations`,{roleCodes:['MEMBER'],grants:[]})).status,403);
  assert.equal((await permissions(manager,who.memberId,1,['ADMIN'])).status,403);
});
test('Admin transfer is atomic, versioned and cannot cross households', async () => {
  const who=await owner(), member=await join(who), other=await owner();
  assert.equal((await call(who,'POST',`/households/${who.householdId}/transfer-admin`,{version:1,targetVersion:1,targetMembershipId:other.memberId})).status,404);
  const result=await call(who,'POST',`/households/${who.householdId}/transfer-admin`,{version:1,targetVersion:1,targetMembershipId:member.memberId});
  assert.equal(result.status,201,JSON.stringify(result.body)); assert.ok(result.body.data.roles.includes('ADMIN'));
  assert.equal((await call(member,'GET','/members/roles')).status,200);
  assert.equal((await call(who,'GET','/members/roles')).status,403);
  assert.equal(await db.auditLog.count({where:{householdId:who.householdId,action:'ADMIN_TRANSFER'}}),1);
});
test('Concurrent disabling of two admins leaves exactly one active administrator', async () => {
  const who=await owner(), member=await join(who); await permissions(who,member.memberId,1,['ADMIN']);
  const results=await Promise.all([call(who,'PATCH',`/members/${who.memberId}/status`,{version:1,status:'DISABLED'}),call(member,'PATCH',`/members/${member.memberId}/status`,{version:2,status:'DISABLED'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(await db.membership.count({where:{householdId:who.householdId,status:'ACTIVE',roles:{some:{role:{code:'ADMIN'}}}}}),1);
});
test('A21/A30: calendar hides nonmember trips and includes authorized cross-month spans', async () => {
  const who=await owner(), member=await join(who);
  const trip=await call(who,'POST','/trips',{title:'虚构跨月行程',startsAt:'2026-08-30T09:00:00+08:00',endsAt:'2026-09-02T00:00:00+08:00'});
  assert.equal(trip.status,201,JSON.stringify(trip.body));
  const path='/calendar/events?from=2026-09-01T00%3A00%3A00%2B08%3A00&to=2026-10-01T00%3A00%3A00%2B08%3A00';
  assert.equal((await call(member,'GET',path)).body.data.length,0);
  let visible=await call(who,'GET',path); assert.equal(visible.body.data.length,1); assert.equal(visible.body.data[0].sourceId,trip.body.data.id);
  await db.tripMember.create({data:{tripId:trip.body.data.id,membershipId:member.memberId}});
  assert.equal((await call(member,'GET',path)).body.data.length,1);
  // Even ADMIN has no implicit access after explicit trip membership removal.
  await db.tripMember.delete({where:{tripId_membershipId:{tripId:trip.body.data.id,membershipId:who.memberId}}});
  assert.equal((await call(who,'GET',path)).body.data.length,0);
  assert.equal((await call(who,'POST','/calendar/events',{title:'假行程',type:'TRIP',startsAt:'2026-09-01T08:00:00+08:00'})).status,400);
});
test('Calendar rechecks source module permissions, not just calendar membership', async () => {
  const who=await owner(), member=await join(who);
  await call(who,'POST','/meals',{scheduledAt:'2026-08-31T18:00:00+08:00',mealType:'晚餐'});
  await permissions(who,member.memberId,1,['MEMBER'],[{module:'meals',level:'VIEW',effect:'DENY'}]);
  const result=await call(member,'GET','/calendar/events?from=2026-08-01&to=2026-09-01');
  assert.equal(result.status,200); assert.equal(result.body.data.filter(e=>e.type==='MEAL').length,0);
});
test('A11/A12/A13/A15: two votes count one dish; distinct dishes aggregate 500g/3 eggs with 150g shortage', async () => {
  const who=await owner(), member=await join(who);
  async function recipe(name,tomato,eggs) {
    const created=await call(who,'POST','/recipes',{name,ingredients:[{name:'番茄',quantity:tomato,unit:'g'},{name:'鸡蛋',quantity:eggs,unit:'个'}],seasonings:['生抽'],steps:['做熟']});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const covered=await attachReadyCover(who,created.body.data);
    await call(who,'PATCH',`/recipes/${covered.id}/status`,{status:'PUBLISHED',expectedVersion:covered.version}); return covered.id;
  }
  const dish=await recipe('番茄炒蛋',300,2),soup=await recipe('番茄蛋汤',200,1);
  const meal=(await call(who,'POST','/meals',{scheduledAt:'2026-08-31T18:00:00+08:00',mealType:'晚餐'})).body.data;
  for (const [person,id] of [[who,dish],[member,dish],[member,soup]]) assert.equal((await call(person,'POST',`/meals/${meal.id}/items`,{recipeId:id})).status,201);
  const unknown=await call(who,'POST',`/meals/${meal.id}/recalculate`);
  assert.ok(unknown.body.data.every(i=>i.status==='UNKNOWN' && i.shortage===null));
  await call(who,'POST','/inventory',{name:'番茄',quantity:350,unit:'g'});
  await call(who,'POST','/inventory',{name:'鸡蛋',quantity:4,unit:'个'});
  const comparison=(await call(who,'POST',`/meals/${meal.id}/recalculate`)).body.data;
  assert.equal(comparison.length,3,'All food AND seasonings are shown');
  const tomato=comparison.find(i=>i.name==='番茄'),egg=comparison.find(i=>i.name==='鸡蛋');
  assert.deepEqual([tomato.required,tomato.onHand,tomato.shortage,tomato.status],['500.000','350.000','150.000','SHORTAGE']);
  assert.deepEqual([egg.required,egg.onHand,egg.shortage,egg.status],['3.000','4.000','0.000','SUFFICIENT']);
  assert.equal(await db.mealItem.count({where:{mealId:meal.id}}),3,'Votes remain stored separately');
});
test('A10: trim precedes validation; empty names and negative recipe quantities are rejected', async () => {
  const who=await owner();
  for (const [path,body] of [
    ['/recipes',{name:'   ',ingredients:[{name:'番茄',quantity:1,unit:'g'}],seasonings:['生抽'],steps:['做熟']}],
    ['/recipes',{name:'测试菜',ingredients:[{name:'番茄',quantity:-1,unit:'g'}],seasonings:['生抽'],steps:['做熟']}],
    ['/recipes',{name:'测试菜',ingredients:[{name:'番茄',quantity:1,unit:'g'}],seasonings:['生抽'],steps:['   ']}],
    ['/trips',{title:'   ',startsAt:'2026-09-01'}],
    ['/inventory',{name:'   ',quantity:1,unit:'g'}],
    ['/packing-templates',{name:'   ',items:[{name:'1'}]}],
  ]) assert.equal((await call(who,'POST',path,body)).status,400,path);
  assert.equal(await db.recipe.count({where:{householdId:who.householdId}}),0);
});

test('D04: recipe detail respects draft visibility and stale edits never overwrite newer content', async () => {
  const who=await owner(),viewer=await join(who,['GUEST'],[{module:'recipes',level:'VIEW',effect:'ALLOW'}]);
  const created=await call(who,'POST','/recipes',{name:'初版菜名',ingredients:[{name:'土豆',quantity:2,unit:'个'}],seasonings:['盐'],steps:['蒸熟']});
  assert.equal(created.status,201,JSON.stringify(created.body));const recipe=created.body.data;
  assert.equal(recipe.version,1);assert.equal((await call(viewer,'GET',`/recipes/${recipe.id}`)).status,404);
  const edit={expectedVersion:1,name:'新版菜名',ingredients:[{name:'土豆',quantity:3,unit:'个'}],seasonings:['盐','胡椒'],steps:['蒸熟','压泥']};
  const updated=await call(who,'PATCH',`/recipes/${recipe.id}`,edit);
  assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.data.version,2);assert.equal(updated.body.data.name,'新版菜名');
  const stale=await call(who,'PATCH',`/recipes/${recipe.id}`,{...edit,name:'过期覆盖'});
  assert.equal(stale.status,409);const detail=await call(who,'GET',`/recipes/${recipe.id}`);
  assert.equal(detail.body.data.name,'新版菜名');assert.equal(detail.body.data.ingredients[0].quantity,'3');
  assert.equal((await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'PUBLISHED',expectedVersion:1})).status,409);
  assert.equal((await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'PUBLISHED',expectedVersion:2})).status,409,'A09: cover is required for publishing');
  const covered=await attachReadyCover(who,updated.body.data);
  const published=await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'PUBLISHED',expectedVersion:covered.version});
  assert.equal(published.status,200);assert.equal(published.body.data.version,4);assert.equal((await call(viewer,'GET',`/recipes/${recipe.id}`)).status,200);
});

test('A33/A35: private recipe image validates bytes and ownership; revoked user gets no new URL while old URL expires shortly',async()=>{
  const ownerAccount=await owner(),chef=await join(ownerAccount,['CHEF']);
  const created=await call(chef,'POST','/recipes',{name:'带图菜谱',ingredients:[{name:'豆腐',quantity:1,unit:'块'}],seasonings:['盐'],steps:['煎']});
  const recipe=created.body.data;
  const intent=await call(chef,'POST','/media/upload-intents',{ownerType:'RECIPE',ownerId:recipe.id,expectedOwnerVersion:recipe.version,mimeType:'image/png',byteSize:TEST_PNG.length});
  assert.equal(intent.status,201,JSON.stringify(intent.body));assert.equal(intent.body.data.objectKey,undefined,'Object key never leaves the server');
  assert.equal((await callRaw(chef,intent.body.data.uploadPath,Buffer.alloc(TEST_PNG.length))).status,400,'Magic bytes are checked');
  const uploaded=await callRaw(chef,intent.body.data.uploadPath,TEST_PNG);assert.equal(uploaded.status,200);
  assert.equal((await call(ownerAccount,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:'0'.repeat(64)})).status,409);
  const confirmed=await call(chef,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:uploaded.body.data.checksumSha256});assert.equal(confirmed.status,201);
  const retry=await call(chef,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:uploaded.body.data.checksumSha256});assert.equal(retry.body.data.asset.id,confirmed.body.data.asset.id);
  const url=await call(chef,'GET',`/media/assets/${confirmed.body.data.asset.id}/url`);assert.equal(url.status,200);
  const binary=await app.inject({method:'GET',url:'/v1'+url.body.data.path});assert.equal(binary.statusCode,200);assert.deepEqual(binary.rawPayload,TEST_PNG);assert.equal(binary.headers['content-type'],'image/png');
  assert.equal((await callRaw(chef,intent.body.data.uploadPath,TEST_PNG,'image/jpeg')).status,400,'Content type cannot be changed');
  await call(ownerAccount,'PATCH',`/members/${chef.memberId}/status`,{version:1,status:'DISABLED'});
  assert.equal((await call(chef,'GET',`/media/assets/${confirmed.body.data.asset.id}/url`)).status,403);
  const stillShortLived=await app.inject({method:'GET',url:'/v1'+url.body.data.path});assert.equal(stillShortLived.statusCode,200);
  const token=url.body.data.path.split('/').pop();assert.equal((await call(ownerAccount,'GET','/recipes',undefined,ownerAccount.householdId)).status,200);assert.equal((await call(ownerAccount,'GET','/recipes',undefined,'not-the-household')).status,403);assert.ok(token.length>20);
});
test('A24/A25/A29: arbitrary template items stay exact, repeat apply skips, assignee remains read-only', async () => {
  const who=await owner(), member=await join(who,['CAMPER']);
  const trip=(await call(who,'POST','/trips',{title:'虚构验证出行',startsAt:'2026-09-01T09:00:00+08:00'})).body.data;
  await db.tripMember.create({data:{tripId:trip.id,membershipId:member.memberId,canEdit:false}});
  const template=await call(who,'POST','/packing-templates',{name:'烧烤',items:[{name:'1'},{name:'2'},{name:'3'}]});
  assert.equal(template.status,201); assert.deepEqual(template.body.data.items.map(i=>i.name),['1','2','3']);
  const path=`/trips/${trip.id}/packing-items`;
  const first=await call(who,'POST',path+'/apply-template',{templateId:template.body.data.id});
  const second=await call(who,'POST',path+'/apply-template',{templateId:template.body.data.id});
  assert.equal(first.body.data.addedCount,3); assert.equal(second.body.data.addedCount,0); assert.equal(second.body.data.skippedCount,3);
  const item=first.body.data.items[0]; await call(who,'PATCH',`${path}/${item.id}`,{responsibleMembershipId:member.memberId});
  assert.equal((await call(member,'GET',path)).status,200);
  assert.equal((await call(member,'PATCH',`${path}/${item.id}`,{status:'PACKED'})).status,403);
  assert.equal((await call(member,'GET','/packing-templates')).status,403);
});

async function mealFixture({quantity=300,unit='g',seasonings=['生抽','醋','盐']}={}) {
  const who=await owner();
  const created=await call(who,'POST','/recipes',{name:'番茄炒蛋',ingredients:[{name:'番茄',quantity,unit}],seasonings,steps:['测试步骤']});
  assert.equal(created.status,201,JSON.stringify(created.body));const recipe=created.body.data;
  const covered=await attachReadyCover(who,recipe);
  assert.equal((await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'PUBLISHED',expectedVersion:covered.version})).status,200);
  const meal=(await call(who,'POST','/meals',{scheduledAt:'2026-09-01T18:00:00+08:00',mealType:'晚餐'})).body.data;
  assert.equal((await call(who,'POST',`/meals/${meal.id}/items`,{recipeId:recipe.id})).status,201);
  return {who,recipe:covered,meal:await currentMeal(who,meal.id)};
}
async function currentMeal(who,id){const r=await call(who,'GET','/meals?from=2026-09-01&to=2026-09-02');assert.equal(r.status,200);return r.body.data.find(m=>m.id===id);}
async function confirmFixture(f){const r=await call(f.who,'POST',`/meals/${f.meal.id}/confirm`,{expectedVersion:f.meal.version});assert.equal(r.status,201,JSON.stringify(r.body));f.meal=r.body.data;return f;}

test('Same local day and normalized meal type share one meal under concurrent creation',async()=>{
  const who=await owner(),member=await join(who);
  const results=await Promise.all([call(who,'POST','/meals',{scheduledAt:'2026-09-01T18:00:00+08:00',mealType:'晚餐'}),call(member,'POST','/meals',{scheduledAt:'2026-09-01T19:00:00+08:00',mealType:'DINNER'})]);
  assert.deepEqual(results.map(r=>r.status),[201,201]);assert.equal(results[0].body.data.id,results[1].body.data.id);
  assert.equal(results[0].body.data.localDate,'2026-09-01');assert.equal(await db.meal.count({where:{householdId:who.householdId}}),1);
  assert.equal((await call(who,'POST','/meals',{scheduledAt:'2026-09-01T18:00:00+08:00',mealType:'DINNER',localDate:'2026-09-02'})).status,400);
});

test('A17/R01: confirmed snapshot freezes names/quantities, reopening retains versions and manager audit',async()=>{
  const f=await confirmFixture(await mealFixture()),member=await join(f.who);
  const before=await db.mealSnapshot.findFirst({where:{mealId:f.meal.id}});
  const current=(await call(f.who,'GET',`/recipes/${f.recipe.id}`)).body.data;
  const edit=await call(f.who,'PATCH',`/recipes/${f.recipe.id}`,{expectedVersion:current.version,name:'后来改的菜名',ingredients:[{name:'番茄',quantity:999,unit:'g'}],seasonings:current.seasonings.map(s=>s.name),steps:['修改后的步骤']});
  assert.equal(edit.status,200,JSON.stringify(edit.body));
  const frozen=await currentMeal(f.who,f.meal.id);assert.equal(frozen.menu[0].recipe.name,'番茄炒蛋');assert.equal(frozen.menu[0].recipe.ingredients[0].quantity,'300.000');
  const c=(await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data.find(i=>i.kind==='FOOD');assert.equal(c.required,'300.000');
  assert.equal((await call(member,'POST',`/meals/${f.meal.id}/reopen`,{expectedVersion:f.meal.version,reason:'想改菜'})).status,403);
  assert.equal((await call(member,'POST',`/meals/${f.meal.id}/items`,{recipeId:f.recipe.id})).status,409);
  assert.equal((await call(f.who,'POST',`/meals/${f.meal.id}/reopen`,{expectedVersion:f.meal.version,reason:'厨师调整'})).status,201);
  f.meal=await currentMeal(f.who,f.meal.id);assert.equal(f.meal.menu[0].recipe.name,'后来改的菜名');await confirmFixture(f);
  const versions=await call(f.who,'GET',`/meals/${f.meal.id}/snapshots`);assert.deepEqual(versions.body.data.map(s=>s.version),[2,1]);
  assert.deepEqual((await db.mealSnapshot.findUnique({where:{id:before.id}})).data,before.data);
  assert.equal(await db.auditLog.count({where:{householdId:f.who.householdId,action:'MEAL_REOPEN'}}),1);
});

test('Servings are explicit and decimal aggregation rounds only after summation',async()=>{
  const f=await mealFixture({quantity:0.001,seasonings:[]});
  let r2=(await call(f.who,'POST','/recipes',{name:'第二道',ingredients:[{name:'番茄',quantity:0.001,unit:'g'}],seasonings:[],steps:['做熟']})).body.data;r2=await attachReadyCover(f.who,r2);
  await call(f.who,'PATCH',`/recipes/${r2.id}/status`,{status:'PUBLISHED',expectedVersion:r2.version});await call(f.who,'POST',`/meals/${f.meal.id}/items`,{recipeId:r2.id});
  for(const id of [f.recipe.id,r2.id]){f.meal=await currentMeal(f.who,f.meal.id);const r=await call(f.who,'PATCH',`/meals/${f.meal.id}/dishes/${id}`,{expectedVersion:f.meal.version,cookMultiplier:0.5});assert.equal(r.status,200);}
  assert.equal((await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data[0].required,'0.001');
});

test('A14/A16: unit mismatch stays UNKNOWN, seasonings show presence without quantities',async()=>{
  const f=await mealFixture({quantity:500});
  await call(f.who,'POST','/inventory',{name:'番茄',quantity:0.35,unit:'kg'});
  await call(f.who,'POST','/inventory',{name:'生抽',kind:'SEASONING',availability:'PRESENT'});
  await call(f.who,'POST','/inventory',{name:'醋',kind:'SEASONING',availability:'ABSENT'});
  const values=(await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data;
  const tomato=values.find(i=>i.name==='番茄');assert.deepEqual([tomato.required,tomato.onHand,tomato.shortage,tomato.status],['500.000',null,null,'UNKNOWN']);
  for(const [name,status] of [['生抽','PRESENT'],['醋','ABSENT'],['盐','UNKNOWN']]){const i=values.find(i=>i.name===name);assert.equal(i.status,status);assert.equal(i.required,null);assert.equal(i.unit,'');}
});

test('Unknown and expired stock are never silently treated as zero or usable',async()=>{
  const f=await mealFixture();
  const stock=(await call(f.who,'POST','/inventory',{name:'番茄',unit:'g',availability:'UNKNOWN'})).body.data;
  assert.equal(stock.quantity,null);
  let result=(await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data[0];assert.equal(result.shortage,null);
  assert.equal((await call(f.who,'POST','/inventory',{name:'番茄',unit:'g',quantity:350})).status,409,'Blind overwrites rejected');
  assert.equal((await call(f.who,'POST','/inventory',{id:stock.id,expectedVersion:stock.version,name:'番茄',unit:'g',quantity:350,expiresAt:'2000-01-01'})).status,201);
  result=(await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data[0];assert.equal(result.status,'NEEDS_CHECK');assert.equal(result.onHand,null);
});

test('Completing a meal is idempotent and never changes inventory in the current phase',async()=>{
  const f=await confirmFixture(await mealFixture());
  const stock=(await call(f.who,'POST','/inventory',{name:'番茄',quantity:350,unit:'g'})).body.data;
  const body={expectedVersion:f.meal.version};
  const results=await Promise.all([1,2].map(()=>call(f.who,'POST',`/meals/${f.meal.id}/complete`,body)));
  assert.deepEqual(results.map(r=>r.status),[201,201],JSON.stringify(results));
  const saved=await db.inventoryItem.findUnique({where:{id:stock.id}});
  assert.equal(saved.quantity.toFixed(3),'350.000');assert.equal(saved.version,1);
  assert.equal(await db.inventoryTransaction.count({where:{sourceId:f.meal.id}}),0);
  assert.equal((await currentMeal(f.who,f.meal.id)).status,'COMPLETED');
  assert.equal((await call(f.who,'POST',`/meals/${f.meal.id}/complete`,{expectedVersion:f.meal.version+1})).status,409);
});

test('Completing a draft is rejected and does not touch manually maintained inventory',async()=>{
  const f=await mealFixture(),stock=(await call(f.who,'POST','/inventory',{name:'番茄',quantity:100,unit:'g'})).body.data;
  assert.equal((await call(f.who,'POST',`/meals/${f.meal.id}/complete`,{expectedVersion:f.meal.version})).status,409);
  assert.equal((await db.inventoryItem.findUnique({where:{id:stock.id}})).quantity.toString(),'100');
  assert.equal(await db.inventoryTransaction.count({where:{sourceId:f.meal.id}}),0);
});

test('A19/A20: shortages import once and purchase history survives repeat without changing stock',async()=>{
  const f=await confirmFixture(await mealFixture({quantity:500,seasonings:[]}));
  const stock=(await call(f.who,'POST','/inventory',{name:'番茄',quantity:350,unit:'g',location:'厨房'})).body.data;
  const need=(await call(f.who,'POST',`/meals/${f.meal.id}/recalculate`)).body.data[0];
  const dto={mealId:f.meal.id,snapshotVersion:1,selectedRequirementIds:[need.key],items:[{quantity:999999}]};
  const results=await Promise.all([1,2].map(()=>call(f.who,'POST','/shopping-lists/next-trip/import-shortages',dto)));
  assert.deepEqual(results.map(r=>r.status),[201,201],JSON.stringify(results));assert.equal(results[0].body.data.items[0].id,results[1].body.data.items[0].id);
  let item=results[0].body.data.items[0];assert.equal(item.quantity,'150');assert.equal(await db.shoppingItem.count({where:{sourceId:f.meal.id}}),1);
  item=(await call(f.who,'PATCH',`/shopping-lists/items/${item.id}`,{expectedVersion:item.version,status:'PURCHASED'})).body.data;
  assert.ok(item.purchasedAt);assert.equal(item.purchasedById,f.who.memberId);
  const again=await call(f.who,'POST','/shopping-lists/next-trip/import-shortages',dto);assert.equal(again.body.data.items[0].status,'PURCHASED');
  const repeatRequest={requestId:'same-repeat-request'};
  const repeats=await Promise.all([1,2].map(()=>call(f.who,'POST',`/shopping-lists/items/${item.id}/repeat`,repeatRequest)));
  assert.deepEqual(repeats.map(r=>r.status),[201,201]);assert.equal(repeats[0].body.data.id,repeats[1].body.data.id);assert.notEqual(repeats[0].body.data.id,item.id);assert.equal(repeats[0].body.data.previousItemId,item.id);
  assert.equal((await db.shoppingItem.findUnique({where:{id:item.id}})).status,'PURCHASED');
  assert.equal((await db.inventoryItem.findUnique({where:{id:stock.id}})).quantity.toString(),'350');
  assert.equal(await db.inventoryTransaction.count({where:{sourceType:'SHOPPING',sourceId:item.id}}),0);
});

test('Shortage import rejects stale snapshots, guessed requirements and unconfirmed meals',async()=>{
  const f=await mealFixture({seasonings:[]});
  const key=JSON.stringify([f.recipe.ingredients[0].ingredientId,'g']);
  const dto={mealId:f.meal.id,snapshotVersion:1,selectedRequirementIds:[key]};
  assert.equal((await call(f.who,'POST','/shopping-lists/next-trip/import-shortages',dto)).status,409);
  await confirmFixture(f);
  assert.equal((await call(f.who,'POST','/shopping-lists/next-trip/import-shortages',dto)).status,409,'Unknown stock is not a shortage');
  assert.equal((await call(f.who,'POST','/shopping-lists/next-trip/import-shortages',{...dto,snapshotVersion:99})).status,409);
  assert.equal((await call(f.who,'POST','/shopping-lists/next-trip/import-shortages',{...dto,selectedRequirementIds:['invented']})).status,400);
  assert.equal(await db.shoppingItem.count({where:{sourceId:f.meal.id}}),0);
});
