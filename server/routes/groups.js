const express = require('express');
const { getDb } = require('../models/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// ---------- POST /api/groups ----------
router.post('/', (req, res) => {
  try {
    const { name, description, members } = req.body;
    const userId = req.userId;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    if (name.length > 100) {
      return res.status(400).json({ error: 'Group name must be under 100 characters' });
    }

    const db = getDb();

    const insertGroup = db.prepare(
      'INSERT INTO groups (name, owner_id, description) VALUES (?, ?, ?)'
    );
    const insertMember = db.prepare(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)'
    );

    const createGroup = db.transaction(() => {
      const result = insertGroup.run(name.trim(), userId, description || null);
      const groupId = result.lastInsertRowid;
      // Add owner
      insertMember.run(groupId, userId, 'owner');
      // Add initial members
      if (Array.isArray(members)) {
        for (const memberId of members) {
          if (memberId !== userId) {
            const userExists = db.prepare('SELECT id FROM users WHERE id = ?').get(memberId);
            if (userExists) {
              insertMember.run(groupId, memberId, 'member');
            }
          }
        }
      }
      return groupId;
    });

    const groupId = createGroup();

    return res.status(201).json({
      message: 'Group created',
      group: { id: groupId, name: name.trim(), owner_id: userId, description },
    });
  } catch (err) {
    console.error('Create group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/groups ----------
router.get('/', (req, res) => {
  try {
    const userId = req.userId;
    const db = getDb();

    const groups = db.prepare(`
      SELECT g.id, g.name, g.avatar, g.owner_id, g.description, g.created_at, gm.role
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `).all(userId);

    return res.json({ groups });
  } catch (err) {
    console.error('List groups error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/groups/:groupId ----------
router.get('/:groupId', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const db = getDb();

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const memberCount = db.prepare(
      'SELECT COUNT(*) AS count FROM group_members WHERE group_id = ?'
    ).get(groupId).count;

    return res.json({ group: { ...group, memberCount } });
  } catch (err) {
    console.error('Group info error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/groups/:groupId/join ----------
router.post('/:groupId/join', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const db = getDb();

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const existing = db.prepare(
      'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (existing) {
      return res.status(409).json({ error: 'Already a member of this group' });
    }

    // If approval is required, create a join request instead
    if (group.approval_required) {
      const pendingRequest = db.prepare(
        "SELECT id FROM join_requests WHERE group_id = ? AND user_id = ? AND status = 'pending'"
      ).get(groupId, userId);

      if (pendingRequest) {
        return res.status(409).json({ error: 'You already have a pending join request' });
      }

      const result = db.prepare(
        'INSERT INTO join_requests (group_id, user_id, status) VALUES (?, ?, ?)'
      ).run(groupId, userId, 'pending');

      // Notify owner and admins via socket
      const io = req.app.get('io');
      if (io) {
        const user = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(userId);
        const admins = db.prepare(
          "SELECT user_id FROM group_members WHERE group_id = ? AND role IN ('owner', 'admin')"
        ).all(groupId);
        const onlineUsers = req.app.get('onlineUsers');
        for (const admin of admins) {
          const socketId = onlineUsers?.get(admin.user_id);
          if (socketId) {
            io.to(socketId).emit('join_request', {
              requestId: result.lastInsertRowid,
              groupId,
              user,
            });
          }
        }
      }

      return res.json({ message: 'Join request submitted, awaiting approval' });
    }

    db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)')
      .run(groupId, userId, 'member');

    // Notify group members via socket
    const io = req.app.get('io');
    if (io) {
      const user = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(userId);
      io.to(`group:${groupId}`).emit('member_joined', { groupId, user });
    }

    return res.json({ message: 'Joined group successfully' });
  } catch (err) {
    console.error('Join group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/groups/:groupId/settings ----------
router.put('/:groupId/settings', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const { approval_required } = req.body;
    const db = getDb();

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the owner can change group settings' });
    }

    if (approval_required !== undefined) {
      db.prepare('UPDATE groups SET approval_required = ? WHERE id = ?')
        .run(approval_required ? 1 : 0, groupId);
    }

    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    return res.json({ message: 'Group settings updated', group: updated });
  } catch (err) {
    console.error('Update group settings error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/groups/:groupId/members/:memberId/role ----------
router.put('/:groupId/members/:memberId/role', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const memberId = parseInt(req.params.memberId, 10);
    const userId = req.userId;
    const { role } = req.body;
    const db = getDb();

    if (!role || !['admin', 'member'].includes(role)) {
      return res.status(400).json({ error: "Role must be 'admin' or 'member'" });
    }

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the owner can change member roles' });
    }

    const membership = db.prepare(
      'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, memberId);

    if (!membership) {
      return res.status(404).json({ error: 'User is not a member of this group' });
    }
    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change the owner role' });
    }

    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?')
      .run(role, groupId, memberId);

    return res.json({ message: `Member role updated to ${role}` });
  } catch (err) {
    console.error('Update member role error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/groups/:groupId/join-requests ----------
router.get('/:groupId/join-requests', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const db = getDb();

    const membership = db.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only owner or admin can view join requests' });
    }

    const requests = db.prepare(`
      SELECT jr.id, jr.group_id, jr.user_id, jr.status, jr.created_at,
             u.username, u.nickname, u.avatar
      FROM join_requests jr
      JOIN users u ON u.id = jr.user_id
      WHERE jr.group_id = ? AND jr.status = 'pending'
      ORDER BY jr.created_at ASC
    `).all(groupId);

    return res.json({ requests });
  } catch (err) {
    console.error('List join requests error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/groups/:groupId/join-requests/:requestId/approve ----------
router.post('/:groupId/join-requests/:requestId/approve', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const requestId = parseInt(req.params.requestId, 10);
    const userId = req.userId;
    const db = getDb();

    const membership = db.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only owner or admin can approve join requests' });
    }

    const request = db.prepare(
      "SELECT * FROM join_requests WHERE id = ? AND group_id = ? AND status = 'pending'"
    ).get(requestId, groupId);

    if (!request) {
      return res.status(404).json({ error: 'Join request not found or already processed' });
    }

    const approve = db.transaction(() => {
      db.prepare("UPDATE join_requests SET status = 'approved' WHERE id = ?").run(requestId);
      db.prepare('INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)').run(
        groupId, request.user_id, 'member'
      );
    });
    approve();

    // Notify the requester via socket
    const io = req.app.get('io');
    const onlineUsers = req.app.get('onlineUsers');
    if (io && onlineUsers) {
      const socketId = onlineUsers.get(request.user_id);
      if (socketId) {
        io.to(socketId).emit('join_approved', { groupId, requestId });
      }
      const user = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(request.user_id);
      io.to(`group:${groupId}`).emit('member_joined', { groupId, user });
    }

    return res.json({ message: 'Join request approved' });
  } catch (err) {
    console.error('Approve join request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/groups/:groupId/join-requests/:requestId/reject ----------
router.post('/:groupId/join-requests/:requestId/reject', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const requestId = parseInt(req.params.requestId, 10);
    const userId = req.userId;
    const db = getDb();

    const membership = db.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only owner or admin can reject join requests' });
    }

    const request = db.prepare(
      "SELECT * FROM join_requests WHERE id = ? AND group_id = ? AND status = 'pending'"
    ).get(requestId, groupId);

    if (!request) {
      return res.status(404).json({ error: 'Join request not found or already processed' });
    }

    db.prepare("UPDATE join_requests SET status = 'rejected' WHERE id = ?").run(requestId);

    return res.json({ message: 'Join request rejected' });
  } catch (err) {
    console.error('Reject join request error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/groups/:groupId/leave ----------
router.post('/:groupId/leave', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const db = getDb();

    const membership = db.prepare(
      'SELECT * FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership) {
      return res.status(404).json({ error: 'Not a member of this group' });
    }
    if (membership.role === 'owner') {
      return res.status(400).json({ error: 'Owner cannot leave. Transfer ownership or delete the group.' });
    }

    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .run(groupId, userId);

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${groupId}`).emit('member_left', { groupId, userId });
    }

    return res.json({ message: 'Left group successfully' });
  } catch (err) {
    console.error('Leave group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- GET /api/groups/:groupId/members ----------
router.get('/:groupId/members', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const db = getDb();

    const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const members = db.prepare(`
      SELECT u.id, u.username, u.nickname, u.avatar, u.status, gm.role, gm.joined_at
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
      ORDER BY
        CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        gm.joined_at ASC
    `).all(groupId);

    return res.json({ members });
  } catch (err) {
    console.error('List members error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- PUT /api/groups/:groupId ----------
router.put('/:groupId', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const { name, description } = req.body;
    const db = getDb();

    const membership = db.prepare(
      'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
    ).get(groupId, userId);

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only owner or admin can update group info' });
    }

    if (name !== undefined) {
      if (!name.trim() || name.length > 100) {
        return res.status(400).json({ error: 'Invalid group name' });
      }
      db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name.trim(), groupId);
    }
    if (description !== undefined) {
      db.prepare('UPDATE groups SET description = ? WHERE id = ?').run(description, groupId);
    }

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    return res.json({ message: 'Group updated', group });
  } catch (err) {
    console.error('Update group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- DELETE /api/groups/:groupId ----------
router.delete('/:groupId', (req, res) => {
  try {
    const groupId = parseInt(req.params.groupId, 10);
    const userId = req.userId;
    const db = getDb();

    const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId);
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    if (group.owner_id !== userId) {
      return res.status(403).json({ error: 'Only the owner can delete the group' });
    }

    const deleteAll = db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM group_members WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM groups WHERE id = ?').run(groupId);
    });
    deleteAll();

    const io = req.app.get('io');
    if (io) {
      io.to(`group:${groupId}`).emit('group_deleted', { groupId });
    }

    return res.json({ message: 'Group deleted' });
  } catch (err) {
    console.error('Delete group error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
