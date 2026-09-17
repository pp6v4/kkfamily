require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ValidationPipe, ForbiddenException } = require('@nestjs/common');
const { CreateTripDto } = require('../dist/trips/dto/create-trip.dto');
const { TripsService } = require('../dist/trips/trips.service');
const base = { title: ' 周末旅行 ', startsAt: '2026-10-01T08:00:00+08:00' };
const point = { title: ' 营地 ', latitude: 39.123456, longitude: 116.234567 };
const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const validate = input => pipe.transform(input, { type: 'body', metatype: CreateTripDto });

test('Initial destination accepts exact coordinates including zero and rejects malformed nested input', async () => {
  assert.equal((await validate(base)).initialDestination, undefined);
  for (const coordinates of [point, { title: '赤道', latitude: 0, longitude: 0 }]) {
    const dto = await validate({ ...base, initialDestination: coordinates });
    assert.equal(dto.initialDestination.latitude, coordinates.latitude);
    assert.equal(dto.initialDestination.longitude, coordinates.longitude);
    assert.equal(dto.initialDestination.title, coordinates.title.trim());
  }
  for (const invalid of [null, 'place', [], {}, { ...point, latitude: '39' }, { ...point, longitude: 181 },
    { ...point, latitude: -91 }, { ...point, latitude: NaN }, { ...point, title: ' ' }, { ...point, tripId: 'other-trip' }]) {
    await assert.rejects(validate({ ...base, initialDestination: invalid }), error => error.getStatus() === 400);
  }
});

function fixture({ denied = false, calendarFailure = false } = {}) {
  const calls = [];
  const tx = {
    trip: { create: async input => { calls.push(['trip', input]); return { id: 'trip-a', title: input.data.title }; } },
    calendarEvent: { create: async input => { calls.push(['calendar', input]); if (calendarFailure) throw new Error('calendar failed'); } },
  };
  const prisma = { $transaction: async (callback, options) => { assert.equal(options.isolationLevel, 'Serializable'); return callback(tx); } };
  const access = { require: async (...args) => {
    assert.deepEqual(args.slice(0, 4), ['user-a', 'house-a', 'trips', 'EDIT']); assert.equal(args[4], tx);
    if (denied) throw new ForbiddenException(); return { id: 'member-a' };
  } };
  return { calls, service: new TripsService(prisma, access) };
}

test('Trip, initial destination and calendar use one authorized transaction; no implicit arrival date', async () => {
  const f = fixture(); await f.service.create('user-a', 'house-a', await validate({ ...base, initialDestination: point }));
  const data = f.calls[0][1].data;
  assert.equal(data.destination, '营地'); assert.equal(data.members.create.membershipId, 'member-a');
  assert.deepEqual(data.stops.create, { title: '营地', latitude: point.latitude, longitude: point.longitude, coordSystem: 'GCJ02', stopType: 'CAMPSITE', sortOrder: 0 });
  assert.equal(f.calls[1][1].data.sourceId, 'trip-a'); assert.equal(f.calls[1][1].data.householdId, 'house-a');
  const legacy = fixture(); await legacy.service.create('user-a', 'house-a', await validate(base));
  assert.equal(legacy.calls[0][1].data.stops, undefined);
});

test('Creation propagates calendar failure and revoked permission prevents all writes', async () => {
  const f = fixture({ calendarFailure: true });
  await assert.rejects(f.service.create('user-a', 'house-a', base), /calendar failed/);
  const denied = fixture({ denied: true });
  await assert.rejects(denied.service.create('user-a', 'house-a', base), error => error.getStatus() === 403);
  assert.equal(denied.calls.length, 0);
});
