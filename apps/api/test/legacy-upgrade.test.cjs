const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const { assertIsolatedDatabase } = require('./run-isolated.cjs');

test('Legacy three-migration data upgrades without losing dates, votes, quantities or membership', async t => {
  assertIsolatedDatabase(process.env.DATABASE_URL);
  assert.equal(process.env.NODE_ENV, 'test');
  const source = new URL(process.env.DATABASE_URL);
  // Create a second database only inside the already validated ephemeral server.
  const legacy = new URL(source); legacy.pathname = '/verify_legacy';
  const admin = new PrismaClient();
  await admin.$executeRawUnsafe('CREATE DATABASE "verify_legacy"');
  await admin.$disconnect();
  const env = { ...process.env, DATABASE_URL: legacy.toString() };
  function cli(...args) {
    const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), ...args], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  for (const name of ['202608270001_initial','202608280001_calendar_events','202608280002_packing_templates']) {
    cli('db','execute','--file',`prisma/migrations/${name}/migration.sql`,'--schema','prisma/schema.prisma');
    cli('migrate','resolve','--applied',name);
  }
  cli('db','execute','--file','test/legacy-upgrade-fixture.sql','--schema','prisma/schema.prisma');
  cli('migrate','deploy');
  cli('migrate','diff','--from-schema-datasource','prisma/schema.prisma','--to-schema-datamodel','prisma/schema.prisma','--exit-code');
  const db = new PrismaClient({ datasources: { db: { url: legacy.toString() } } });
  try {
    await t.test('UTC-stored timestamps preserve Shanghai dates, including midnight and leap day', async () => {
      const rows = await db.anniversary.findMany({ orderBy: { id:'asc' } });
      assert.deepEqual(rows.map(row=>[row.id,row.localDate,row.createdById,row.recurrence]),[
        ['legacy_legacy-event-leap','2024-02-29','legacy-member-a','ONCE'],
        ['legacy_legacy-event-night','2026-09-02','legacy-member-a','ONCE'],
      ]);
      assert.equal(await db.calendarEvent.count(),0);
    });
    await t.test('Meal date and type normalize while both votes produce one dish', async () => {
      const meal=await db.meal.findUniqueOrThrow({where:{id:'legacy-meal'}});
      assert.equal(meal.localDate,'2026-09-02'); assert.equal(meal.mealType,'BREAKFAST');
      assert.equal(await db.mealItem.count(),2); assert.equal(await db.mealDish.count(),1);
      assert.equal((await db.mealDish.findFirstOrThrow()).cookMultiplier.toString(),'1');
    });
    await t.test('Food amounts remain unchanged and seasoning linkage is created', async () => {
      const stock=await db.inventoryItem.findUniqueOrThrow({where:{id:'legacy-stock'}});
      assert.equal(stock.quantity.toString(),'150'); assert.equal(stock.availability,'PRESENT');
      assert.equal((await db.recipeIngredient.findFirstOrThrow()).quantity.toString(),'200');
      const salt=await db.recipeSeasoning.findUniqueOrThrow({where:{id:'legacy-salt'},include:{ingredient:true}});
      assert.equal(salt.ingredient.name,'盐'); assert.equal(salt.ingredient.kind,'SEASONING');
    });
    await t.test('One deterministic trip owner is assigned without losing members', async () => {
      const members=await db.tripMember.findMany({orderBy:{membershipId:'asc'}});
      assert.deepEqual(members.map(row=>[row.membershipId,row.tripRole,row.canEdit]),[
        ['legacy-member-a','OWNER',true],['legacy-member-b','MEMBER',false],
      ]);
    });
    await t.test('Accounts and shopping records survive; repeated migrate deploy is a no-op', async () => {
      assert.equal(await db.user.count(),2); assert.equal(await db.membership.count(),2);
      assert.equal((await db.shoppingList.findUniqueOrThrow({where:{id:'legacy-list'}})).systemKey,'NEXT_TRIP');
      assert.equal((await db.shoppingItem.findUniqueOrThrow({where:{id:'legacy-shopping'}})).quantity.toString(),'2');
      cli('migrate','deploy');
      assert.equal(await db.anniversary.count(),2); assert.equal(await db.mealDish.count(),1);
    });
  } finally { await db.$disconnect(); }
});
