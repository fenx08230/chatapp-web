const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;

// ---------- File upload configuration ----------
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'media');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowedImages = /jpeg|jpg|png|gif|webp/;
    const allowedVideos = /mp4|mov|webm/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const mimeType = file.mimetype.toLowerCase();

    const isImage = allowedImages.test(ext) && mimeType.startsWith('image/');
    const isVideo = allowedVideos.test(ext) && mimeType.startsWith('video/');

    if (isImage || isVideo) {
      cb(null, true);
    } else {
      cb(new Error('Only images (jpg, png, gif, webp) and videos (mp4, mov, webm) are allowed'));
    }
  },
});

// ---------- POST /api/messages/upload ----------
router.post('/upload', mediaUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No valid file provided' });
    }

    const fileUrl = `/uploads/media/${req.file.filename}`;
    const mimeType = req.file.mimetype.toLowerCase();
    const type = mimeType.startsWith('video/') ? 'video' : 'image';

    return res.json({ url: fileUrl, type, filename: req.file.originalname });
  } catch (err) {
    console.error('File upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/messages/conversation/:userId ----------
// Fetch 1-on-1 message history with pagination
router.get('/conversation/:userId', (req, res) => {
  try {
    const currentUserId = req.userId;
    const otherUserId = parseInt(req.params.userId, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const db = getDb();

    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.receiver_id, m.content, m.type, m.created_at, m.is_read,
             u.username AS sender_username, u.nickname AS sender_nickname, u.avatar AS sender_avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id IS NULL
        AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(currentUserId, otherUserId, otherUserId, currentUserId, limit, offset);

    const totalRow = db.prepare(`
      SELECT COUNT(*) AS total FROM messages
      WHERE group_id IS NULL
        AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
    `).get(currentUserId, otherUserId, otherUserId, currentUserId);

    // Mark unread messages from the other user as read
    db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE sender_id = ? AND receiver_id = ? AND is_read = 0 AND group_id IS NULL
    `).run(otherUserId, currentUserId);

    return res.json({
      messages: messages.reverse(), // Return in chronological order
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit),
      },
    });
  } catch (err) {
    console.error('Conversation history error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/messages/group/:groupId ----------
// Fetch group message history with pagination
router.get('/group/:groupId', (req, res) => {
  try {
    const userId = req.userId;
    const groupId = parseInt(req.params.groupId, 10);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE));
    const offset = (page - 1) * limit;

    const db = getDb();

    // Verify membership
    const membership = db.prepare(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const messages = db.prepare(`
      SELECT m.id, m.sender_id, m.group_id, m.content, m.type, m.created_at,
             u.username AS sender_username, u.nickname AS sender_nickname, u.avatar AS sender_avatar
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      WHERE m.group_id = ?
      ORDER BY m.created_at DESC
      LIMIT ? OFFSET ?
    `).all(groupId, limit, offset);

    const totalRow = db.prepare(
      'SELECT COUNT(*) AS total FROM messages WHERE group_id = ?'
    ).get(groupId);

    return res.json({
      messages: messages.reverse(),
      pagination: {
        page,
        limit,
        total: totalRow.total,
        totalPages: Math.ceil(totalRow.total / limit),
      },
    });
  } catch (err) {
    console.error('Group message history error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/messages/conversations ----------
// List recent conversations (last message from each)
router.get('/conversations', (req, res) => {
  try {
    const userId = req.userId;
    const db = getDb();

    const conversations = db.prepare(`
      SELECT
        m.*,
        u.username AS other_username,
        u.nickname AS other_nickname,
        u.avatar AS other_avatar,
        u.status AS other_status
      FROM messages m
      JOIN users u ON u.id = CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END
      WHERE m.group_id IS NULL
        AND (m.sender_id = ? OR m.receiver_id = ?)
        AND m.id IN (
          SELECT MAX(id) FROM messages
          WHERE group_id IS NULL AND (sender_id = ? OR receiver_id = ?)
          GROUP BY CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END
        )
      ORDER BY m.created_at DESC
    `).all(userId, userId, userId, userId, userId, userId);

    // Attach unread counts
    const result = conversations.map((conv) => {
      const otherId = conv.sender_id === userId ? conv.receiver_id : conv.sender_id;
      const unread = db.prepare(`
        SELECT COUNT(*) AS count FROM messages
        WHERE sender_id = ? AND receiver_id = ? AND is_read = 0 AND group_id IS NULL
      `).get(otherId, userId);

      return { ...conv, unreadCount: unread.count };
    });

    return res.json({ conversations: result });
  } catch (err) {
    console.error('Conversations list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
