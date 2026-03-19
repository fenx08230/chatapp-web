const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'chat-app-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * Express middleware that validates the JWT from the Authorization header.
 * On success, attaches `req.userId` for downstream handlers.
 */
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    const decoded = verifyToken(token);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Socket.io middleware that validates the JWT from the handshake auth object.
 */
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }

  try {
    const decoded = verifyToken(token);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    return next(new Error('Invalid token'));
  }
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authMiddleware,
  socketAuthMiddleware,
};
