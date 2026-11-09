require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const { router: authRoutes } = require('./routes/auth');
const accountRoutes = require('./routes/accounts');
const ticketRoutes = require('./routes/tickets');
const clientRoutes = require('./routes/clients');
const eventRoutes = require('./routes/events');
const {
  checkDatabase,
  closeDatabase,
  expireEventBookings,
  initializeDatabase,
} = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', async (req, res) => {
  try {
    await checkDatabase();
    return res.json({ status: 'ok', storage: 'MySQL' });
  } catch (error) {
    return res.status(503).json({
      status: 'storage unavailable',
      storage: 'MySQL',
      message: error.message,
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/events', eventRoutes);

const PORT = Number(process.env.PORT) || 8080;
const server = app.listen(PORT, () => {
  console.log(`Stuhub website listening on http://localhost:${PORT}`);
});

server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') {
    console.error(`StuHub could not start: ${error.message}`);
    process.exit(1);
  }

  const request = http.get(
    { hostname: '127.0.0.1', port: PORT, path: '/health', timeout: 2000 },
    (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        let health;
        try {
          health = JSON.parse(body);
        } catch {
          health = null;
        }

        if (health && health.storage === 'MySQL') {
          console.log(`StuHub is already running at http://localhost:${PORT}`);
          process.exit(0);
        }

        console.error(`Port ${PORT} is already in use by another application.`);
        process.exit(1);
      });
    },
  );
  request.on('error', () => {
    console.error(`Port ${PORT} is already in use by another application.`);
    process.exit(1);
  });
});

initializeDatabase()
  .then(() => {
    console.log('MySQL database is ready.');
    const expiryTimer = setInterval(() => {
      expireEventBookings().catch((error) => {
        console.error(`Event booking expiry failed: ${error.message}`);
      });
    }, 30_000);
    expiryTimer.unref();
  })
  .catch((error) => console.error(`MySQL database initialization failed: ${error.message}`));

function shutdown() {
  server.close(() => {
    closeDatabase()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error(`MySQL shutdown failed: ${error.message}`);
        process.exit(1);
      });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
