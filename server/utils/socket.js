const { getDb } = require('../models/database');
const { socketAuthMiddleware } = require('../middleware/auth');

// Map of userId -> socketId for online tracking
const onlineUsers = new Map();

function setupSocket(io, app) {
  // Share references so REST routes can emit events
  app.set('io', io);
  app.set('onlineUsers', onlineUsers);

  // Authenticate every socket connection
  io.use(socketAuthMiddleware);

  io.on('connection', (socket) => {
    const userId = socket.userId;
    console.log(`User ${userId} connected (socket ${socket.id})`);

    // ---- Online status ----
    onlineUsers.set(userId, socket.id);
    updateUserStatus(userId, 'online');
    broadcastOnlineStatus(io, userId, 'online');

    // Auto-join all group rooms the user belongs to
    joinUserGroupRooms(socket, userId);

    // ---- 1-on-1 messaging ----
    socket.on('send_message', (data, ack) => {
      handleDirectMessage(io, socket, data, ack);
    });

    // ---- Group messaging ----
    socket.on('send_group_message', (data, ack) => {
      handleGroupMessage(io, socket, data, ack);
    });

    // ---- Typing indicators ----
    socket.on('typing', (data) => {
      handleTyping(io, socket, data, true);
    });

    socket.on('stop_typing', (data) => {
      handleTyping(io, socket, data, false);
    });

    // ---- Group room management ----
    socket.on('join_group', (data) => {
      const groupId = data?.groupId;
      if (groupId) {
        socket.join(`group:${groupId}`);
      }
    });

    socket.on('leave_group', (data) => {
      const groupId = data?.groupId;
      if (groupId) {
        socket.leave(`group:${groupId}`);
      }
    });

    // ---- Mark messages as read ----
    socket.on('mark_read', (data) => {
      handleMarkRead(socket, data);
    });

    // ---- Disconnect ----
    socket.on('disconnect', () => {
      console.log(`User ${userId} disconnected`);
      onlineUsers.delete(userId);
      updateUserStatus(userId, 'offline');
      broadcastOnlineStatus(io, userId, 'offline');
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function updateUserStatus(userId, status) {
  try {
    const db = getDb();
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  } catch (err) {
    console.error('Failed to update user status:', err);
  }
}

function broadcastOnlineStatus(io, userId, status) {
  io.emit('user_status', { userId, status });
}

function joinUserGroupRooms(socket, userId) {
  try {
    const db = getDb();
    const memberships = db.prepare(
      'SELECT group_id FROM group_members WHERE user_id = ?'
    ).all(userId);

    for (const m of memberships) {
      socket.join(`group:${m.group_id}`);
    }
  } catch (err) {
    console.error('Failed to join group rooms:', err);
  }
}

function handleDirectMessage(io, socket, data, ack) {
  try {
    const { receiverId, content, type = 'text' } = data || {};
    const senderId = socket.userId;

    if (!receiverId || !content) {
      return typeof ack === 'function' && ack({ error: 'receiverId and content are required' });
    }

    const validTypes = ['text', 'image', 'video'];
    const msgType = validTypes.includes(type) ? type : 'text';

    const db = getDb();

    // Persist message
    const result = db.prepare(
      'INSERT INTO messages (sender_id, receiver_id, content, type) VALUES (?, ?, ?, ?)'
    ).run(senderId, receiverId, content, msgType);

    const message = db.prepare(`
      SELECT m.*, u.username AS sender_username, u.nickname AS sender_nickname, u.avatar AS sender_avatar
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    // Deliver to receiver if online
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_message', message);
    }

    // Acknowledge to sender
    if (typeof ack === 'function') {
      ack({ success: true, message });
    }
  } catch (err) {
    console.error('Direct message error:', err);
    if (typeof ack === 'function') {
      ack({ error: 'Failed to send message' });
    }
  }
}

function handleGroupMessage(io, socket, data, ack) {
  try {
    const { groupId, content, type = 'text' } = data || {};
    const senderId = socket.userId;

    if (!groupId || !content) {
      return typeof ack === 'function' && ack({ error: 'groupId and content are required' });
    }

    const validTypes = ['text', 'image', 'video'];
    const msgType = validTypes.includes(type) ? type : 'text';

    const db = getDb();

    // Verify membership
    const membership = db.prepare(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, senderId);

    if (!membership) {
      return typeof ack === 'function' && ack({ error: 'Not a member of this group' });
    }

    // Persist message
    const result = db.prepare(
      'INSERT INTO messages (sender_id, group_id, content, type) VALUES (?, ?, ?, ?)'
    ).run(senderId, groupId, content, msgType);

    const message = db.prepare(`
      SELECT m.*, u.username AS sender_username, u.nickname AS sender_nickname, u.avatar AS sender_avatar
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    // Broadcast to the group room (excluding sender)
    socket.to(`group:${groupId}`).emit('receive_group_message', message);

    if (typeof ack === 'function') {
      ack({ success: true, message });
    }
  } catch (err) {
    console.error('Group message error:', err);
    if (typeof ack === 'function') {
      ack({ error: 'Failed to send group message' });
    }
  }
}

function handleTyping(io, socket, data, isTyping) {
  const { receiverId, groupId } = data || {};
  const userId = socket.userId;

  const event = isTyping ? 'user_typing' : 'user_stop_typing';

  if (groupId) {
    socket.to(`group:${groupId}`).emit(event, { userId, groupId });
  } else if (receiverId) {
    const receiverSocketId = onlineUsers.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit(event, { userId });
    }
  }
}

function handleMarkRead(socket, data) {
  try {
    const { senderId } = data || {};
    const userId = socket.userId;

    if (!senderId) return;

    const db = getDb();
    db.prepare(`
      UPDATE messages SET is_read = 1
      WHERE sender_id = ? AND receiver_id = ? AND is_read = 0 AND group_id IS NULL
    `).run(senderId, userId);
  } catch (err) {
    console.error('Mark read error:', err);
  }
}

module.exports = { setupSocket };
