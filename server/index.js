'use strict';

const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');

const { prisma } = require('./db');
const { seed } = require('./seed');
const {
  hashPassword,
  verifyPassword,
  signToken,
  attachUser,
  requireAuth,
} = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());
app.use(attachUser);

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ---------- mappers ----------
function mapRoom(row) {
  return {
    id: row.id,
    code: row.code,
    floor: row.floorNumber,
    capacity: row.capacity,
    amenities: {
      naturalLight: row.naturalLight,
      videoConf: row.videoConf,
      whiteboard: row.whiteboard,
    },
  };
}

async function floorsFor(kind) {
  const building = await prisma.building.findFirst({ where: { kind } });
  if (!building) return [];
  const rooms = await prisma.room.findMany({
    where: { buildingId: building.id },
    orderBy: [{ floorNumber: 'asc' }, { code: 'asc' }],
  });
  const byFloor = new Map();
  for (const r of rooms) {
    if (!byFloor.has(r.floorNumber)) {
      byFloor.set(r.floorNumber, {
        number: r.floorNumber,
        label: r.floorLabel,
        rooms: [],
      });
    }
    byFloor.get(r.floorNumber).rooms.push(mapRoom(r));
  }
  const floors = [];
  for (let n = 1; n <= building.floorCount; n++) {
    floors.push(
      byFloor.get(n) || {
        number: n,
        label: String(n).padStart(2, '0'),
        rooms: [],
      },
    );
  }
  return floors;
}

function mapBooking(row) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomCode: row.roomCode,
    date: row.date,
    startSlot: row.startSlot,
    endSlot: row.endSlot,
    topic: row.topic || undefined,
    userId: row.userId,
    userName: row.userName,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapStay(row) {
  return {
    id: row.id,
    roomId: row.roomId,
    roomCode: row.roomCode,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    guest: row.guest || undefined,
    userId: row.userId,
    userName: row.userName,
    createdAt: row.createdAt.toISOString(),
  };
}

function publicUser(row) {
  return { id: row.id, username: row.username, name: row.name, role: row.role };
}

// ---------- auth ----------
app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const { username, password, name } = req.body || {};
    if (!username || String(username).trim().length < 3) {
      return res
        .status(400)
        .json({ error: 'Username must be at least 3 characters.' });
    }
    if (!password || String(password).length < 4) {
      return res
        .status(400)
        .json({ error: 'Password must be at least 4 characters.' });
    }
    const uname = String(username).trim();
    const existing = await prisma.user.findUnique({ where: { username: uname } });
    if (existing) return res.status(409).json({ error: 'That username is taken.' });

    const user = {
      id: `u-${crypto.randomUUID()}`,
      username: uname,
      name: (name && String(name).trim()) || uname,
      role: 'user',
    };
    await prisma.user.create({
      data: {
        id: user.id,
        username: user.username,
        passwordHash: hashPassword(password),
        name: user.name,
        role: user.role,
        createdAt: new Date(),
      },
    });

    res.status(201).json({ token: signToken(user), user });
  }),
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    const row = await prisma.user.findUnique({
      where: { username: String(username || '').trim() },
    });
    if (!row || !verifyPassword(String(password || ''), row.passwordHash)) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }
    const user = publicUser(row);
    res.json({ token: signToken(user), user });
  }),
);

app.get(
  '/api/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!row) return res.status(401).json({ error: 'Session expired.' });
    res.json({ user: publicUser(row) });
  }),
);

// ---------- floors ----------
app.get(
  '/api/conference/floors',
  asyncHandler(async (_req, res) => res.json(await floorsFor('conference'))),
);
app.get(
  '/api/hostel/floors',
  asyncHandler(async (_req, res) => res.json(await floorsFor('hostel'))),
);

// ---------- conference bookings ----------
app.get(
  '/api/bookings',
  asyncHandler(async (req, res) => {
    const { date } = req.query;
    const rows = await prisma.booking.findMany({
      where: date ? { date: String(date) } : undefined,
      orderBy: date
        ? { startSlot: 'asc' }
        : [{ date: 'asc' }, { startSlot: 'asc' }],
    });
    res.json(rows.map(mapBooking));
  }),
);

app.get(
  '/api/bookings/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await prisma.booking.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapBooking));
  }),
);

app.post(
  '/api/bookings',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { roomId, date, startSlot, endSlot, topic } = req.body || {};
    const start = Number(startSlot);
    const end = Number(endSlot);
    if (
      !roomId ||
      !date ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      end <= start
    ) {
      return res.status(400).json({ error: 'Invalid booking request.' });
    }
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    const clash = await prisma.booking.findFirst({
      where: {
        roomId,
        date,
        startSlot: { lt: end },
        endSlot: { gt: start },
      },
      select: { id: true },
    });
    if (clash) return res.status(409).json({ error: 'That time was just taken.' });

    const booking = await prisma.booking.create({
      data: {
        id: `bk-${crypto.randomUUID()}`,
        roomId: room.id,
        buildingId: room.buildingId,
        roomCode: room.code,
        date,
        startSlot: start,
        endSlot: end,
        topic: (topic && String(topic).trim()) || null,
        userId: req.user.id,
        userName: req.user.name,
        createdAt: new Date(),
      },
    });
    res.status(201).json(mapBooking(booking));
  }),
);

app.delete(
  '/api/bookings/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Booking not found.' });
    if (row.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your booking.' });
    }
    await prisma.booking.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

// ---------- hostel stays ----------
app.get(
  '/api/stays',
  asyncHandler(async (_req, res) => {
    const rows = await prisma.stay.findMany({ orderBy: { checkIn: 'asc' } });
    res.json(rows.map(mapStay));
  }),
);

app.get(
  '/api/stays/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await prisma.stay.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json(rows.map(mapStay));
  }),
);

app.post(
  '/api/stays',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { roomId, checkIn, checkOut, guest } = req.body || {};
    if (!roomId || !checkIn || !checkOut || checkOut <= checkIn) {
      return res.status(400).json({ error: 'Invalid stay request.' });
    }
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return res.status(404).json({ error: 'Room not found.' });

    const clash = await prisma.stay.findFirst({
      where: {
        roomId,
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
      },
      select: { id: true },
    });
    if (clash) return res.status(409).json({ error: 'Those nights were just taken.' });

    const stay = await prisma.stay.create({
      data: {
        id: `st-${crypto.randomUUID()}`,
        roomId: room.id,
        buildingId: room.buildingId,
        roomCode: room.code,
        checkIn,
        checkOut,
        guest: (guest && String(guest).trim()) || null,
        userId: req.user.id,
        userName: req.user.name,
        createdAt: new Date(),
      },
    });
    res.status(201).json(mapStay(stay));
  }),
);

app.delete(
  '/api/stays/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await prisma.stay.findUnique({ where: { id: req.params.id } });
    if (!row) return res.status(404).json({ error: 'Stay not found.' });
    if (row.userId !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your stay.' });
    }
    await prisma.stay.delete({ where: { id: req.params.id } });
    res.status(204).end();
  }),
);

app.use((err, _req, res, _next) => {
  console.error('[staybook]', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ---------- boot ----------
async function boot() {
  await seed();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`[staybook] API listening on http://localhost:${PORT}`);
  });
}

boot().catch((err) => {
  console.error('[staybook] Failed to start:', err);
  process.exit(1);
});
