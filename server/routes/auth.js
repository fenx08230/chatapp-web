const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../models/database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Avatar upload configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'avatars');
    const fs = require('fs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = allowed.test(file.mimetype.split('/')[1]);
    cb(null, extOk && mimeOk);
  },
});

// ---------- POST /api/auth/register ----------
router.post('/register', (req, res) => {
  try {
    const { username, password, nickname } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, nickname) VALUES (?, ?, ?)'
    ).run(username, hash, nickname || username);

    const token = generateToken(result.lastInsertRowid);
    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: result.lastInsertRowid,
        username,
        nickname: nickname || username,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/auth/login ----------
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id);
    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        status: user.status,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/auth/user/:id ----------
router.get('/user/:id', authMiddleware, (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, nickname, avatar, status FROM users WHERE id = ?'
    ).get(targetId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('User lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/auth/profile ----------
router.get('/profile', authMiddleware, (req, res) => {
  try {
    const db = getDb();
    const user = db.prepare(
      'SELECT id, username, nickname, avatar, status, created_at FROM users WHERE id = ?'
    ).get(req.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/auth/profile ----------
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { nickname } = req.body;
    const db = getDb();

    if (nickname !== undefined) {
      if (nickname.length < 1 || nickname.length > 50) {
        return res.status(400).json({ error: 'Nickname must be 1-50 characters' });
      }
      db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(nickname, req.userId);
    }

    const user = db.prepare(
      'SELECT id, username, nickname, avatar, status, created_at FROM users WHERE id = ?'
    ).get(req.userId);

    return res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error('Profile update error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/auth/avatar ----------
router.post('/avatar', authMiddleware, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No valid image file provided' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const db = getDb();
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatarUrl, req.userId);

    return res.json({ message: 'Avatar updated', avatar: avatarUrl });
  } catch (err) {
    console.error('Avatar upload error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
