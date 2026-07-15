'use strict';

const crypto = require('node:crypto');
const { prisma } = require('./db');
const { hashPassword } = require('./auth');
const { rngFrom } = require('./prng');

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const CAPACITIES = [2, 4, 4, 6, 8, 10, 12];
const FLOORS = 10;
const SLOT_COUNT = 48; // 00:00 -> 24:00 in 30-min slots
const HOSTEL_HORIZON_DAYS = 60;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function buildRoomsFor(kind) {
  const prefix = kind === 'conference' ? 'c' : 'h';
  const buildingId = `b-${kind}`;
  const rooms = [];
  for (let floor = 1; floor <= FLOORS; floor++) {
    const label = pad2(floor);
    const rng = rngFrom(`${kind}:floor:${floor}`);
    const count = rng.int(6, 10);
    for (let idx = 0; idx < count; idx++) {
      const letter = LETTERS[idx];
      const rr = rngFrom(`${kind}:room:${floor}:${idx}`);
      rooms.push({
        id: `${prefix}-r-${floor}-${idx}`,
        buildingId,
        buildingKind: kind,
        floorNumber: floor,
        floorLabel: label,
        code: `${label}${letter}`,
        capacity: rr.pick(CAPACITIES),
        naturalLight: rr.chance(0.6),
        videoConf: rr.chance(0.5),
        whiteboard: rr.chance(0.7),
      });
    }
  }
  return rooms;
}

async function seed() {
  const existing = await prisma.building.count();
  if (existing > 0) return;

  const created = new Date();

  await prisma.$transaction(
    async (tx) => {
    const buildings = [
      { id: 'b-conference', kind: 'conference', name: 'Skyline Conference Center' },
      { id: 'b-hostel', kind: 'hostel', name: 'Skyline Residences' },
    ];

    await tx.building.createMany({
      data: buildings.map((b) => ({
        id: b.id,
        kind: b.kind,
        name: b.name,
        floorCount: FLOORS,
        createdAt: created,
      })),
    });

    const roomsByKind = {};
    for (const b of buildings) {
      const rooms = buildRoomsFor(b.kind);
      roomsByKind[b.kind] = rooms;
      await tx.room.createMany({
        data: rooms.map((r) => ({
          id: r.id,
          buildingId: r.buildingId,
          buildingKind: r.buildingKind,
          buildingName: b.name,
          floorNumber: r.floorNumber,
          floorLabel: r.floorLabel,
          code: r.code,
          capacity: r.capacity,
          naturalLight: r.naturalLight,
          videoConf: r.videoConf,
          whiteboard: r.whiteboard,
        })),
      });
    }

    const demoUsers = [
      { id: 'u-admin', username: 'admin', name: 'Ada Admin', role: 'admin' },
      { id: 'u-maya', username: 'maya', name: 'Maya Rivera', role: 'user' },
      { id: 'u-leo', username: 'leo', name: 'Leo Nakamura', role: 'user' },
      { id: 'u-priya', username: 'priya', name: 'Priya Sharma', role: 'user' },
    ];
    const pwHash = hashPassword('password');
    await tx.user.createMany({
      data: demoUsers.map((u) => ({
        id: u.id,
        username: u.username,
        passwordHash: pwHash,
        name: u.name,
        role: u.role,
        createdAt: created,
      })),
    });

    const topics = [
      'Sprint planning',
      'Design review',
      '1:1',
      'All-hands',
      'Client call',
      'Retro',
      'Interview',
      'Roadmap sync',
      null,
    ];
    const confRooms = roomsByKind.conference;
    const today = new Date();
    const brng = rngFrom('conference:bookings');
    const bookingRows = [];

    for (let dayOffset = -2; dayOffset <= 30; dayOffset++) {
      const date = ymd(addDays(today, dayOffset));
      const perDay = brng.int(4, 9);
      const takenPerRoom = new Map();
      for (let i = 0; i < perDay; i++) {
        const room = brng.pick(confRooms);
        const start = brng.int(0, SLOT_COUNT - 2);
        const len = brng.pick([1, 2, 2, 3, 4]);
        const end = Math.min(SLOT_COUNT, start + len);
        const ranges = takenPerRoom.get(room.id) || [];
        const overlaps = ranges.some((r) => start < r[1] && end > r[0]);
        if (overlaps) continue;
        ranges.push([start, end]);
        takenPerRoom.set(room.id, ranges);
        const user = brng.pick(demoUsers);
        bookingRows.push({
          id: `bk-${crypto.randomUUID()}`,
          roomId: room.id,
          buildingId: room.buildingId,
          roomCode: room.code,
          date,
          startSlot: start,
          endSlot: end,
          topic: brng.pick(topics),
          userId: user.id,
          userName: user.name,
          createdAt: created,
        });
      }
    }
    if (bookingRows.length) await tx.booking.createMany({ data: bookingRows });

    const guests = [
      'J. Okafor',
      'S. Bianchi',
      'K. Andersson',
      'R. Haddad',
      null,
      'T. Watanabe',
    ];
    const hostelRooms = roomsByKind.hostel;
    const srng = rngFrom('hostel:stays');
    const stayRows = [];

    for (const room of hostelRooms) {
      const takenRanges = [];
      const numStays = srng.int(1, 4);
      for (let i = 0; i < numStays; i++) {
        const checkInOffset = srng.int(0, HOSTEL_HORIZON_DAYS - 2);
        const nights = srng.pick([1, 1, 2, 2, 3, 4, 5]);
        const checkOutOffset = Math.min(
          HOSTEL_HORIZON_DAYS,
          checkInOffset + nights,
        );
        const overlaps = takenRanges.some(
          (r) => checkInOffset < r[1] && checkOutOffset > r[0],
        );
        if (overlaps) continue;
        takenRanges.push([checkInOffset, checkOutOffset]);
        const user = srng.pick(demoUsers);
        stayRows.push({
          id: `st-${crypto.randomUUID()}`,
          roomId: room.id,
          buildingId: room.buildingId,
          roomCode: room.code,
          checkIn: ymd(addDays(today, checkInOffset)),
          checkOut: ymd(addDays(today, checkOutOffset)),
          guest: srng.pick(guests),
          userId: user.id,
          userName: user.name,
          createdAt: created,
        });
      }
    }
    if (stayRows.length) await tx.stay.createMany({ data: stayRows });
    },
    { timeout: 120_000 },
  );

  console.log('[seed] StayBook demo data created.');
}

module.exports = { seed, HOSTEL_HORIZON_DAYS, SLOT_COUNT };
