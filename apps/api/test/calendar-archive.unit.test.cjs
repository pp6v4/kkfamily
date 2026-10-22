require('reflect-metadata');
require('ts-node').register({transpileOnly:true,compilerOptions:{incremental:false}});
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ValidationPipe}=require('@nestjs/common');
const {CalendarService}=require('../src/calendar/calendar.service');
const {AccessService}=require('../src/access/access.service');
const {ArchiveAnniversaryDto}=require('../src/calendar/dto/anniversary.dto');

const query={from:'2026-09-09T00:00:00+08:00',to:'2026-09-10T00:00:00+08:00'};
function fixture(options={}){
  const writes=[],reads=[];
  const legacy={id:'legacy-a',householdId:'house-a',type:'ANNIVERSARY',title:'旧版纪念日',startsAt:new Date('2026-09-09T00:00:00+08:00'),endsAt:null,sourceType:null,sourceId:null,createdById:'unknown-old-user',version:1,archivedAt:null,createdAt:new Date('2026-08-01T00:00:00Z'),updatedAt:new Date('2026-08-01T00:00:00Z'),...options.legacy};
  const anniversary={id:'anniversary-a',householdId:'house-a',title:'新版纪念日',localDate:'2020-09-09',recurrence:'YEARLY',leapPolicy:'FEB_28',note:null,version:3,archivedAt:null,createdById:'other-member'};
  const member={id:'member-a',userId:'user-a',householdId:'house-a',status:'ACTIVE',roles:[],permissions:[{module:'calendar',level:options.viewOnly?'VIEW':'EDIT',effect:'ALLOW'}]};
  function matches(row,where){return Object.entries(where).every(([key,value])=>{
    if(key==='OR')return true;
    if(value&&typeof value==='object')return true;
    return row[key]===value;
  });}
  const tx={
    membership:{findFirst:async({where})=>matches(member,where)?member:null},
    calendarEvent:{
      findMany:async input=>{reads.push(['legacy-list',input]);return matches(legacy,input.where)?[{...legacy}]:[];},
      findFirst:async input=>{reads.push(['legacy',input]);return matches(legacy,input.where)?{...legacy}:null;},
      updateMany:async input=>{reads.push(['legacy-update',input]);if(options.lostUpdate||!matches(legacy,input.where))return{count:0};writes.push(['legacy',input]);Object.assign(legacy,input.data,{version:legacy.version+1});return{count:1};},
    },
    anniversary:{
      findMany:async input=>matches(anniversary,input.where)?[{...anniversary}]:[],
      findFirst:async input=>matches(anniversary,input.where)?{...anniversary}:null,
      updateMany:async input=>{if(!matches(anniversary,input.where))return{count:0};writes.push(['anniversary',input]);Object.assign(anniversary,input.data,{version:anniversary.version+1});return{count:1};},
    },
    auditLog:{create:async input=>{writes.push(['audit',input]);return input.data;}},
  };
  const prisma={...tx,$transaction:async callback=>callback(tx)};
  return{legacy,anniversary,writes,reads,service:new CalendarService(prisma,new AccessService(prisma))};
}
const archive=(f,input={expectedVersion:1},householdId='house-a')=>f.service.archiveLegacyAnniversary('user-a',householdId,'legacy-a',input);

test('Legacy anniversary response exposes a versioned archive capability without rewriting its original source identity',async()=>{
  const f=fixture();const result=await f.service.list('user-a','house-a',query);
  const row=result.data.find(item=>item.id==='legacy-a');assert.ok(row);
  assert.equal(row.legacy,true);assert.equal(row.canArchive,true);assert.equal(row.version,1);
  assert.equal(row.sourceId,null);assert.equal(row.sourceType,null);
  assert.equal(f.reads.find(row=>row[0]==='legacy-list')[1].where.archivedAt,null);
});

test('Legacy anniversary archive retains the row and source fields but removes it from the calendar',async()=>{
  const f=fixture();const original={...f.legacy};const result=await archive(f);
  assert.deepEqual(result,{data:{id:'legacy-a',archived:true}});assert.equal(f.legacy.version,2);assert.ok(f.legacy.archivedAt instanceof Date);
  for(const key of ['id','title','createdById','createdAt','startsAt','sourceType','sourceId'])assert.equal(f.legacy[key],original[key],key);
  assert.deepEqual(f.writes.map(row=>row[0]),['legacy','audit']);
  assert.deepEqual(f.writes[1][1].data.details,{fromVersion:1,toVersion:2,legacy:true});
  assert.equal((await f.service.list('user-a','house-a',query)).data.some(row=>row.id==='legacy-a'),false);
});

test('Legacy archive rejects stale versions and lost updates without an audit or successful mutation',async()=>{
  for(const options of [{legacy:{version:2}},{lostUpdate:true}]){
    const f=fixture(options);await assert.rejects(archive(f),error=>error.getStatus()===409);assert.equal(f.writes.length,0);assert.equal(f.legacy.archivedAt,null);
  }
});

test('Legacy archive is restricted to this household source-less anniversary row, not meal/trip projections',async()=>{
  for(const legacy of [{type:'MEAL'},{type:'TRIP'},{sourceType:'ANNIVERSARY',sourceId:'linked-anniversary'},{sourceType:'TRIP'},{sourceId:'some-source'},{householdId:'house-b'},{archivedAt:new Date()}]){
    const f=fixture({legacy});await assert.rejects(archive(f),error=>error.getStatus()===404,JSON.stringify(legacy));assert.equal(f.writes.length,0);
  }
});

test('Legacy archive requires current shared calendar EDIT permission and validates family before querying the resource',async()=>{
  for(const scenario of ['view','other-family','missing-family']){
    const f=fixture({viewOnly:scenario==='view'});await assert.rejects(archive(f,{expectedVersion:1},scenario==='missing-family'?'':scenario==='other-family'?'house-b':'house-a'),error=>error.getStatus()===(scenario==='missing-family'?400:403));
    assert.equal(f.writes.length,0);assert.equal(f.reads.length,0);
  }
  const f=fixture({viewOnly:true});const rows=(await f.service.list('user-a','house-a',query)).data;assert.equal(rows.find(row=>row.id==='legacy-a').canArchive,false);
});

test('Existing shared anniversary archive remains available to household editors and removes all yearly occurrences',async()=>{
  const f=fixture();await f.service.archiveAnniversary('user-a','house-a','anniversary-a',{expectedVersion:3});
  assert.equal(f.anniversary.version,4);assert.ok(f.anniversary.archivedAt instanceof Date);
  for(const year of [2025,2026,2027]){const result=await f.service.list('user-a','house-a',{from:`${year}-09-09T00:00:00+08:00`,to:`${year}-09-10T00:00:00+08:00`});assert.equal(result.data.some(row=>row.sourceId==='anniversary-a'),false);}
});

test('Archive DTO requires an integer positive version and whitelists input using the production pipe settings',async()=>{
  const pipe=new ValidationPipe({transform:true,whitelist:true});
  assert.equal((await pipe.transform({expectedVersion:1},{type:'body',metatype:ArchiveAnniversaryDto})).expectedVersion,1);
  const filtered=await pipe.transform({expectedVersion:1,sourceId:'another-row'},{type:'body',metatype:ArchiveAnniversaryDto});assert.equal(filtered.expectedVersion,1);assert.equal(filtered.sourceId,undefined);
  for(const input of [{},{expectedVersion:0},{expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:'1'}])await assert.rejects(pipe.transform(input,{type:'body',metatype:ArchiveAnniversaryDto}),error=>error.getStatus()===400);
});
