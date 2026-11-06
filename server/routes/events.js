const express = require('express');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const {
  createEvent,
  createEventBooking,
  getEvents,
  getEventBookings,
  submitEventPaymentReference,
  updateEventPaymentStatus,
} = require('../db');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();
const reviewStatuses = new Set(['paid', 'rejected']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 8, parts: 9 },
  fileFilter(req, file, callback) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Choose a JPG, PNG, or WebP event image.'));
    }
    return callback(null, true);
  },
});

function receiveEventImage(req, res, next) {
  upload.single('image')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Event images must be 5 MB or smaller.' });
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FIELD_COUNT') {
      return res.status(400).json({ message: 'Enter the required event details only.' });
    }
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ message: 'Upload one event image at a time.' });
    }
    return res.status(400).json({ message: error.message });
  });
}

function imageExtension(file) {
  const signature = file.buffer.subarray(0, 12);
  if (
    file.mimetype === 'image/jpeg' &&
    signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
  ) return '.jpg';
  if (
    file.mimetype === 'image/png' &&
    signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) return '.png';
  if (
    file.mimetype === 'image/webp' &&
    signature.toString('ascii', 0, 4) === 'RIFF' &&
    signature.toString('ascii', 8, 12) === 'WEBP'
  ) return '.webp';
  return null;
}

function handleStorageError(res, error) {
  console.error('MySQL events request failed:', error.message);
  return res.status(503).json({ message: 'MySQL database is unavailable.' });
}

function sendResult(res, result) {
  const { status, ...body } = result;
  return res.status(status).json(body);
}

router.get('/', protect, async (req, res) => {
  try {
    return res.json({ events: await getEvents() });
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.post('/', protect, adminOnly, receiveEventImage, async (req, res) => {
  const {
    title,
    description,
    location,
    startsAt,
    capacity,
    price,
    currency,
    paymentInstructions,
  } = req.body || {};
  const parsedCapacity = Number(capacity);
  const parsedPrice = Number(price);
  const normalizedCurrency = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  const extension = req.file ? imageExtension(req.file) : null;

  if (req.file && !extension) {
    return res.status(400).json({ message: 'The selected file is not a valid JPG, PNG, or WebP image.' });
  }

  if (
    typeof title !== 'string' || !title.trim() || title.trim().length > 160 ||
    typeof description !== 'string' || !description.trim() ||
    typeof location !== 'string' || !location.trim() || location.trim().length > 200 ||
    typeof startsAt !== 'string' || !startsAt ||
    !Number.isSafeInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 100000 ||
    !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 99999999.99 ||
    !/^[A-Z]{3}$/.test(normalizedCurrency) ||
    (parsedPrice > 0 && (typeof paymentInstructions !== 'string' || !paymentInstructions.trim()))
  ) {
    return res.status(400).json({
      message: 'Enter an event name, description, location, future date, seat limit, valid price, currency, and payment instructions for paid events.',
    });
  }

  let imagePath = null;
  if (req.file) {
    const filename = `${crypto.randomUUID()}${extension}`;
    const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
    imagePath = path.join(uploadDirectory, filename);
    try {
      await fs.mkdir(uploadDirectory, { recursive: true });
      await fs.writeFile(imagePath, req.file.buffer, { flag: 'wx' });
    } catch (error) {
      console.error(`Could not save event image ${imagePath}: ${error.message}`);
      if (error.code !== 'EEXIST') {
        try {
          await fs.unlink(imagePath);
        } catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') {
            console.error(`Could not remove incomplete event image ${imagePath}: ${cleanupError.message}`);
          }
        }
      }
      return res.status(500).json({ message: 'The event image could not be saved.' });
    }
  }

  try {
    const result = await createEvent(req.user, {
      title: title.trim(),
      description: description.trim(),
      location: location.trim(),
      startsAt,
      capacity: parsedCapacity,
      price: parsedPrice,
      currency: normalizedCurrency,
      paymentInstructions: typeof paymentInstructions === 'string' ? paymentInstructions.trim() : '',
      imageUrl: imagePath ? `/uploads/${path.basename(imagePath)}` : null,
    });
    if (result.status >= 400 && imagePath) {
      try {
        await fs.unlink(imagePath);
      } catch (error) {
        console.error(`Could not remove unused event image ${imagePath}: ${error.message}`);
      }
      imagePath = null;
    }
    return sendResult(res, result);
  } catch (error) {
    if (imagePath) {
      try {
        await fs.unlink(imagePath);
      } catch (cleanupError) {
        console.error(`Could not remove unused event image ${imagePath}: ${cleanupError.message}`);
      }
    }
    return handleStorageError(res, error);
  }
});

router.get('/bookings', protect, async (req, res) => {
  try {
    return res.json({ bookings: await getEventBookings(req.user) });
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.post('/bookings/:bookingId/payment-reference', protect, async (req, res) => {
  const { paymentReference } = req.body || {};
  if (
    typeof paymentReference !== 'string' ||
    !paymentReference.trim() ||
    paymentReference.trim().length > 120
  ) {
    return res.status(400).json({ message: 'Enter a transfer reference (up to 120 characters).' });
  }

  try {
    const result = await submitEventPaymentReference(
      req.user,
      req.params.bookingId,
      paymentReference.trim(),
    );
    return sendResult(res, result);
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.patch('/bookings/:bookingId/payment', protect, adminOnly, async (req, res) => {
  const { status } = req.body || {};
  if (!reviewStatuses.has(status)) {
    return res.status(400).json({ message: 'Payment review status must be paid or rejected.' });
  }

  try {
    const result = await updateEventPaymentStatus(req.params.bookingId, status);
    return sendResult(res, result);
  } catch (error) {
    return handleStorageError(res, error);
  }
});

router.post('/:eventId/bookings', protect, async (req, res) => {
  if (!/^\d+$/.test(req.params.eventId)) {
    return res.status(400).json({ message: 'Invalid event.' });
  }
  try {
    const result = await createEventBooking(req.user, req.params.eventId);
    return sendResult(res, result);
  } catch (error) {
    return handleStorageError(res, error);
  }
});

module.exports = router;
