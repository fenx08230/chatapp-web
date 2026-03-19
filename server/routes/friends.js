const express = require('express');
const { getDb } = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// ---------- POST /api/friends/request ----------
router.post('/request', (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.userId;

    if (!friendId) {
      return res.status(400).json({ error: 'friendId is required' });
    }
    if (friendId === userId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    const db = getDb();

    const friend = db.prepare('SELECT id FROM users WHERE id = ?').get(friendId);
    if (!friend) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check for existing relationship in either direction
    const existing = db.prepare(
      `SELECT * FROM friends
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`
    ).get(userId, friendId, friendId, userId);

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(409).json({ error: 'Already friends' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'Friend request already pending' });
      }
      if (existing.status === 'rejected') {
        // Allow re-sending after rejection
        db.prepare('UPDATE friends SET status = ?, user_id = ?, friend_id = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run('pending', userId, friendId, existing.id);
        return res.json({ message: 'Friend request re-sent' });
      }
    }

    db.prepare('INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)')
      .run(userId, friendId, 'pending');

    // Emit socket event if the target user is online
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');
    const targetSocketId = onlineUsers?.get(friendId);
    if (io && targetSocketId) {
      const sender = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(userId);
      io.to(targetSocketId).emit('friend_request', { from: sender });
    }

    return res.status(201).json({ message: 'Friend request sent' });
  } catch (err) {
    console.error('Friend request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/friends/accept ----------
router.put('/accept', (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.userId;
    const db = getDb();

    const request = db.prepare(
      'SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?'
    ).get(friendId, userId, 'pending');

    if (!request) {
      return res.status(404).json({ error: 'No pending friend request found' });
    }

    db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('accepted', request.id);

    return res.json({ message: 'Friend request accepted' });
  } catch (err) {
    console.error('Accept friend error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/friends/reject ----------
router.put('/reject', (req, res) => {
  try {
    const { friendId } = req.body;
    const userId = req.userId;
    const db = getDb();

    const request = db.prepare(
      'SELECT * FROM friends WHERE user_id = ? AND friend_id = ? AND status = ?'
    ).get(friendId, userId, 'pending');

    if (!request) {
      return res.status(404).json({ error: 'No pending friend request found' });
    }

    db.prepare('UPDATE friends SET status = ? WHERE id = ?').run('rejected', request.id);

    return res.json({ message: 'Friend request rejected' });
  } catch (err) {
    console.error('Reject friend error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/friends ----------
router.get('/', (req, res) => {
  try {
    const userId = req.userId;
    const db = getDb();

    const friends = db.prepare(`
      SELECT u.id, u.username, u.nickname, u.avatar, u.status
      FROM friends f
      JOIN users u ON (
        CASE
          WHEN f.user_id = ? THEN u.id = f.friend_id
          ELSE u.id = f.user_id
        END
      )
      WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    `).all(userId, userId, userId);

    return res.json({ friends });
  } catch (err) {
    console.error('List friends error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/friends/pending ----------
router.get('/pending', (req, res) => {
  try {
    const userId = req.userId;
    const db = getDb();

    // Requests sent TO the current user
    const incoming = db.prepare(`
      SELECT u.id, u.username, u.nickname, u.avatar, f.created_at AS requested_at
      FROM friends f
      JOIN users u ON u.id = f.user_id
      WHERE f.friend_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `).all(userId);

    // Requests sent BY the current user
    const outgoing = db.prepare(`
      SELECT u.id, u.username, u.nickname, u.avatar, f.created_at AS requested_at
      FROM friends f
      JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ? AND f.status = 'pending'
      ORDER BY f.created_at DESC
    `).all(userId);

    return res.json({ incoming, outgoing });
  } catch (err) {
    console.error('Pending friends error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- DELETE /api/friends/:friendId ----------
router.delete('/:friendId', (req, res) => {
  try {
    const userId = req.userId;
    const friendId = parseInt(req.params.friendId, 10);
    const db = getDb();

    const result = db.prepare(
      `DELETE FROM friends
       WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
         AND status = 'accepted'`
    ).run(userId, friendId, friendId, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    return res.json({ message: 'Friend removed' });
  } catch (err) {
    console.error('Delete friend error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
