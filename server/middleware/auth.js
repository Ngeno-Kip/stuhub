const jwt = require('jsonwebtoken');
const { getUserById } = require('../db');

async function protect(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Not authorized, no token.' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) return res.status(401).json({ message: 'Not authorized, no token.' });

  try {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured in server/.env.');
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (typeof payload !== 'object' || typeof payload.id !== 'string') {
      return res.status(401).json({ message: 'Not authorized, invalid token.' });
    }
    const user = await getUserById(payload.id);
    if (!user) return res.status(401).json({ message: 'Not authorized, user not found.' });
    if (user.approvalStatus === 'pending') {
      return res.status(403).json({ message: 'This account is awaiting admin approval.' });
    }
    if (user.approvalStatus === 'rejected') {
      return res.status(403).json({ message: 'This account request was not approved.' });
    }
    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Not authorized, invalid or expired token.' });
    }
    console.error('MySQL authentication lookup failed:', error.message);
    return res.status(503).json({ message: 'MySQL database is unavailable.' });
  }
}

const adminOnly = (req, res, next) => {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ message: 'Admin access only.' });
};

module.exports = { protect, adminOnly };
