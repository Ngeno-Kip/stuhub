const express = require('express');
const { getPendingAccounts, reviewAccount } = require('../db');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
const approvalStatuses = new Set(['approved', 'rejected']);

router.get('/pending', protect, adminOnly, async (req, res) => {
  try {
    return res.json({ accounts: await getPendingAccounts() });
  } catch (error) {
    console.error('MySQL pending accounts request failed:', error.message);
    return res.status(503).json({ message: 'MySQL database is unavailable.' });
  }
});

router.patch('/:accountId/approval', protect, adminOnly, async (req, res) => {
  const { approvalStatus } = req.body || {};
  if (!approvalStatuses.has(approvalStatus)) {
    return res.status(400).json({ message: 'Approval status must be approved or rejected.' });
  }

  try {
    const result = await reviewAccount(req.user.id, req.params.accountId, approvalStatus);
    const { status, ...body } = result;
    return res.status(status).json(body);
  } catch (error) {
    console.error('MySQL account approval failed:', error.message);
    return res.status(503).json({ message: 'MySQL database is unavailable.' });
  }
});

module.exports = router;
