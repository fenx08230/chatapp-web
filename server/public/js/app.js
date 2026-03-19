/**
 * Telegram-Web-style Chat Application
 * Built with Vue 3 (global build) + Socket.io
 */

// ---------------------------------------------------------------------------
// Helper utilities (outside Vue)
// ---------------------------------------------------------------------------

/** Deterministic avatar background color from a name string */
function avatarColor(name) {
  if (!name) return '#90a4ae';
  const colors = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
    '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
    '#aed581', '#ff8a65', '#a1887f', '#90a4ae'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Return first two characters uppercased as initials */
function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Human-friendly relative time (HH:MM, yesterday, date) */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / 86400000);

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const time = `${hh}:${mm}`;

  if (diffDays === 0) return time;
  if (diffDays === 1) return '\u6628\u5929';           // 昨天
  if (diffDays < 7) return `${diffDays}\u5929\u524d`;  // X天前
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${m}/${d}`;
}

/**
 * Thin fetch wrapper that injects the Authorization header.
 * Returns parsed JSON (or null on 204).
 */
async function api(method, url, data) {
  const token = localStorage.getItem('chat_token') || '';
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  };
  if (data && method !== 'GET') {
    opts.body = JSON.stringify(data);
  }
  const res = await fetch(url, opts);
  if (res.status === 401) {
    // Force logout on auth failure
    localStorage.removeItem('chat_token');
    window.location.reload();
    return null;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Vue Application
// ---------------------------------------------------------------------------

const app = Vue.createApp({
  data() {
    return {
      // Auth
      loggedIn: false,
      loginMode: 'login',
      username: '',
      password: '',
      regNickname: '',
      authError: '',
      user: null,
      token: '',

      // UI state
      showPanel: null,
      mobileShowChat: false,
      searchQuery: '',
      messageText: '',
      toast: null,

      // Data collections
      conversations: [],
      contacts: [],
      friendRequests: [],
      activeChat: null,
      onlineUsers: new Set(),

      // Add-friend state
      friendSearch: '',
      searchResults: [],
      searchNoResult: false,

      // Create-group state
      newGroupName: '',
      newGroupDesc: '',
      groupMembers: new Set(),

      // New feature state
      viewingUser: null,
      lightboxUrl: null,
      groupSettings: null,
      joinRequests: []
    };
  },

  computed: {
    /** Filter conversations by search query (name match) */
    filteredConversations() {
      if (!this.searchQuery) return this.conversations;
      const q = this.searchQuery.toLowerCase();
      return this.conversations.filter(c =>
        c.name && c.name.toLowerCase().includes(q)
      );
    },

    /** Contacts currently online */
    onlineContacts() {
      return this.contacts.filter(c => this.onlineUsers.has(c.id));
    },

    /** Contacts currently offline */
    offlineContacts() {
      return this.contacts.filter(c => !this.onlineUsers.has(c.id));
    }
  },

  mounted() {
    // Attempt to restore a previous session from localStorage
    const savedToken = localStorage.getItem('chat_token');
    if (savedToken) {
      this.token = savedToken;
      api('GET', '/api/auth/profile').then(data => {
        if (data && data.user) {
          this.user = data.user;
          this.loggedIn = true;
          this.initSocket();
          this.loadData();
        }
      }).catch(() => {
        localStorage.removeItem('chat_token');
      });
    }

    // Responsive: close mobile chat pane when resizing to desktop
    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        this.mobileShowChat = false;
      }
    });
  },

  methods: {
    // ---- Auth ---------------------------------------------------------

    /** Login or register based on loginMode */
    async doAuth() {
      this.authError = '';
      const isRegister = this.loginMode === 'register';
      const url = isRegister ? '/api/auth/register' : '/api/auth/login';
      const body = {
        username: this.username,
        password: this.password,
        ...(isRegister ? { nickname: this.regNickname } : {})
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
          this.authError = data.message || 'Authentication failed';
          return;
        }
        this.token = data.token;
        this.user = data.user;
        localStorage.setItem('chat_token', data.token);
        this.loggedIn = true;
        this.initSocket();
        this.loadData();
      } catch (e) {
        this.authError = 'Network error, please try again';
      }
    },

    /** Clear state and disconnect */
    logout() {
      localStorage.removeItem('chat_token');
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      this.loggedIn = false;
      this.user = null;
      this.token = '';
      this.conversations = [];
      this.contacts = [];
      this.friendRequests = [];
      this.activeChat = null;
      this.onlineUsers = new Set();
      this.showPanel = null;
    },

    // ---- Socket.io ----------------------------------------------------

    /** Establish authenticated socket connection and bind events */
    initSocket() {
      this.socket = io({ auth: { token: this.token } });

      this.socket.on('receive_message', (msg) => {
        const conv = this.conversations.find(
          c => !c.isGroup && c.userId === msg.senderId
        );
        if (conv) {
          conv.messages.push(msg);
          conv.lastMessage = msg.content;
          conv.time = msg.createdAt || new Date().toISOString();
          if (this.activeChat && this.activeChat.id === conv.id) {
            this.scrollToBottom();
          } else {
            conv.unread = (conv.unread || 0) + 1;
          }
        } else {
          // New conversation from incoming message
          this.loadData();
        }
      });

      this.socket.on('receive_group_message', (msg) => {
        const conv = this.conversations.find(
          c => c.isGroup && c.groupId === msg.groupId
        );
        if (conv) {
          conv.messages.push(msg);
          conv.lastMessage = msg.content;
          conv.time = msg.createdAt || new Date().toISOString();
          if (this.activeChat && this.activeChat.id === conv.id) {
            this.scrollToBottom();
          } else {
            conv.unread = (conv.unread || 0) + 1;
          }
        } else {
          this.loadData();
        }
      });

      this.socket.on('user_online', (userId) => {
        this.onlineUsers = new Set([...this.onlineUsers, userId]);
      });

      this.socket.on('user_offline', (userId) => {
        const s = new Set(this.onlineUsers);
        s.delete(userId);
        this.onlineUsers = s;
      });

      this.socket.on('friend_request', () => {
        this.showToastMsg('You received a new friend request!');
        api('GET', '/api/friends/pending').then(data => {
          if (data) this.friendRequests = data;
        });
      });

      // Typing indicators (store on conversation for template use)
      this.socket.on('typing', ({ userId }) => {
        const conv = this.conversations.find(c => c.userId === userId);
        if (conv) conv.typing = true;
      });
      this.socket.on('stop_typing', ({ userId }) => {
        const conv = this.conversations.find(c => c.userId === userId);
        if (conv) conv.typing = false;
      });
    },

    // ---- Data loading -------------------------------------------------

    /** Fetch contacts, conversations and pending friend requests */
    async loadData() {
      const [contactsData, convsData, reqsData] = await Promise.all([
        api('GET', '/api/friends'),
        api('GET', '/api/messages/conversations'),
        api('GET', '/api/friends/pending')
      ]);

      if (contactsData) this.contacts = contactsData;
      if (reqsData) this.friendRequests = reqsData;
      if (convsData) {
        this.conversations = convsData.map(c => ({
          id: c.id || c._id || (c.isGroup ? `g_${c.groupId}` : `u_${c.userId}`),
          name: c.name || c.nickname || 'Unknown',
          isGroup: !!c.isGroup,
          userId: c.userId || null,
          groupId: c.groupId || null,
          unread: c.unread || 0,
          time: c.updatedAt || c.time || '',
          lastMessage: c.lastMessage || '',
          messages: [],
          memberCount: c.memberCount || 0
        }));
      }
    },

    // ---- Conversation -------------------------------------------------

    /** Open a conversation and load its message history */
    async openConversation(conv) {
      this.activeChat = conv;
      this.mobileShowChat = true;
      conv.unread = 0;

      const url = conv.isGroup
        ? `/api/messages/group/${conv.groupId}`
        : `/api/messages/conversation/${conv.userId}`;

      const data = await api('GET', url);
      if (data) {
        conv.messages = data;
        this.scrollToBottom();
      }
    },

    /** Send a text message in the active conversation */
    sendMessage() {
      if (!this.messageText.trim() || !this.activeChat) return;
      const text = this.messageText.trim();
      this.messageText = '';

      const msg = {
        content: text,
        senderId: this.user.id,
        senderName: this.user.nickname || this.user.username,
        createdAt: new Date().toISOString()
      };

      if (this.activeChat.isGroup) {
        this.socket.emit('send_group_message', {
          groupId: this.activeChat.groupId,
          content: text
        }, (ack) => {
          if (ack && ack.id) msg.id = ack.id;
        });
      } else {
        this.socket.emit('send_message', {
          receiverId: this.activeChat.userId,
          content: text
        }, (ack) => {
          if (ack && ack.id) msg.id = ack.id;
        });
      }

      // Optimistically add the message locally
      this.activeChat.messages.push(msg);
      this.activeChat.lastMessage = text;
      this.activeChat.time = msg.createdAt;
      this.scrollToBottom();
    },

    /** Start (or resume) a 1-on-1 chat with a contact */
    startChatWith(contact) {
      let conv = this.conversations.find(
        c => !c.isGroup && c.userId === contact.id
      );
      if (!conv) {
        conv = {
          id: `u_${contact.id}`,
          name: contact.nickname || contact.username,
          isGroup: false,
          userId: contact.id,
          groupId: null,
          unread: 0,
          time: '',
          lastMessage: '',
          messages: [],
          memberCount: 0
        };
        this.conversations.unshift(conv);
      }
      this.showPanel = null;
      this.openConversation(conv);
    },

    // ---- Friends ------------------------------------------------------

    /** Search for users by keyword */
    async searchFriend() {
      if (!this.friendSearch.trim()) return;
      this.searchResults = [];
      this.searchNoResult = false;
      const data = await api(
        'GET',
        `/api/friends/search?keyword=${encodeURIComponent(this.friendSearch)}`
      );
      if (data && data.length) {
        this.searchResults = data;
      } else {
        this.searchNoResult = true;
      }
    },

    /** Send a friend request */
    async addFriend(userId) {
      await api('POST', '/api/friends/request', { userId });
      this.showToastMsg('Friend request sent!');
    },

    /** Accept a pending friend request */
    async acceptRequest(requestId) {
      await api('PUT', `/api/friends/accept/${requestId}`);
      this.friendRequests = this.friendRequests.filter(r => r.id !== requestId);
      this.showToastMsg('Friend request accepted');
      this.loadData();
    },

    /** Reject a pending friend request */
    async rejectRequest(requestId) {
      await api('PUT', `/api/friends/reject/${requestId}`);
      this.friendRequests = this.friendRequests.filter(r => r.id !== requestId);
      this.showToastMsg('Friend request rejected');
    },

    // ---- Groups -------------------------------------------------------

    /** Create a new group chat */
    async createGroup() {
      if (!this.newGroupName.trim()) return;
      const data = await api('POST', '/api/groups', {
        name: this.newGroupName,
        description: this.newGroupDesc,
        members: [...this.groupMembers]
      });
      if (data) {
        this.showToastMsg('Group created!');
        this.newGroupName = '';
        this.newGroupDesc = '';
        this.groupMembers = new Set();
        this.showPanel = null;
        this.loadData();
      }
    },

    /** Toggle a contact's membership in the group being created */
    toggleGroupMember(id) {
      const s = new Set(this.groupMembers);
      if (s.has(id)) {
        s.delete(id);
      } else {
        s.add(id);
      }
      this.groupMembers = s;
    },

    // ---- UI helpers ---------------------------------------------------

    /** Show a temporary toast notification */
    showToastMsg(msg) {
      this.toast = msg;
      setTimeout(() => { this.toast = null; }, 3000);
    },

    /** Scroll the messages container to the bottom */
    scrollToBottom() {
      this.$nextTick(() => {
        const el = this.$refs.messagesContainer || document.querySelector('.chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
      });
    },

    // ---- User Profile -------------------------------------------------

    /** View a user's profile by ID (clicking avatar in group chat) */
    async viewUserProfile(userId) {
      if (!userId) return;
      try {
        const data = await api('GET', `/api/auth/user/${userId}`);
        if (data && (data.user || data.id)) {
          this.viewingUser = data.user || data;
          this.showPanel = 'userProfile';
        }
      } catch (e) {
        this.showToastMsg('无法加载用户资料');
      }
    },

    /** Check if a user is already a friend */
    isAlreadyFriend(userId) {
      return this.contacts.some(c => c.id === userId);
    },

    /** Start chat with a user from profile modal */
    startChatWithUser(u) {
      const contact = { id: u.id, nickname: u.nickname, username: u.username };
      this.showPanel = null;
      this.viewingUser = null;
      this.startChatWith(contact);
    },

    // ---- Media Upload -------------------------------------------------

    /** Upload an image or video file and send as a media message */
    async uploadMedia(event) {
      const file = event.target.files[0];
      if (!file || !this.activeChat) return;
      // Reset the input so the same file can be re-selected
      event.target.value = '';

      // Validate size (20MB max)
      if (file.size > 20 * 1024 * 1024) {
        this.showToastMsg('文件大小不能超过 20MB');
        return;
      }

      const isVideo = file.type.startsWith('video/');
      const isImage = file.type.startsWith('image/');
      if (!isVideo && !isImage) {
        this.showToastMsg('仅支持图片和视频文件');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const token = localStorage.getItem('chat_token') || '';
        const res = await fetch('/api/messages/upload', {
          method: 'POST',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: formData
        });
        const data = await res.json();
        if (!res.ok) {
          this.showToastMsg(data.message || '上传失败');
          return;
        }

        const mediaUrl = data.url || data.fileUrl;
        const msgType = isVideo ? 'video' : 'image';

        // Build the message to send via socket
        const msg = {
          type: msgType,
          content: mediaUrl,
          mediaUrl: mediaUrl,
          senderId: this.user.id,
          senderName: this.user.nickname || this.user.username,
          createdAt: new Date().toISOString()
        };

        if (this.activeChat.isGroup) {
          this.socket.emit('send_group_message', {
            groupId: this.activeChat.groupId,
            content: mediaUrl,
            type: msgType
          }, (ack) => {
            if (ack && ack.id) msg.id = ack.id;
          });
        } else {
          this.socket.emit('send_message', {
            receiverId: this.activeChat.userId,
            content: mediaUrl,
            type: msgType
          }, (ack) => {
            if (ack && ack.id) msg.id = ack.id;
          });
        }

        // Optimistically add the message locally
        this.activeChat.messages.push(msg);
        this.activeChat.lastMessage = msgType === 'image' ? '[图片]' : '[视频]';
        this.activeChat.time = msg.createdAt;
        this.scrollToBottom();
      } catch (e) {
        this.showToastMsg('上传失败，请重试');
      }
    },

    /** Open lightbox for fullscreen image viewing */
    openLightbox(url) {
      this.lightboxUrl = url;
    },

    // ---- Group Settings -----------------------------------------------

    /** Open group settings panel and load data */
    async openGroupSettings() {
      if (!this.activeChat || !this.activeChat.isGroup) return;
      const groupId = this.activeChat.groupId;

      try {
        const [groupData, membersData, requestsData] = await Promise.all([
          api('GET', `/api/groups/${groupId}`),
          api('GET', `/api/groups/${groupId}/members`),
          api('GET', `/api/groups/${groupId}/join-requests`).catch(() => [])
        ]);

        const group = groupData?.group || groupData || {};
        const members = membersData?.members || membersData || [];
        const requests = requestsData || [];

        const isOwner = group.ownerId === this.user.id ||
                        members.some(m => m.id === this.user.id && m.role === 'owner');
        const isAdmin = members.some(m => m.id === this.user.id && m.role === 'admin');

        this.groupSettings = {
          id: groupId,
          name: group.name || this.activeChat.name,
          description: group.description || '',
          approval_required: !!group.approval_required,
          isOwner,
          isAdmin,
          members
        };
        this.joinRequests = requests;
        this.showPanel = 'groupSettings';
      } catch (e) {
        this.showToastMsg('无法加载群组设置');
      }
    },

    /** Toggle the approval_required setting for a group */
    async toggleApproval() {
      if (!this.groupSettings) return;
      const newValue = !this.groupSettings.approval_required;
      try {
        await api('PUT', `/api/groups/${this.groupSettings.id}/settings`, {
          approval_required: newValue
        });
        this.groupSettings.approval_required = newValue;
        this.showToastMsg(newValue ? '已开启加入审批' : '已关闭加入审批');
      } catch (e) {
        this.showToastMsg('设置更新失败');
      }
    },

    /** Set a member's role in the group (admin/member) */
    async setMemberRole(userId, role) {
      if (!this.groupSettings) return;
      try {
        await api('PUT', `/api/groups/${this.groupSettings.id}/members/${userId}/role`, { role });
        // Update local state
        const member = this.groupSettings.members.find(m => m.id === userId);
        if (member) member.role = role;
        this.showToastMsg(role === 'admin' ? '已设为管理员' : '已取消管理员');
      } catch (e) {
        this.showToastMsg('操作失败');
      }
    },

    /** Approve a join request */
    async approveJoinRequest(requestId) {
      if (!this.groupSettings) return;
      try {
        await api('PUT', `/api/groups/${this.groupSettings.id}/join-requests/${requestId}/approve`);
        this.joinRequests = this.joinRequests.filter(r => r.id !== requestId);
        this.showToastMsg('已通过申请');
        // Refresh members
        const membersData = await api('GET', `/api/groups/${this.groupSettings.id}/members`);
        if (membersData) {
          this.groupSettings.members = membersData.members || membersData;
        }
      } catch (e) {
        this.showToastMsg('操作失败');
      }
    },

    /** Reject a join request */
    async rejectJoinRequest(requestId) {
      if (!this.groupSettings) return;
      try {
        await api('PUT', `/api/groups/${this.groupSettings.id}/join-requests/${requestId}/reject`);
        this.joinRequests = this.joinRequests.filter(r => r.id !== requestId);
        this.showToastMsg('已拒绝申请');
      } catch (e) {
        this.showToastMsg('操作失败');
      }
    }
  }
});

app.mount('#app');
