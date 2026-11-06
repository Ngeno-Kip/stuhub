const express = require('express');
const { getClients } = require('../db');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', protect, adminOnly, async (req, res) => {
  try {
    return res.json({ clients: await getClients() });
  } catch (error) {
    console.error('MySQL clients request failed:', error.message);
    return res.status(503).json({ message: 'MySQL database is unavailable.' });
  }
});

module.exports = router;
