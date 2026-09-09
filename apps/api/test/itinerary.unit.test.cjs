require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BadRequestException } = require('@nestjs/common');
const { ItineraryService } = require('../dist/trips/itinerary.service');

test('Accommodation dates reject nonexistent days instead of normalizing them into another month', () => {
  const service = new ItineraryService({}, {});
  for (const day of ['2026-02-29', '2028-02-30', '1900-02-29', '2100-02-29', '2026-04-31', '2026-06-31', '2026-00-01', '2026-13-01', '2026-09-00', '2026-09-32', '2026-9-01', '2026-09-01T00:00:00Z', '', ' ']) {
    assert.throws(() => service.accommodationDates(day, '2200-01-01'), BadRequestException, `check-in: ${day}`);
    assert.throws(() => service.accommodationDates('1800-01-01', day), BadRequestException, `check-out: ${day}`);
  }
});

test('Accommodation calendar dates preserve leap days, month and year boundaries exactly', () => {
  const service = new ItineraryService({}, {});
  for (const [start, end] of [['2028-02-29', '2028-03-01'], ['2000-02-29', '2000-03-01'], ['2026-04-30', '2026-05-01'], ['2026-12-31', '2027-01-01']]) {
    const result = service.accommodationDates(start, end);
    assert.equal(result.checkInDate.toISOString(), `${start}T00:00:00.000Z`);
    assert.equal(result.checkOutDate.toISOString(), `${end}T00:00:00.000Z`);
  }
  for (const pair of [['2026-09-01', '2026-09-01'], ['2026-09-02', '2026-09-01']]) assert.throws(() => service.accommodationDates(...pair), BadRequestException);
});

function fixture() {
  const writes = [], isolation = [];
  const accommodation = { id: 'stay-a', tripId: 'trip-a', version: 2, stopId: null, name: '虚构住宿', checkInDate: new Date('2028-02-29T00:00:00.000Z'), checkOutDate: new Date('2028-03-01T00:00:00.000Z') };
  const tx = {
    tripMember: { findFirst: async () => ({ status: 'ACTIVE', canEdit: true, trip: { id: 'trip-a', version: 4, status: 'PENDING' } }) },
    trip: { updateMany: async input => { writes.push(['trip', input]); return { count: 1 }; } },
    accommodation: {
      findFirst: async () => accommodation, findUniqueOrThrow: async () => accommodation,
      create: async input => { writes.push(['create', input]); return { ...accommodation, ...input.data }; },
      updateMany: async input => { writes.push(['update', input]); return { count: 1 }; },
    },
    auditLog: { create: async input => { writes.push(['audit', input]); return {}; } },
  };
  const db = { $transaction: async (callback, options) => { isolation.push(options.isolationLevel); return callback(tx); } };
  const access = { require: async (user, household, module, level, client) => {
    assert.equal(user, 'user-a'); assert.equal(household, 'house-a'); assert.equal(module, 'trips'); assert.equal(level, 'EDIT'); assert.equal(client, tx); return { id: 'member-a' };
  } };
  return { service: new ItineraryService(db, access), writes, isolation };
}

test('Invalid accommodation creation reaches no record, version or audit writes', async () => {
  const f = fixture();
  await assert.rejects(f.service.createAccommodation('user-a', 'house-a', 'trip-a', { expectedTripVersion: 4, name: '错误日期', checkInDate: '2026-02-29', checkOutDate: '2026-03-03' }), BadRequestException);
  assert.deepEqual(f.writes, []); assert.deepEqual(f.isolation, ['Serializable']);
});

test('Invalid accommodation updates reach no record, version or audit writes', async () => {
  for (const patch of [{ checkInDate: '2028-02-30' }, { checkOutDate: '2028-02-30' }, { checkOutDate: '2028-02-29' }]) {
    const f = fixture();
    await assert.rejects(f.service.updateAccommodation('user-a', 'house-a', 'trip-a', 'stay-a', { expectedTripVersion: 4, expectedVersion: 2, ...patch }), BadRequestException);
    assert.deepEqual(f.writes, []); assert.deepEqual(f.isolation, ['Serializable']);
  }
});

test('A valid partial edit preserves date-only values, clears optional text and advances versions once', async () => {
  const f = fixture();
  const result = await f.service.updateAccommodation('user-a', 'house-a', 'trip-a', 'stay-a', { expectedTripVersion: 4, expectedVersion: 2, name: '新住宿名称', address: '', contact: '', reservationNote: '' });
  const update = f.writes.find(row => row[0] === 'update')[1];
  assert.equal(update.data.checkInDate.toISOString(), '2028-02-29T00:00:00.000Z'); assert.equal(update.data.checkOutDate.toISOString(), '2028-03-01T00:00:00.000Z');
  assert.equal(update.data.name, '新住宿名称'); assert.equal(update.data.address, null); assert.equal(update.data.contact, null); assert.equal(update.data.reservationNote, null);
  assert.equal(update.where.version, 2); assert.equal(update.data.version.increment, 1); assert.equal(result.data.tripVersion, 5);
  assert.deepEqual(f.writes.map(row => row[0]), ['update', 'trip', 'audit']);
});
