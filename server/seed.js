require('dotenv').config();

const {
  closeDatabase,
  initializeDatabase,
  seedAdmin: seedAdminAccount,
} = require('./db');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in server/.env before seeding an admin.');
  }

  await initializeDatabase();
  const message = await seedAdminAccount({
    name: process.env.ADMIN_NAME?.trim() || 'Stuhub Admin',
    email,
    password,
  });
  console.log(message);
}

seedAdmin().catch((error) => {
  console.error(`Unable to seed admin: ${error.message}`);
  process.exitCode = 1;
}).finally(() => closeDatabase().catch((error) => {
  console.error(`Unable to close MySQL connections: ${error.message}`);
  process.exitCode = 1;
}));
