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
process.env.ARCHIVE_ENCRYPTION_KEY = Buffer.alloc(32,7).toString('base64');
process.env.ARCHIVE_ENCRYPTION_KEY_VERSION = '1';
const { AppModule } = require('../dist/app.module');
const { configureImageBodyParser } = require('../dist/media/binary-parser');
const { NotificationsService } = require('../dist/notifications/notifications.service');
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
test('A44: refresh tokens rotate once, reuse revokes the family, and logout revokes the current session',async()=>{
  const who=await identity(),raw='refresh-'+randomUUID()+randomUUID(),familyId=randomUUID();
  await db.authSession.create({data:{userId:who.userId,familyId,refreshHash:createHash('sha256').update(raw).digest('hex'),expiresAt:new Date(Date.now()+86400_000)}});
  const rotated=await call(null,'POST','/auth/refresh',{refreshToken:raw});assert.equal(rotated.status,201,JSON.stringify(rotated.body));
  assert.notEqual(rotated.body.data.refreshToken,raw);assert.match(rotated.body.data.accessToken,/^[\w-]+\.[\w-]+\.[\w-]+$/);
  assert.ok((await db.authSession.findUnique({where:{refreshHash:createHash('sha256').update(raw).digest('hex')}})).consumedAt);
  assert.equal((await call(null,'POST','/auth/refresh',{refreshToken:raw})).status,401,'reusing the consumed token revokes its whole family');
  assert.equal((await call(null,'POST','/auth/refresh',{refreshToken:rotated.body.data.refreshToken})).status,401,'a rotated child is invalid after reuse detection');
  assert.equal(await db.authSession.count({where:{familyId,revokedAt:null}}),0);
  const logoutRaw='logout-'+randomUUID()+randomUUID();
  await db.authSession.create({data:{userId:who.userId,familyId:randomUUID(),refreshHash:createHash('sha256').update(logoutRaw).digest('hex'),expiresAt:new Date(Date.now()+86400_000)}});
  assert.equal((await call(null,'POST','/auth/logout',{refreshToken:logoutRaw})).status,201);
  assert.equal((await call(null,'POST','/auth/refresh',{refreshToken:logoutRaw})).status,401);
});
test('A45: account owner can set a trimmed display name without a household context',async()=>{
  const who=await identity();
  const saved=await call(who,'PATCH','/auth/me',{nickname:'  小扣  '},undefined);
  assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.data.user.nickname,'小扣');
  assert.equal((await db.user.findUnique({where:{id:who.userId}})).nickname,'小扣');
  assert.equal((await call(who,'PATCH','/auth/me',{nickname:'   '},undefined)).status,400);
});
test('A02: every implemented household listing rejects missing/blank headers', async () => {
  const who = await owner();
  for (const path of ['/recipes', '/inventory', '/shopping-lists', '/trips', '/packing-templates', '/members', '/favorites', '/archive/fields', '/dashboard/summary?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z', '/inbox', '/notification-preferences', '/households/current/access', '/meals?from=2026-08-01&to=2026-09-01', '/calendar/events?from=2026-08-01&to=2026-09-01', '/calendar/anniversaries']) {
    for (const header of [undefined, '', ' ']) assert.equal((await call({ token: who.token }, 'GET', path, undefined, header)).status, 400, path);
  }
});
test('A03: valid token cannot select another household', async () => {
  const one = await owner(), two = await owner();
  for (const path of ['/recipes', '/members', '/trips', '/inventory', '/shopping-lists', '/favorites', '/archive/fields', '/dashboard/summary?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z', '/inbox', '/calendar/anniversaries']) assert.equal((await call(one, 'GET', path, undefined, two.householdId)).status, 403, path);
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
test('D09: trip detail edits are versioned, can clear optional dates, and update calendar projection',async()=>{
  const who=await owner();
  let trip=(await call(who,'POST','/trips',{title:'旧行程名',destination:'旧目的地',startsAt:'2026-09-20T08:00:00+08:00',endsAt:'2026-09-21T20:00:00+08:00'})).body.data;
  const updated=await call(who,'PATCH',`/trips/${trip.id}`,{expectedVersion:trip.version,title:'新行程名',destination:'',startsAt:'2026-09-22T08:00:00+08:00',endsAt:null});
  assert.equal(updated.status,200,JSON.stringify(updated.body));trip=updated.body.data;
  assert.equal(trip.version,2);assert.equal(trip.title,'新行程名');assert.equal(trip.destination,null);assert.equal(trip.endsAt,null);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}`,{expectedVersion:1,title:'过期页面覆盖'})).status,409);
  const events=await call(who,'GET','/calendar/events?from=2026-09-22&to=2026-09-23');
  const projected=events.body.data.find(event=>event.sourceType==='TRIP'&&event.sourceId===trip.id);assert.equal(projected.title,'新行程名');assert.equal(projected.endsAt,null);
});
test('Calendar rechecks source module permissions, not just calendar membership', async () => {
  const who=await owner(), member=await join(who);
  await call(who,'POST','/meals',{scheduledAt:'2026-08-31T18:00:00+08:00',mealType:'晚餐'});
  await permissions(who,member.memberId,1,['MEMBER'],[{module:'meals',level:'VIEW',effect:'DENY'}]);
  const result=await call(member,'GET','/calendar/events?from=2026-08-01&to=2026-09-01');
  assert.equal(result.status,200); assert.equal(result.body.data.filter(e=>e.type==='MEAL').length,0);
});
test('D09: yearly anniversaries project leap-day policy and remain versioned, editable and archivable',async()=>{
  const who=await owner(),viewer=await join(who,['GUEST'],[{module:'calendar',level:'VIEW',effect:'ALLOW'}]);
  const created=await call(who,'POST','/calendar/anniversaries',{title:'虚构闰日纪念日',localDate:'2024-02-29',recurrence:'YEARLY',leapPolicy:'FEB_28',note:'仅用于隔离测试'});
  assert.equal(created.status,201,JSON.stringify(created.body));const anniversary=created.body.data;assert.equal(anniversary.version,1);
  assert.equal((await call(viewer,'POST','/calendar/anniversaries',{title:'越权',localDate:'2026-01-01',recurrence:'ONCE'})).status,403);
  assert.equal((await call(who,'POST','/calendar/anniversaries',{title:'坏日期',localDate:'2026-02-30',recurrence:'ONCE'})).status,400);
  let events=await call(viewer,'GET','/calendar/events?from=2025-02-28T00%3A00%3A00%2B08%3A00&to=2025-03-01T00%3A00%3A00%2B08%3A00');
  assert.equal(events.status,200);assert.equal(events.body.data.length,1);assert.equal(events.body.data[0].occurrenceDate,'2025-02-28');assert.equal(events.body.data[0].sourceId,anniversary.id);
  const updated=await call(who,'PATCH',`/calendar/anniversaries/${anniversary.id}`,{expectedVersion:1,title:'更新后的纪念日',leapPolicy:'MAR_1'});
  assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.data.version,2);
  assert.equal((await call(who,'PATCH',`/calendar/anniversaries/${anniversary.id}`,{expectedVersion:1,title:'过期覆盖'})).status,409);
  events=await call(who,'GET','/calendar/events?from=2025-03-01T00%3A00%3A00%2B08%3A00&to=2025-03-02T00%3A00%3A00%2B08%3A00');
  assert.equal(events.body.data.length,1);assert.equal(events.body.data[0].title,'更新后的纪念日');assert.equal(events.body.data[0].occurrenceDate,'2025-03-01');
  assert.equal((await call(who,'POST',`/calendar/anniversaries/${anniversary.id}/archive`,{expectedVersion:2})).status,201);
  assert.equal((await call(who,'GET','/calendar/anniversaries')).body.data.some(item=>item.id===anniversary.id),false);
  assert.equal((await call(who,'GET','/calendar/events?from=2025-03-01T00%3A00%3A00%2B08%3A00&to=2025-03-02T00%3A00%3A00%2B08%3A00')).body.data.length,0);
});
test('D07: trip membership is explicit, revocation is immediate, and the final owner is protected', async () => {
  const who=await owner(),member=await join(who,['CAMPER']);
  const created=await call(who,'POST','/trips',{title:'成员边界验证',startsAt:'2026-09-10T08:00:00+08:00'});assert.equal(created.status,201);
  const trip=created.body.data;assert.equal(trip.members[0].tripRole,'OWNER');assert.equal(trip.version,1);
  assert.equal((await call(member,'GET',`/trips/${trip.id}`)).status,403,'Household role does not imply trip access');
  const candidates=await call(who,'GET',`/trips/${trip.id}/candidates`);assert.ok(candidates.body.data.some(row=>row.id===member.memberId));
  const added=await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId,canEdit:true});assert.equal(added.status,201,JSON.stringify(added.body));
  assert.equal((await call(member,'GET',`/trips/${trip.id}`)).status,200);
  const ownerRow=added.body.data.members.find(row=>row.membershipId===who.memberId);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/members/${who.memberId}`,{expectedVersion:ownerRow.version,canEdit:false})).status,409,'Owner cannot lock the trip by dropping edit permission');
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/members/${who.memberId}`,{expectedVersion:ownerRow.version,status:'REVOKED'})).status,409,'A trip keeps at least one owner');
  const memberRow=added.body.data.members.find(row=>row.membershipId===member.memberId);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/members/${member.memberId}`,{expectedVersion:memberRow.version,status:'REVOKED'})).status,200);
  assert.equal((await call(member,'GET',`/trips/${trip.id}`)).status,403);
  assert.equal((await call(member,'GET','/trips')).body.data.some(row=>row.id===trip.id),false);
});
test('D07: preparation groups accept only active trip members and reject stale updates', async () => {
  const who=await owner(),member=await join(who,['CAMPER']),outsider=await join(who,['CAMPER']);
  const trip=(await call(who,'POST','/trips',{title:'分组验证',startsAt:'2026-09-11T08:00:00+08:00'})).body.data;
  await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId});
  assert.equal((await call(who,'POST',`/trips/${trip.id}/preparation-groups`,{name:'朋友家',membershipIds:[outsider.memberId]})).status,400);
  const group=await call(who,'POST',`/trips/${trip.id}/preparation-groups`,{name:'我们家',membershipIds:[who.memberId,member.memberId]});assert.equal(group.status,201,JSON.stringify(group.body));
  const updated=await call(who,'PATCH',`/trips/${trip.id}/preparation-groups/${group.body.data.id}`,{expectedVersion:1,name:'主家',membershipIds:[who.memberId]});assert.equal(updated.status,200);assert.equal(updated.body.data.version,2);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/preparation-groups/${group.body.data.id}`,{expectedVersion:1,name:'过期覆盖',membershipIds:[]})).status,409);
});
test('D07/D08: pending responsibilities block revocation until explicitly cleared', async () => {
  const who=await owner(),member=await join(who,['CAMPER']);
  const trip=(await call(who,'POST','/trips',{title:'负责人验证',startsAt:'2026-09-12T08:00:00+08:00'})).body.data;
  const withMember=(await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId})).body.data;
  const item=await call(who,'POST',`/trips/${trip.id}/packing-items`,{name:'天幕',responsibleMembershipId:member.memberId});assert.equal(item.status,201);
  const memberRow=withMember.members.find(row=>row.membershipId===member.memberId);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/members/${member.memberId}`,{expectedVersion:memberRow.version,status:'REVOKED'})).status,409);
  const cleared=await call(who,'PATCH',`/trips/${trip.id}/members/${member.memberId}`,{expectedVersion:memberRow.version,status:'REVOKED',clearResponsibilities:true});assert.equal(cleared.status,200);
  const stored=await db.tripPackingItem.findUnique({where:{id:item.body.data.id}});assert.equal(stored.responsibleMembershipId,null);assert.equal(stored.version,2);
});
test('D07: normal completion converts active members to durable read-only history', async () => {
  const who=await owner(),member=await join(who,['CAMPER']);
  let trip=(await call(who,'POST','/trips',{title:'历史访问验证',startsAt:'2026-09-13T08:00:00+08:00'})).body.data;
  trip=(await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId})).body.data;
  for(const status of ['PENDING','DEPARTING','COMPLETED']){const changed=await call(who,'PATCH',`/trips/${trip.id}/status`,{expectedVersion:trip.version,status});assert.equal(changed.status,200,JSON.stringify(changed.body));trip=changed.body.data;}
  assert.ok(trip.members.every(row=>row.status==='HISTORY'));assert.equal((await call(member,'GET',`/trips/${trip.id}`)).status,200);
  assert.equal((await call(member,'POST',`/trips/${trip.id}/packing-items`,{name:'结束后新增'})).status,403);
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

test('A46: recipe managers can create trimmed categories and duplicate names return a conflict', async () => {
  const who=await owner();
  const created=await call(who,'POST','/recipes/categories',{name:'  海鲜  ',sortOrder:3});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.equal(created.body.data.name,'海鲜');assert.equal(created.body.data.sortOrder,3);
  const duplicate=await call(who,'POST','/recipes/categories',{name:'海鲜',sortOrder:4});
  assert.equal(duplicate.status,409,JSON.stringify(duplicate.body));assert.equal(await db.recipeCategory.count({where:{householdId:who.householdId,name:'海鲜'}}),1);
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
  const archived=await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'ARCHIVED',expectedVersion:published.body.data.version});
  assert.equal(archived.status,200);assert.equal(archived.body.data.status,'ARCHIVED');assert.equal((await call(viewer,'GET',`/recipes/${recipe.id}`)).status,404);
  const restored=await call(who,'PATCH',`/recipes/${recipe.id}/status`,{status:'DRAFT',expectedVersion:archived.body.data.version});
  assert.equal(restored.status,200);assert.equal(restored.body.data.status,'DRAFT');assert.equal((await call(viewer,'GET',`/recipes/${recipe.id}`)).status,404);
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
  const token=new URL('http://test'+url.body.data.path).searchParams.get('token');assert.equal((await call(ownerAccount,'GET','/recipes',undefined,ownerAccount.householdId)).status,200);assert.equal((await call(ownerAccount,'GET','/recipes',undefined,'not-the-household')).status,403);assert.ok(token.length>20);
});
test('D10: trip photos require trip membership, revoke new reads, and allow history members to add photos',async()=>{
  const who=await owner(),member=await join(who,['CAMPER']);
  let trip=(await call(who,'POST','/trips',{title:'行程相册验证',startsAt:'2026-09-20T08:00:00+08:00'})).body.data;
  assert.equal((await call(member,'GET',`/trips/${trip.id}/photos`)).status,404);
  trip=(await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId})).body.data;
  const intent=await call(member,'POST','/media/upload-intents',{ownerType:'TRIP',ownerId:trip.id,expectedOwnerVersion:trip.version,mimeType:'image/png',byteSize:TEST_PNG.length});assert.equal(intent.status,201,JSON.stringify(intent.body));assert.equal(intent.body.data.objectKey,undefined);
  const uploaded=await callRaw(member,intent.body.data.uploadPath,TEST_PNG);assert.equal(uploaded.status,200);
  const confirmed=await call(member,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:uploaded.body.data.checksumSha256});assert.equal(confirmed.status,201,JSON.stringify(confirmed.body));
  const photos=await call(who,'GET',`/trips/${trip.id}/photos`);assert.equal(photos.status,200);assert.equal(photos.body.data.length,1);assert.equal(photos.body.data[0].createdBy.id,member.userId);
  const url=await call(member,'GET',`/media/assets/${confirmed.body.data.asset.id}/url`);assert.equal(url.status,200);
  const memberRow=trip.members.find(row=>row.membershipId===member.memberId);trip=(await call(who,'PATCH',`/trips/${trip.id}/members/${member.memberId}`,{expectedVersion:memberRow.version,status:'REVOKED',clearResponsibilities:true})).body.data;
  assert.equal((await call(member,'GET',`/media/assets/${confirmed.body.data.asset.id}/url`)).status,404);
  assert.equal((await app.inject({method:'GET',url:'/v1'+url.body.data.path})).statusCode,200,'Already issued capability remains short lived');
  for(const status of ['PENDING','DEPARTING','COMPLETED'])trip=(await call(who,'PATCH',`/trips/${trip.id}/status`,{expectedVersion:trip.version,status})).body.data;
  const afterIntent=await call(who,'POST','/media/upload-intents',{ownerType:'TRIP',ownerId:trip.id,expectedOwnerVersion:trip.version,mimeType:'image/png',byteSize:TEST_PNG.length});assert.equal(afterIntent.status,201,JSON.stringify(afterIntent.body));
  const afterUpload=await callRaw(who,afterIntent.body.data.uploadPath,TEST_PNG);const afterConfirm=await call(who,'POST','/media/assets/confirm',{intentId:afterIntent.body.data.id,checksumSha256:afterUpload.body.data.checksumSha256});assert.equal(afterConfirm.status,201);assert.equal(afterConfirm.body.data.ownerVersion,trip.version+1);
  assert.equal((await call(who,'GET',`/trips/${trip.id}/photos`)).body.data.length,2);
});
test('A36/C03: task assignment, versions, history, reopen reason and calendar cancellation form one flow',async()=>{
  const who=await owner(),member=await join(who,['MEMBER']),viewer=await join(who,['GUEST'],[{module:'tasks',level:'VIEW',effect:'ALLOW'},{module:'calendar',level:'VIEW',effect:'ALLOW'}]);
  const path='/tasks',dueAt='2026-09-25T18:00:00+08:00';
  assert.equal((await call(member,'POST',path,{type:'TODO',title:'提醒晚于截止',assigneeMembershipId:member.memberId,dueAt,reminderAt:'2026-09-26T09:00:00+08:00',priority:'NORMAL'})).status,400);
  const created=await call(who,'POST',path,{type:'REQUEST',title:'清洗空调',description:'联系师傅并确认完成',assigneeMembershipId:member.memberId,dueAt,reminderAt:'2026-09-24T09:00:00+08:00',priority:'HIGH'});assert.equal(created.status,201,JSON.stringify(created.body));let task=created.body.data;assert.equal(task.version,1);assert.equal(task.assigneeMembershipId,member.memberId);
  assert.equal((await call(viewer,'GET',path)).status,200);assert.equal((await call(viewer,'POST',path,{type:'TODO',title:'越权创建',priority:'LOW'})).status,403);
  assert.equal((await call(member,'PATCH',`${path}/${task.id}`,{expectedVersion:1,assigneeMembershipId:who.memberId})).status,403,'Only managers reassign');
  let changed=await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:1,status:'IN_PROGRESS'});assert.equal(changed.status,200);task=changed.body.data;
  assert.equal((await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:1,status:'COMPLETED'})).status,409);
  assert.equal((await call(member,'POST',`${path}/${task.id}/comments`,{comment:'已联系师傅'})).status,201);
  changed=await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:task.version,status:'COMPLETED'});task=changed.body.data;assert.equal(task.status,'COMPLETED');assert.ok(task.completedAt);
  assert.equal((await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:task.version,status:'PENDING'})).status,400,'Reopen requires reason');
  changed=await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:task.version,status:'PENDING',reason:'返工复查'});task=changed.body.data;assert.equal(task.status,'PENDING');
  let calendar=await call(viewer,'GET','/calendar/events?from=2026-09-25T00:00:00%2B08:00&to=2026-09-26T00:00:00%2B08:00');assert.ok(calendar.body.data.some(event=>event.sourceType==='TASK'&&event.sourceId===task.id));
  changed=await call(member,'PATCH',`${path}/${task.id}/status`,{expectedVersion:task.version,status:'CANCELLED'});task=changed.body.data;
  calendar=await call(viewer,'GET','/calendar/events?from=2026-09-25T00:00:00%2B08:00&to=2026-09-26T00:00:00%2B08:00');assert.ok(!calendar.body.data.some(event=>event.sourceId===task.id));
  const detail=await call(who,'GET',`${path}/${task.id}`);assert.ok(detail.body.data.history.length>=6);assert.ok(detail.body.data.history.some(item=>item.comment==='返工复查'));
});
test('A38/D12: favorite visibility, private media and idempotent draft conversion preserve the source',async()=>{
  const who=await owner();
  const editor=await join(who,['MEMBER'],[{module:'recipes',level:'EDIT',effect:'ALLOW'}]);
  const viewer=await join(who,['GUEST'],[{module:'favorites',level:'VIEW',effect:'ALLOW'}]);
  assert.equal((await call(editor,'POST','/favorites',{type:'LINK',title:'无协议链接',sourceUrl:'example.test',tags:[],visibility:'HOUSEHOLD'})).status,400);
  const sharedResponse=await call(editor,'POST','/favorites',{type:'LINK',title:'想试的新早餐',text:'只保存我手工填写的内容',sourceUrl:'https://example.test/inspiration',tags:['早餐','早餐'],visibility:'HOUSEHOLD'});
  assert.equal(sharedResponse.status,201,JSON.stringify(sharedResponse.body));let shared=sharedResponse.body.data;
  assert.deepEqual(shared.tags,['早餐']);assert.equal((await call(viewer,'GET',`/favorites/${shared.id}`)).status,200);
  const privateResponse=await call(editor,'POST','/favorites',{type:'TEXT',title:'私人的小想法',text:'仅自己可见',tags:[],visibility:'PRIVATE'});
  assert.equal(privateResponse.status,201);const privateFavorite=privateResponse.body.data;
  assert.equal((await call(viewer,'GET',`/favorites/${privateFavorite.id}`)).status,404);
  assert.ok(!(await call(viewer,'GET','/favorites')).body.data.some(item=>item.id===privateFavorite.id));
  assert.ok((await call(who,'GET','/favorites')).body.data.some(item=>item.id===privateFavorite.id),'MANAGE can maintain all household favorites');
  assert.equal((await call(editor,'PATCH',`/favorites/${shared.id}`,{expectedVersion:99,title:'过期覆盖'})).status,409);
  const intent=await call(editor,'POST','/media/upload-intents',{ownerType:'FAVORITE',ownerId:shared.id,expectedOwnerVersion:shared.version,mimeType:'image/png',byteSize:TEST_PNG.length});assert.equal(intent.status,201,JSON.stringify(intent.body));
  const uploaded=await callRaw(editor,intent.body.data.uploadPath,TEST_PNG);const confirmed=await call(editor,'POST','/media/assets/confirm',{intentId:intent.body.data.id,checksumSha256:uploaded.body.data.checksumSha256});assert.equal(confirmed.status,201,JSON.stringify(confirmed.body));
  shared=(await call(editor,'GET',`/favorites/${shared.id}`)).body.data;assert.deepEqual(shared.assetIds,[confirmed.body.data.asset.id]);assert.equal(shared.version,2);
  assert.equal((await call(viewer,'GET',`/media/assets/${confirmed.body.data.asset.id}/url`)).status,200);
  const input={expectedVersion:shared.version,targetType:'RECIPE',idempotencyKey:'favorite-retry-key-001',confirmedTitle:'早餐灵感草稿'};
  const converted=await Promise.all([1,2].map(()=>call(editor,'POST',`/favorites/${shared.id}/convert`,input)));
  assert.ok(converted.every(result=>result.status===201),JSON.stringify(converted));assert.equal(converted[0].body.data.targetId,converted[1].body.data.targetId);
  const recipe=await db.recipe.findUnique({where:{id:converted[0].body.data.targetId},include:{ingredients:true,seasonings:true}});
  assert.equal(recipe.status,'DRAFT');assert.deepEqual(recipe.steps,[]);assert.equal(recipe.ingredients.length,0);assert.equal(recipe.seasonings.length,0);assert.equal(recipe.coverAssetId,null);
  const covered=await attachReadyCover(editor,recipe);assert.equal((await call(editor,'PATCH',`/recipes/${recipe.id}/status`,{status:'PUBLISHED',expectedVersion:covered.version})).status,409,'Empty converted draft cannot publish even after adding a cover');
  assert.ok(await db.favorite.findUnique({where:{id:shared.id}}),'Conversion keeps source favorite');
  assert.equal(await db.favoriteConversion.count({where:{favoriteId:shared.id,targetType:'RECIPE'}}),1);
  const taskInput={expectedVersion:shared.version,targetType:'TASK',idempotencyKey:'favorite-task-key-001',confirmedTitle:'试做早餐',confirmedDescription:'周末安排'};
  const taskConversion=await call(editor,'POST',`/favorites/${shared.id}/convert`,taskInput);assert.equal(taskConversion.status,201,JSON.stringify(taskConversion.body));
  const task=await db.task.findUnique({where:{id:taskConversion.body.data.targetId}});assert.equal(task.status,'PENDING');assert.equal(task.assigneeMembershipId,editor.memberId);assert.match(task.description,/周末安排/);assert.match(task.description,/https:\/\/example\.test/);
  assert.equal((await call(editor,'POST',`/favorites/${shared.id}/archive`,{expectedVersion:shared.version})).status,201);
  assert.equal((await call(viewer,'GET',`/favorites/${shared.id}`)).status,404);
  assert.ok(await db.recipe.findUnique({where:{id:recipe.id}}),'Archiving the source does not delete converted targets');
});
test('A39/D12: archive field ACL, encryption, versions and audits never expose manager-only plaintext',async()=>{
  const who=await owner();
  const editor=await join(who,['GUEST'],[{module:'archive',level:'EDIT',effect:'ALLOW'}]);
  const viewer=await join(who,['GUEST'],[{module:'archive',level:'VIEW',effect:'ALLOW'}]);
  const outsider=await owner();
  const managerOnly=await call(who,'POST','/archive/fields',{key:'home_address',label:'家庭住址',valueType:'ADDRESS',sensitive:true,visibility:'MANAGERS',grants:[]});
  assert.equal(managerOnly.status,201,JSON.stringify(managerOnly.body));let managerField=managerOnly.body.data;
  const secret='虚构测试地址-不会出现在日志里';
  const saved=await call(who,'PUT',`/archive/fields/${managerField.id}/value`,{expectedVersion:0,value:secret});assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.ok(!(await call(viewer,'GET','/archive/fields')).body.data.some(field=>field.id===managerField.id));
  assert.equal((await call(viewer,'GET',`/archive/fields/${managerField.id}/value`)).status,404);
  const stored=await db.archiveFieldValue.findUnique({where:{fieldId:managerField.id}});assert.ok(stored.valueCiphertext);assert.ok(!stored.valueCiphertext.includes(secret));assert.equal(stored.keyVersion,1);
  const audits=await db.auditLog.findMany({where:{householdId:who.householdId,targetId:managerField.id}});assert.ok(!JSON.stringify(audits).includes(secret),'Audit log must not contain archive plaintext');
  const selected=await call(who,'POST','/archive/fields',{key:'family_contact',label:'家庭联系人',valueType:'CONTACT',sensitive:true,visibility:'SELECTED',grants:[{membershipId:editor.memberId,canRead:true,canEdit:true}]});
  assert.equal(selected.status,201,JSON.stringify(selected.body));const field=selected.body.data;
  assert.ok((await call(editor,'GET','/archive/fields')).body.data.some(item=>item.id===field.id));assert.ok(!(await call(viewer,'GET','/archive/fields')).body.data.some(item=>item.id===field.id));
  const editorSaved=await call(editor,'PUT',`/archive/fields/${field.id}/value`,{expectedVersion:0,value:'虚构联系人 10086'});assert.equal(editorSaved.status,200,JSON.stringify(editorSaved.body));
  const editorList=await call(editor,'GET','/archive/fields');const serialized=JSON.stringify(editorList.body);assert.ok(!serialized.includes('虚构联系人'));assert.ok(!serialized.includes('valueCiphertext'));assert.ok(!serialized.includes('grants'));
  const read=await call(editor,'GET',`/archive/fields/${field.id}/value`);assert.equal(read.status,200);assert.equal(read.body.data.value,'虚构联系人 10086');assert.equal(read.body.data.valueVersion,1);
  assert.equal((await call(editor,'PUT',`/archive/fields/${field.id}/value`,{expectedVersion:0,value:'过期覆盖'})).status,409);
  assert.equal((await call(who,'POST','/archive/fields',{key:'bad_grant',label:'跨家庭授权',valueType:'TEXT',sensitive:false,visibility:'SELECTED',grants:[{membershipId:outsider.memberId,canRead:true,canEdit:false}]})).status,400);
  const dateField=(await call(who,'POST','/archive/fields',{key:'important_date',label:'重要日期',valueType:'DATE',sensitive:false,visibility:'MEMBERS',grants:[]})).body.data;
  assert.equal((await call(who,'PUT',`/archive/fields/${dateField.id}/value`,{expectedVersion:0,value:'2026-02-31'})).status,400);
  assert.equal((await call(who,'PATCH',`/archive/fields/${field.id}`,{expectedVersion:99,label:'过期字段'})).status,409);
  assert.equal((await call(who,'POST',`/archive/fields/${managerField.id}/archive`,{expectedVersion:managerField.version})).status,201);
  assert.equal((await call(who,'GET',`/archive/fields/${managerField.id}/value`)).status,404);
});
test('A40/D12: dashboard hides unauthorized sources, filters trip membership and returns null for an empty task denominator',async()=>{
  const who=await owner();
  const viewer=await join(who,['GUEST'],[{module:'dashboard',level:'VIEW',effect:'ALLOW'},{module:'tasks',level:'VIEW',effect:'ALLOW'},{module:'trips',level:'VIEW',effect:'ALLOW'}]);
  const from='2026-09-01T00:00:00+08:00',to='2026-10-01T00:00:00+08:00',path=`/dashboard/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  await call(who,'POST','/trips',{title:'不属于查看者的行程',startsAt:'2026-09-12T08:00:00+08:00'});
  let result=await call(viewer,'GET',path);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.deepEqual(result.body.data.tasks,{completed:0,total:0,completionRate:null});assert.deepEqual(result.body.data.trips,{visibleTripCount:0,pendingPackingCount:0});
  assert.equal(result.body.data.recipes,undefined);assert.equal(result.body.data.shopping,undefined);assert.equal(result.body.data.meals,undefined);
  let done=(await call(who,'POST','/tasks',{type:'TODO',title:'已完成事项',priority:'NORMAL'})).body.data;
  done=(await call(who,'PATCH',`/tasks/${done.id}/status`,{expectedVersion:done.version,status:'COMPLETED'})).body.data;
  let cancelled=(await call(who,'POST','/tasks',{type:'TODO',title:'已取消事项',priority:'NORMAL'})).body.data;
  await call(who,'PATCH',`/tasks/${cancelled.id}/status`,{expectedVersion:cancelled.version,status:'CANCELLED'});
  result=await call(viewer,'GET',path);assert.deepEqual(result.body.data.tasks,{completed:1,total:1,completionRate:1});
  assert.equal((await call(viewer,'GET',`/dashboard/summary?from=${encodeURIComponent('2025-01-01T00:00:00Z')}&to=${encodeURIComponent('2026-09-02T00:00:00Z')}`)).status,400);
  const dashboardOnly=await join(who,['GUEST'],[{module:'dashboard',level:'VIEW',effect:'ALLOW'}]);
  const hidden=await call(dashboardOnly,'GET',path);assert.deepEqual(Object.keys(hidden.body.data).sort(),['from','to']);
});
test('A41/D13: task outbox produces an authorized inbox reminder, cancellation and disabled preference suppress delivery',async()=>{
  const who=await owner(),member=await join(who,['MEMBER']),worker=app.get(NotificationsService);
  const reminderAt='2026-09-10T11:00:00+08:00',dueAt='2026-09-11T18:00:00+08:00',runAt=new Date('2026-09-10T12:00:00+08:00');
  const created=await call(who,'POST','/tasks',{type:'TODO',title:'按时清洗空调',assigneeMembershipId:member.memberId,dueAt,reminderAt,priority:'NORMAL'});assert.equal(created.status,201,JSON.stringify(created.body));
  assert.equal(await db.outboxEvent.count({where:{aggregateId:created.body.data.id,version:1}}),1);assert.equal(await db.notificationJob.count({where:{sourceId:created.body.data.id,status:'PENDING'}}),1);
  assert.equal((await call(member,'GET','/inbox')).body.data.length,0);assert.ok((await worker.runDue(runAt))>=1);
  let inbox=await call(member,'GET','/inbox');assert.equal(inbox.status,200);assert.equal(inbox.body.data.length,1);assert.equal(inbox.body.data[0].title,'按时清洗空调');assert.equal(inbox.body.data[0].readAt,null);
  const read=await call(member,'PATCH',`/inbox/${inbox.body.data[0].id}/read`,{expectedVersion:inbox.body.data[0].version});assert.equal(read.status,200);assert.ok(read.body.data.readAt);
  const settings=await call(member,'GET','/notification-settings/public');assert.deepEqual(settings.body.data,{taskReminderTemplateId:null,wechatSubscriptionAvailable:false});
  assert.equal((await call(member,'POST','/subscriptions/receipts',{templateId:'not-configured',result:'REJECT',clientScene:'settings'})).status,400);
  let preferences=await call(member,'GET','/notification-preferences');assert.equal(preferences.body.data[0].version,0);assert.equal(preferences.body.data[0].enabled,true);
  const disabled=await call(member,'PATCH','/notification-preferences',{eventType:'TASK_REMINDER',expectedVersion:0,enabled:false,leadMinutes:0,quietStart:'22:00',quietEnd:'08:00'});assert.equal(disabled.status,200,JSON.stringify(disabled.body));
  const suppressed=await call(who,'POST','/tasks',{type:'TODO',title:'不发送的站内提醒',assigneeMembershipId:member.memberId,dueAt,reminderAt,priority:'NORMAL'});assert.equal(suppressed.status,201);
  await worker.runDue(runAt);assert.equal((await call(member,'GET','/inbox')).body.data.length,1);assert.equal((await db.notificationJob.findFirst({where:{sourceId:suppressed.body.data.id}})).status,'CANCELLED');
  let cancelled=(await call(who,'POST','/tasks',{type:'TODO',title:'取消后不提醒',assigneeMembershipId:who.memberId,dueAt,reminderAt,priority:'NORMAL'})).body.data;
  cancelled=(await call(who,'PATCH',`/tasks/${cancelled.id}/status`,{expectedVersion:cancelled.version,status:'CANCELLED'})).body.data;
  assert.equal(cancelled.status,'CANCELLED');assert.equal(await db.notificationJob.count({where:{sourceId:cancelled.id,status:'PENDING'}}),0);assert.equal(await db.outboxEvent.count({where:{aggregateId:cancelled.id}}),2);
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
  const item=first.body.data.items[0]; await call(who,'PATCH',`${path}/${item.id}`,{expectedVersion:item.version,responsibleMembershipId:member.memberId});
  assert.equal((await call(member,'GET',path)).status,200);
  assert.equal((await call(member,'PATCH',`${path}/${item.id}`,{expectedVersion:item.version,status:'PACKED'})).status,403);
  assert.equal((await call(member,'GET','/packing-templates')).status,403);
});
test('A28: template edits are versioned, removed items are archived, and existing trip snapshots stay unchanged',async()=>{
  const who=await owner();
  const firstTrip=(await call(who,'POST','/trips',{title:'旧行程快照',startsAt:'2026-09-12T08:00:00+08:00'})).body.data;
  let template=(await call(who,'POST','/packing-templates',{name:'周末装备',items:[{name:'天幕'},{name:'炭'}]})).body.data;
  assert.equal(template.version,1);assert.deepEqual(template.items.map(item=>item.name),['天幕','炭']);
  const firstApply=await call(who,'POST',`/trips/${firstTrip.id}/packing-items/apply-template`,{templateId:template.id});
  assert.equal(firstApply.status,201);assert.equal(firstApply.body.data.addedCount,2);
  const retained=template.items[0],removed=template.items[1];
  const edited=await call(who,'PATCH',`/packing-templates/${template.id}`,{expectedVersion:1,name:'精简装备',items:[{id:retained.id,name:'大天幕'}]});
  assert.equal(edited.status,200,JSON.stringify(edited.body));template=edited.body.data;
  assert.equal(template.version,2);assert.deepEqual(template.items.map(item=>item.name),['大天幕']);assert.equal(template.items[0].version,2);
  assert.equal((await call(who,'PATCH',`/packing-templates/${template.id}`,{expectedVersion:1,name:'过期页面覆盖'})).status,409);
  const archivedItem=await db.packingTemplateItem.findUnique({where:{id:removed.id}});
  assert.ok(archivedItem.archivedAt);assert.equal(archivedItem.version,2);
  const oldItems=(await call(who,'GET',`/trips/${firstTrip.id}/packing-items`)).body.data;
  assert.deepEqual(oldItems.map(item=>item.name).sort(),['天幕','炭']);
  assert.deepEqual(oldItems.map(item=>item.sourceTemplateNameSnapshot).sort(),['周末装备','周末装备']);
  const nextTrip=(await call(who,'POST','/trips',{title:'新行程快照',startsAt:'2026-09-13T08:00:00+08:00'})).body.data;
  const nextApply=await call(who,'POST',`/trips/${nextTrip.id}/packing-items/apply-template`,{templateId:template.id});
  assert.equal(nextApply.body.data.addedCount,1);assert.equal(nextApply.body.data.items[0].name,'大天幕');
  const archived=await call(who,'PATCH',`/packing-templates/${template.id}`,{expectedVersion:2,archived:true});
  assert.equal(archived.status,200);assert.equal(archived.body.data.version,3);
  assert.equal((await call(who,'POST',`/trips/${nextTrip.id}/packing-items/apply-template`,{templateId:template.id})).status,404);
});
test('D08: packing assignments honor preparation groups, versions, and soft exclusion',async()=>{
  const who=await owner(),member=await join(who,['CAMPER']);
  const trip=(await call(who,'POST','/trips',{title:'行李版本验证',startsAt:'2026-09-14T08:00:00+08:00'})).body.data;
  await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId});
  const group=await call(who,'POST',`/trips/${trip.id}/preparation-groups`,{name:'我们家',membershipIds:[who.memberId]});assert.equal(group.status,201);
  const path=`/trips/${trip.id}/packing-items`;
  assert.equal((await call(who,'POST',path,{name:'帐篷',groupId:group.body.data.id,responsibleMembershipId:member.memberId})).status,400,'Person must belong to selected group');
  const created=await call(who,'POST',path,{name:'帐篷',groupId:group.body.data.id,responsibleMembershipId:who.memberId});assert.equal(created.status,201);assert.equal(created.body.data.version,1);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/preparation-groups/${group.body.data.id}`,{expectedVersion:1,name:'我们家',membershipIds:[]})).status,409,'Group removal cannot strand an assigned item');
  const updated=await call(who,'PATCH',`${path}/${created.body.data.id}`,{expectedVersion:1,status:'PACKED'});assert.equal(updated.status,200);assert.equal(updated.body.data.version,2);
  assert.equal((await call(who,'PATCH',`${path}/${created.body.data.id}`,{expectedVersion:1,status:'PENDING'})).status,409);
  assert.equal((await call(who,'DELETE',`${path}/${created.body.data.id}?expectedVersion=1`)).status,409);
  assert.equal((await call(who,'DELETE',`${path}/${created.body.data.id}?expectedVersion=2`)).status,200);
  assert.equal((await call(who,'GET',path)).body.data.length,0);
  const stored=await db.tripPackingItem.findUnique({where:{id:created.body.data.id}});assert.ok(stored.excludedAt);assert.equal(stored.version,3);
});
test('D09: itinerary versions, route staleness and confirmed stop removal preserve linked lodging',async()=>{
  const who=await owner(),viewer=await join(who,['CAMPER']);
  const trip=(await call(who,'POST','/trips',{title:'路线闭环验证',startsAt:'2026-09-15T08:00:00+08:00'})).body.data;
  assert.equal((await call(viewer,'GET',`/trips/${trip.id}/itinerary`)).status,403);
  assert.equal((await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:1,title:'越界点',stopType:'WAYPOINT',latitude:91,longitude:120})).status,400);
  const first=await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:1,title:'集合点',stopType:'MEETING',latitude:39.9042,longitude:116.4074});assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.data.tripVersion,2);
  assert.equal((await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:1,title:'过期写入',stopType:'WAYPOINT',latitude:40,longitude:117})).status,409);
  const second=await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:2,title:'营地',stopType:'CAMPSITE',latitude:40.12,longitude:117.21});assert.equal(second.body.data.tripVersion,3);
  assert.equal((await call(who,'POST',`/trips/${trip.id}/stops/reorder`,{expectedTripVersion:3,stopIds:[first.body.data.stop.id]})).status,400);
  const leg=await call(who,'POST',`/trips/${trip.id}/legs`,{expectedTripVersion:3,fromStopId:first.body.data.stop.id,toStopId:second.body.data.stop.id,mode:'DRIVING',routeKind:'SCHEMATIC'});assert.equal(leg.status,201,JSON.stringify(leg.body));assert.equal(leg.body.data.leg.provider,null);assert.equal(leg.body.data.tripVersion,4);
  assert.equal((await call(who,'POST',`/trips/${trip.id}/legs`,{expectedTripVersion:4,fromStopId:second.body.data.stop.id,toStopId:first.body.data.stop.id,mode:'DRIVING',routeKind:'PLANNED'})).status,400,'Planned route cannot be invented without geometry/provider');
  assert.equal((await call(who,'POST',`/trips/${trip.id}/accommodations`,{expectedTripVersion:4,name:'日期错误酒店',checkInDate:'2026-09-16',checkOutDate:'2026-09-16'})).status,400);
  const lodging=await call(who,'POST',`/trips/${trip.id}/accommodations`,{expectedTripVersion:4,stopId:second.body.data.stop.id,name:'营地附近酒店',address:'虚构地址',checkInDate:'2026-09-16',checkOutDate:'2026-09-17',amount:999});assert.equal(lodging.status,201,JSON.stringify(lodging.body));assert.equal(lodging.body.data.tripVersion,5);assert.equal(lodging.body.data.accommodation.amount,undefined,'Budget fields are not part of lodging');
  const edited=await call(who,'PATCH',`/trips/${trip.id}/stops/${first.body.data.stop.id}`,{expectedTripVersion:5,expectedVersion:1,title:'新集合点'});assert.equal(edited.status,200);assert.equal(edited.body.data.tripVersion,6);
  let itinerary=await call(who,'GET',`/trips/${trip.id}/itinerary`);assert.ok(itinerary.body.data.legs[0].staleAt,'Changing a stop marks route stale');
  const impact=await call(who,'GET',`/trips/${trip.id}/stops/${second.body.data.stop.id}/delete-impact`);assert.deepEqual([impact.body.data.legs.length,impact.body.data.accommodations.length],[1,1]);
  assert.equal((await call(who,'DELETE',`/trips/${trip.id}/stops/${second.body.data.stop.id}?expectedVersion=1&expectedTripVersion=6`)).status,409);
  const removed=await call(who,'DELETE',`/trips/${trip.id}/stops/${second.body.data.stop.id}?expectedVersion=1&expectedTripVersion=6&confirm=true`);assert.equal(removed.status,200);assert.equal(removed.body.data.tripVersion,7);
  itinerary=await call(who,'GET',`/trips/${trip.id}/itinerary`);assert.equal(itinerary.body.data.stops.length,1);assert.equal(itinerary.body.data.legs.length,0);assert.equal(itinerary.body.data.accommodations[0].stopId,null,'Lodging survives as trip-level record');
});
test('D09: route endpoints reject stops from another trip',async()=>{
  const who=await owner();
  const one=(await call(who,'POST','/trips',{title:'行程甲',startsAt:'2026-09-16T08:00:00+08:00'})).body.data,two=(await call(who,'POST','/trips',{title:'行程乙',startsAt:'2026-09-17T08:00:00+08:00'})).body.data;
  const a=(await call(who,'POST',`/trips/${one.id}/stops`,{expectedTripVersion:1,title:'甲点',stopType:'MEETING',latitude:31,longitude:121})).body.data.stop;
  const b=(await call(who,'POST',`/trips/${two.id}/stops`,{expectedTripVersion:1,title:'乙点',stopType:'MEETING',latitude:30,longitude:120})).body.data.stop;
  assert.equal((await call(who,'POST',`/trips/${one.id}/legs`,{expectedTripVersion:2,fromStopId:a.id,toStopId:b.id,mode:'DRIVING'})).status,400);
});
test('D09: stale planned route cannot be revived without freshly planned geometry',async()=>{
  const who=await owner();
  const trip=(await call(who,'POST','/trips',{title:'规划路线过期验证',startsAt:'2026-09-17T08:00:00+08:00'})).body.data;
  const first=(await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:1,title:'起点',stopType:'MEETING',latitude:31.1,longitude:121.1})).body.data;
  const second=(await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:2,title:'终点',stopType:'CAMPSITE',latitude:31.2,longitude:121.2})).body.data;
  const leg=(await call(who,'POST',`/trips/${trip.id}/legs`,{expectedTripVersion:3,fromStopId:first.stop.id,toStopId:second.stop.id,mode:'DRIVING',routeKind:'PLANNED',provider:'TEST',geometry:[[121.1,31.1],[121.2,31.2]]})).body.data;
  const changed=await call(who,'PATCH',`/trips/${trip.id}/stops/${first.stop.id}`,{expectedTripVersion:4,expectedVersion:1,latitude:31.11});assert.equal(changed.status,200);
  assert.equal((await call(who,'PATCH',`/trips/${trip.id}/legs/${leg.leg.id}`,{expectedTripVersion:5,expectedVersion:2,mode:'WALKING'})).status,409);
  const replanned=await call(who,'PATCH',`/trips/${trip.id}/legs/${leg.leg.id}`,{expectedTripVersion:5,expectedVersion:2,mode:'WALKING',geometry:[[121.1,31.11],[121.2,31.2]]});assert.equal(replanned.status,200,JSON.stringify(replanned.body));assert.equal(replanned.body.data.leg.staleAt,null);
});
test('D09: completed trip members retain itinerary read access but cannot mutate it',async()=>{
  const who=await owner(),member=await join(who,['CAMPER']);
  let trip=(await call(who,'POST','/trips',{title:'历史路线验证',startsAt:'2026-09-18T08:00:00+08:00'})).body.data;
  trip=(await call(who,'POST',`/trips/${trip.id}/members`,{membershipId:member.memberId})).body.data;
  const stop=await call(who,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:trip.version,title:'历史营地',stopType:'CAMPSITE',latitude:39,longitude:116});trip.version=stop.body.data.tripVersion;
  for(const status of ['PENDING','DEPARTING','COMPLETED']){const changed=await call(who,'PATCH',`/trips/${trip.id}/status`,{expectedVersion:trip.version,status});trip=changed.body.data;}
  assert.equal((await call(member,'GET',`/trips/${trip.id}/itinerary`)).status,200);
  assert.equal((await call(member,'POST',`/trips/${trip.id}/stops`,{expectedTripVersion:trip.version,title:'历史篡改',stopType:'WAYPOINT',latitude:40,longitude:117})).status,403);
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
