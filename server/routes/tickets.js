const express = require('express');
const {
  addMessage,
  createTicket,
  getTicketDetails,
  getTickets,
  updateTicketStatus,
} = require('../db');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
const statuses = new Set(['open', 'in_progress', 'resolved', 'closed']);
const priorities = new Set(['low', 'medium', 'high']);

function sendResult(res, result) {
  const { status, ...body } = result;
  return res.status(status).json(body);
}

function handleStorageError(res, error) {
  console.error('MySQL ticket request failed:', error.message);
  return res.status(503).json({ message: 'MySQL database is unavailable.' });
}

router.get('/', protect, async (req, res) => {
  try {
    return res.json({ tickets: await getTickets(req.user) });
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.post('/', protect, async (req, res) => {
  const { subject, description, priority, clientId: requestedClientId } = req.body || {};
  if (
    typeof subject !== 'string' ||
    !subject.trim() ||
    subject.trim().length > 120 ||
    typeof description !== 'string' ||
    !description.trim() ||
    description.trim().length > 5000
  ) {
    return res.status(400).json({ message: 'Enter a subject (up to 120 characters) and description (up to 5000 characters).' });
  }

  const isAdmin = req.user.role === 'admin';
  if (!isAdmin && req.user.role !== 'client') {
    return res.status(403).json({ message: 'Only clients and admins can create tickets.' });
  }
  if (isAdmin && (typeof requestedClientId !== 'string' || !requestedClientId.trim())) {
    return res.status(400).json({ message: 'Choose a client for this ticket.' });
  }
  if (isAdmin && priority && !priorities.has(priority)) {
    return res.status(400).json({ message: 'Invalid ticket priority.' });
  }

  try {
    const result = await createTicket(req.user, {
      subject: String(subject).trim(),
      description: String(description).trim(),
      priority: isAdmin ? (priority || 'medium') : 'medium',
      clientId: isAdmin ? requestedClientId.trim() : req.user.id,
    });
    return sendResult(res, result);
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.get('/:ticketNumber', protect, async (req, res) => {
  try {
    return sendResult(res, await getTicketDetails(req.user, req.params.ticketNumber));
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.post('/:ticketNumber/messages', protect, async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'Message text is required.' });
  }

  try {
    const result = await addMessage(req.user, req.params.ticketNumber, message.trim());
    return sendResult(res, result);
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.patch('/:ticketNumber/status', protect, adminOnly, async (req, res) => {
  const { status } = req.body || {};
  if (!statuses.has(status)) {
    return res.status(400).json({ message: 'Invalid ticket status.' });
  }

  try {
    return sendResult(res, await updateTicketStatus(req.params.ticketNumber, status));
  } catch (error) {
    return handleStorageError(res, error);
  }
});

module.exports = router;
