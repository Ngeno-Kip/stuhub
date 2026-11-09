const crypto = require('crypto');
const { promisify } = require('util');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');

const scrypt = promisify(crypto.scrypt);
const PASSWORD_KEY_LENGTH = 64;
const LEGACY_PASSWORD_ROUNDS = 10000;
const requiredDatabaseSettings = ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'];
const missingDatabaseSettings = requiredDatabaseSettings.filter((setting) => !process.env[setting]);
if (missingDatabaseSettings.length) {
  throw new Error(`Missing database settings in server/.env: ${missingDatabaseSettings.join(', ')}.`);
}

const databasePort = Number(process.env.MYSQL_PORT);
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
  throw new Error('MYSQL_PORT in server/.env must be a valid port number.');
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: databasePort,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4',
});

function jwtSecret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured in server/.env.');
  return process.env.JWT_SECRET;
}

async function createEventBookingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_bookings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      eventId BIGINT UNSIGNED NOT NULL,
      userId VARCHAR(36) NOT NULL,
      status VARCHAR(32) NOT NULL,
      paymentReference VARCHAR(120) NULL,
      reservedAt DATETIME(3) NOT NULL,
      paymentDeadline DATETIME(3) NULL,
      paymentSubmittedAt DATETIME(3) NULL,
      paidAt DATETIME(3) NULL,
      INDEX event_bookings_eventId_status_deadline_idx (eventId, status, paymentDeadline),
      INDEX event_bookings_userId_reservedAt_idx (userId, reservedAt),
      CONSTRAINT event_bookings_eventId_fk FOREIGN KEY (eventId) REFERENCES events (id),
      CONSTRAINT event_bookings_userId_fk FOREIGN KEY (userId) REFERENCES users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(24) NOT NULL DEFAULT 'client',
      createdAt DATETIME(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticketNumber VARCHAR(32) NULL UNIQUE,
      subject VARCHAR(120) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'open',
      priority VARCHAR(20) NOT NULL DEFAULT 'medium',
      clientId VARCHAR(36) NOT NULL,
      createdBy VARCHAR(36) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      updatedAt DATETIME(3) NOT NULL,
      INDEX tickets_clientId_idx (clientId),
      CONSTRAINT tickets_clientId_fk FOREIGN KEY (clientId) REFERENCES users (id),
      CONSTRAINT tickets_createdBy_fk FOREIGN KEY (createdBy) REFERENCES users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      ticketNumber VARCHAR(32) NOT NULL,
      senderId VARCHAR(36) NOT NULL,
      message TEXT NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      INDEX messages_ticketNumber_createdAt_idx (ticketNumber, createdAt),
      CONSTRAINT messages_ticketNumber_fk FOREIGN KEY (ticketNumber) REFERENCES tickets (ticketNumber),
      CONSTRAINT messages_senderId_fk FOREIGN KEY (senderId) REFERENCES users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      description TEXT NOT NULL,
      location VARCHAR(200) NOT NULL,
      startsAt DATETIME(3) NOT NULL,
      capacity INT UNSIGNED NOT NULL,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      currency CHAR(3) NOT NULL DEFAULT 'KES',
      paymentInstructions TEXT NULL,
      imageUrl VARCHAR(255) NULL,
      createdBy VARCHAR(36) NOT NULL,
      createdAt DATETIME(3) NOT NULL,
      INDEX events_startsAt_idx (startsAt),
      CONSTRAINT events_createdBy_fk FOREIGN KEY (createdBy) REFERENCES users (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [eventColumns] = await pool.query('SHOW COLUMNS FROM events');
  const existingEventColumns = new Set(eventColumns.map((column) => column.Field));
  if (!existingEventColumns.has('imageUrl')) {
    await pool.query('ALTER TABLE events ADD COLUMN imageUrl VARCHAR(255) NULL');
  }
  await createEventBookingsTable();
  const [bookingColumns] = await pool.query('SHOW COLUMNS FROM event_bookings');
  const existingBookingColumns = new Set(bookingColumns.map((column) => column.Field));
  const requiredBookingColumns = [
    'id',
    'eventId',
    'userId',
    'status',
    'paymentReference',
    'reservedAt',
    'paymentDeadline',
    'paymentSubmittedAt',
    'paidAt',
  ];
  if (!requiredBookingColumns.every((column) => existingBookingColumns.has(column))) {
    const [[{ rowCount }]] = await pool.query('SELECT COUNT(*) AS rowCount FROM event_bookings');
    if (Number(rowCount) !== 0) {
      throw new Error('The event_bookings table has an incompatible schema and contains data; migrate it before starting StuHub.');
    }
    await pool.query('DROP TABLE event_bookings');
    await createEventBookingsTable();
  }
  const [userColumns] = await pool.query('SHOW COLUMNS FROM users');
  const existingUserColumns = new Set(userColumns.map((column) => column.Field));
  const approvalColumns = [
    ['approvalStatus', "VARCHAR(20) NOT NULL DEFAULT 'approved'"],
    ['approvedAt', 'DATETIME(3) NULL'],
    ['approvedBy', 'VARCHAR(36) NULL'],
  ];
  for (const [column, definition] of approvalColumns) {
    if (!existingUserColumns.has(column)) {
      await pool.query(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function checkDatabase() {
  await pool.query('SELECT 1');
}

async function closeDatabase() {
  await pool.end();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString('base64url')}`;
}

function verifyLegacyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 3 || !parts[1] || !parts[2]) return false;
  const secret = Buffer.from(jwtSecret());
  let digest = crypto.createHmac('sha256', secret).update(`${parts[1]}:${password}`).digest();
  for (let round = 1; round < LEGACY_PASSWORD_ROUNDS; round += 1) {
    digest = crypto.createHmac('sha256', secret).update(digest).digest();
  }
  const expected = Buffer.from(parts[2], 'base64url');
  return digest.length === expected.length && crypto.timingSafeEqual(digest, expected);
}

async function verifyPassword(password, stored) {
  if (stored.startsWith('scrypt$')) {
    const [, salt, encodedHash] = stored.split('$');
    if (!salt || !encodedHash) return false;
    const expected = Buffer.from(encodedHash, 'base64url');
    const actual = await scrypt(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  }
  if (stored.startsWith('hmac-sha256$')) return verifyLegacyPassword(password, stored);
  return stored === password;
}

function publicUser(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    role: user.role,
    approvalStatus: user.approvalStatus || 'approved',
  };
}

function createToken(userId) {
  return jwt.sign({ id: String(userId) }, jwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES || '7d',
  });
}

async function registerUser({ name, email, password }) {
  const id = crypto.randomUUID();
  try {
    await pool.execute(
      `INSERT INTO users
        (id, name, email, password, role, createdAt, approvalStatus)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, name, email, await hashPassword(password), 'client', new Date()],
    );
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return { status: 409, message: 'Email already registered.' };
    throw error;
  }
  return {
    status: 201,
    message: 'Account created. Your access request is waiting for admin approval.',
    user: { id, name, email, role: 'client', approvalStatus: 'pending' },
  };
}

async function loginUser({ email, password }) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, password, role, approvalStatus
     FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(password, user.password))) {
    return { status: 401, message: 'Invalid credentials.' };
  }
  if (user.approvalStatus === 'pending') {
    return {
      status: 403,
      message: 'Your account is awaiting admin approval. Please check back after your request is reviewed.',
    };
  }
  if (user.approvalStatus === 'rejected') {
    return {
      status: 403,
      message: 'Your account request was not approved. Please contact StuHub support.',
    };
  }
  if (!user.password.startsWith('scrypt$')) {
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [
      await hashPassword(password),
      user.id,
    ]);
  }
  return { status: 200, token: createToken(user.id), user: publicUser(user) };
}

async function getUserById(id) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, role, approvalStatus
     FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function seedAdmin({ name, email, password }) {
  const [rows] = await pool.execute('SELECT id, role FROM users WHERE email = ? LIMIT 1', [email]);
  if (rows[0]) {
    if (rows[0].role !== 'admin') {
      throw new Error('That email belongs to a client account; use a different admin email.');
    }
    return `Admin account already exists: ${email}`;
  }

  await pool.execute(
    `INSERT INTO users
      (id, name, email, password, role, createdAt, approvalStatus, approvedAt)
     VALUES (?, ?, ?, ?, ?, ?, 'approved', UTC_TIMESTAMP(3))`,
    [crypto.randomUUID(), name, email, await hashPassword(password), 'admin', new Date()],
  );
  return `Admin account ready: ${email}`;
}

async function getTickets(user) {
  const [rows] = user.role === 'admin'
    ? await pool.query(`
      SELECT t.ticketNumber, t.subject, t.description, t.status, t.priority,
        t.clientId, t.createdBy, t.createdAt, t.updatedAt,
        client.name AS clientName, client.email AS clientEmail
      FROM tickets t
      JOIN users client ON client.id = t.clientId
      ORDER BY t.updatedAt DESC, t.id DESC
    `)
    : await pool.execute(`
      SELECT ticketNumber, subject, description, status, priority, clientId, createdBy, createdAt, updatedAt
      FROM tickets
      WHERE clientId = ?
      ORDER BY updatedAt DESC, id DESC
    `, [user.id]);
  return rows;
}

async function createTicket(user, { subject, description, priority, clientId }) {
  const [clients] = await pool.execute(
    'SELECT id FROM users WHERE id = ? AND role = ? LIMIT 1',
    [clientId, 'client'],
  );
  if (!clients.length) return { status: 404, message: 'Client not found.' };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const now = new Date();
    const [result] = await connection.execute(
      `INSERT INTO tickets
        (subject, description, status, priority, clientId, createdBy, createdAt, updatedAt)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?)`,
      [subject, description, priority, clientId, user.id, now, now],
    );
    const ticketNumber = `STU-${String(result.insertId).padStart(4, '0')}`;
    await connection.execute('UPDATE tickets SET ticketNumber = ? WHERE id = ?', [
      ticketNumber,
      result.insertId,
    ]);
    await connection.commit();
    return { status: 201, message: 'Ticket created.', ticketNumber };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getTicketDetails(user, ticketNumber) {
  const [tickets] = await pool.execute(
    `SELECT t.ticketNumber, t.subject, t.description, t.status, t.priority,
       t.clientId, t.createdBy, t.createdAt, t.updatedAt,
       client.name AS clientName, client.email AS clientEmail
     FROM tickets t
     JOIN users client ON client.id = t.clientId
     WHERE t.ticketNumber = ? LIMIT 1`,
    [ticketNumber],
  );
  const ticket = tickets[0];
  if (!ticket) return { status: 404, message: 'Ticket not found.' };
  if (user.role !== 'admin' && String(ticket.clientId) !== String(user.id)) {
    return { status: 403, message: 'Unauthorized.' };
  }
  const [messages] = await pool.execute(
    `SELECT id, ticketNumber, senderId, message, createdAt
     FROM messages WHERE ticketNumber = ? ORDER BY createdAt, id`,
    [ticketNumber],
  );
  return { status: 200, ticket, messages };
}

async function addMessage(user, ticketNumber, message) {
  const [tickets] = await pool.execute(
    'SELECT clientId FROM tickets WHERE ticketNumber = ? LIMIT 1',
    [ticketNumber],
  );
  if (!tickets.length) return { status: 404, message: 'Ticket not found.' };
  if (user.role !== 'admin' && String(tickets[0].clientId) !== String(user.id)) {
    return { status: 403, message: 'Unauthorized.' };
  }
  await pool.execute(
    'INSERT INTO messages (id, ticketNumber, senderId, message, createdAt) VALUES (?, ?, ?, ?, ?)',
    [crypto.randomUUID(), ticketNumber, user.id, message, new Date()],
  );
  await pool.execute('UPDATE tickets SET updatedAt = ? WHERE ticketNumber = ?', [
    new Date(),
    ticketNumber,
  ]);
  return { status: 201, message: 'Message added.' };
}

async function updateTicketStatus(ticketNumber, status) {
  const [result] = await pool.execute(
    'UPDATE tickets SET status = ?, updatedAt = ? WHERE ticketNumber = ?',
    [status, new Date(), ticketNumber],
  );
  if (!result.affectedRows) return { status: 404, message: 'Ticket not found.' };
  return { status: 200, message: 'Status updated.' };
}

async function getClients() {
  const [rows] = await pool.query(
    `SELECT id, name, email FROM users
     WHERE role = 'client' AND approvalStatus = 'approved'
     ORDER BY name, email`,
  );
  return rows.map((client) => ({ ...client, id: String(client.id) }));
}

async function getPendingAccounts() {
  const [rows] = await pool.query(`
    SELECT id, name, email, createdAt
    FROM users
    WHERE role = 'client' AND approvalStatus = 'pending'
    ORDER BY createdAt, id
  `);
  return rows.map((user) => ({ ...user, id: String(user.id) }));
}

async function reviewAccount(adminId, accountId, approvalStatus) {
  const [result] = await pool.execute(`
    UPDATE users
    SET approvalStatus = ?, approvedAt = ?, approvedBy = ?
    WHERE id = ? AND role = 'client' AND approvalStatus = 'pending'
  `, [
    approvalStatus,
    approvalStatus === 'approved' ? new Date() : null,
    adminId,
    accountId,
  ]);
  if (result.affectedRows) {
    return {
      status: 200,
      message: approvalStatus === 'approved' ? 'Account approved.' : 'Account request rejected.',
    };
  }

  const [rows] = await pool.execute(
    'SELECT id, approvalStatus FROM users WHERE id = ? AND role = ? LIMIT 1',
    [accountId, 'client'],
  );
  if (!rows.length) return { status: 404, message: 'Account request not found.' };
  return { status: 409, message: 'This account request has already been reviewed.' };
}

async function expireEventBookings() {
  const [result] = await pool.query(`
    UPDATE event_bookings
    SET status = 'expired'
    WHERE status = 'awaiting_payment'
      AND paymentDeadline <= UTC_TIMESTAMP(3)
  `);
  return result.affectedRows;
}

async function getEvents() {
  await expireEventBookings();
  const [rows] = await pool.query(`
    SELECT
      e.id, e.title, e.description, e.location, e.startsAt, e.capacity,
      e.price, e.currency, e.createdAt, e.imageUrl,
      GREATEST(
        e.capacity - COALESCE(SUM(
          CASE
            WHEN b.status = 'paid'
              OR (b.status = 'awaiting_payment' AND b.paymentDeadline > UTC_TIMESTAMP(3))
              OR b.status = 'payment_submitted'
            THEN 1 ELSE 0
          END
        ), 0),
        0
      ) AS spotsRemaining
    FROM events e
    LEFT JOIN event_bookings b ON b.eventId = e.id
    WHERE e.startsAt > UTC_TIMESTAMP(3)
    GROUP BY e.id
    ORDER BY e.startsAt, e.id
  `);
  return rows;
}

async function createEvent(user, input) {
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
    return { status: 400, message: 'Choose a future event date and time.' };
  }
  const [result] = await pool.execute(`
    INSERT INTO events
      (title, description, location, startsAt, capacity, price, currency, paymentInstructions, imageUrl, createdBy, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))
  `, [
    input.title,
    input.description,
    input.location,
    startsAt,
    input.capacity,
    input.price,
    input.currency,
    input.paymentInstructions || null,
    input.imageUrl || null,
    user.id,
  ]);
  return { status: 201, message: 'Event created.', eventId: String(result.insertId) };
}

async function createEventBooking(user, eventId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [events] = await connection.execute(
      'SELECT id, startsAt, capacity, price FROM events WHERE id = ? FOR UPDATE',
      [eventId],
    );
    const event = events[0];
    if (!event) {
      await connection.rollback();
      return { status: 404, message: 'Event not found.' };
    }
    if (new Date(event.startsAt) <= new Date()) {
      await connection.rollback();
      return { status: 409, message: 'This event has already started.' };
    }

    await connection.execute(`
      UPDATE event_bookings
      SET status = 'expired'
      WHERE eventId = ?
        AND status = 'awaiting_payment'
        AND paymentDeadline <= UTC_TIMESTAMP(3)
    `, [eventId]);
    const [counts] = await connection.execute(`
      SELECT COUNT(*) AS booked
      FROM event_bookings
      WHERE eventId = ?
        AND (
          status IN ('paid', 'payment_submitted')
          OR (status = 'awaiting_payment' AND paymentDeadline > UTC_TIMESTAMP(3))
        )
    `, [eventId]);
    if (Number(counts[0].booked) >= Number(event.capacity)) {
      await connection.rollback();
      return { status: 409, message: 'Sorry, this event is fully booked.' };
    }

    const freeEvent = Number(event.price) === 0;
    const [result] = await connection.execute(`
      INSERT INTO event_bookings
        (eventId, userId, status, reservedAt, paymentDeadline, paidAt)
      VALUES (
        ?, ?, ?, UTC_TIMESTAMP(3),
        IF(? = 1, NULL, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE)),
        IF(? = 1, UTC_TIMESTAMP(3), NULL)
      )
    `, [eventId, user.id, freeEvent ? 'paid' : 'awaiting_payment', freeEvent ? 1 : 0, freeEvent ? 1 : 0]);
    await connection.commit();
    const [bookings] = await pool.execute(`
      SELECT id, eventId, status, reservedAt, paymentDeadline, paidAt
      FROM event_bookings WHERE id = ?
    `, [result.insertId]);
    return { status: 201, booking: bookings[0] };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getEventBookings(user) {
  await expireEventBookings();
  const [rows] = user.role === 'admin'
    ? await pool.query(`
      SELECT b.id, b.eventId, b.userId, b.status, b.paymentReference,
        b.reservedAt, b.paymentDeadline, b.paymentSubmittedAt, b.paidAt,
        e.title AS eventTitle, e.startsAt AS eventStartsAt, e.price, e.currency,
        u.name AS userName, u.email AS userEmail
      FROM event_bookings b
      JOIN events e ON e.id = b.eventId
      JOIN users u ON u.id = b.userId
      ORDER BY b.reservedAt DESC, b.id DESC
    `)
    : await pool.execute(`
      SELECT b.id, b.eventId, b.userId, b.status, b.paymentReference,
        b.reservedAt, b.paymentDeadline, b.paymentSubmittedAt, b.paidAt,
        e.title AS eventTitle, e.startsAt AS eventStartsAt, e.location, e.price,
        e.currency, e.paymentInstructions
      FROM event_bookings b
      JOIN events e ON e.id = b.eventId
      WHERE b.userId = ?
      ORDER BY b.reservedAt DESC, b.id DESC
    `, [user.id]);
  return rows;
}

async function submitEventPaymentReference(user, bookingId, paymentReference) {
  await expireEventBookings();
  const [result] = await pool.execute(`
    UPDATE event_bookings
    SET status = 'payment_submitted',
        paymentReference = ?,
        paymentSubmittedAt = UTC_TIMESTAMP(3)
    WHERE id = ? AND userId = ? AND status = 'awaiting_payment'
      AND paymentDeadline > UTC_TIMESTAMP(3)
  `, [paymentReference, bookingId, user.id]);
  if (result.affectedRows) return { status: 200, message: 'Transfer reference submitted for review.' };

  const [rows] = await pool.execute(
    'SELECT status FROM event_bookings WHERE id = ? AND userId = ? LIMIT 1',
    [bookingId, user.id],
  );
  if (!rows.length) return { status: 404, message: 'Booking not found.' };
  if (rows[0].status === 'expired') {
    return { status: 410, message: 'The payment window expired. Please reserve a place again.' };
  }
  return { status: 409, message: 'This booking is no longer awaiting payment.' };
}

async function updateEventPaymentStatus(bookingId, status) {
  await expireEventBookings();
  const [result] = await pool.execute(`
    UPDATE event_bookings
    SET status = ?,
        paidAt = IF(? = 'paid', UTC_TIMESTAMP(3), NULL)
    WHERE id = ? AND status = 'payment_submitted'
  `, [status, status, bookingId]);
  if (result.affectedRows) return { status: 200, message: status === 'paid' ? 'Payment confirmed.' : 'Payment rejected.' };

  const [rows] = await pool.execute('SELECT status FROM event_bookings WHERE id = ? LIMIT 1', [bookingId]);
  if (!rows.length) return { status: 404, message: 'Booking not found.' };
  return { status: 409, message: 'Only submitted transfers can be reviewed.' };
}

module.exports = {
  addMessage,
  checkDatabase,
  closeDatabase,
  createTicket,
  createEvent,
  createEventBooking,
  expireEventBookings,
  getEvents,
  getEventBookings,
  getClients,
  getPendingAccounts,
  getTicketDetails,
  getTickets,
  getUserById,
  initializeDatabase,
  loginUser,
  registerUser,
  seedAdmin,
  submitEventPaymentReference,
  reviewAccount,
  updateEventPaymentStatus,
  updateTicketStatus,
};
