const express = require('express');
const { loginUser, registerUser } = require('../db');
const { protect } = require('../middleware/auth');

const router = express.Router();

function sendResult(res, result) {
  const { status, ...body } = result;
  return res.status(status).json(body);
}

function storageUnavailable(res, error) {
  console.error('MySQL auth request failed:', error.message);
  return res.status(503).json({ message: 'MySQL database is unavailable.' });
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  if (
    typeof name !== 'string' ||
    typeof email !== 'string' ||
    typeof password !== 'string' ||
    !name.trim() ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({ message: 'Name, email, and password are required.' });
  }

  try {
    const result = await registerUser({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password,
    });
    return sendResult(res, result);
  } catch (error) {
    return storageUnavailable(res, error);
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Email and password are required.' });
  }

  try {
    const result = await loginUser({
      email: email.trim().toLowerCase(),
      password,
    });
    return sendResult(res, result);
  } catch (error) {
    return storageUnavailable(res, error);
  }
});

router.get('/me', protect, (req, res) => res.json(req.user));

module.exports = { router, sendResult, storageUnavailable };
