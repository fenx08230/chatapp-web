---
title: ChatApp
emoji: 💬
colorFrom: green
colorTo: blue
sdk: docker
pinned: false
---

# ChatApp - 即时通讯应用

基于 **Node.js + Vue 3** 的全栈聊天应用。

## 功能特性

- **用户系统**: 注册、登录、个人资料编辑、头像上传
- **好友管理**: 搜索用户、发送好友请求、接受/拒绝请求
- **群组功能**: 创建群组、邀请成员、群聊、退出群组
- **实时聊天**: 基于 Socket.io 的实时消息收发
- **消息记录**: 聊天历史分页加载、未读消息计数
- **在线状态**: 实时显示好友在线/离线状态
- **输入提示**: 对方正在输入状态显示

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | UniApp (Vue 3 Composition API) |
| 后端框架 | Express.js |
| 实时通信 | Socket.io |
| 数据库 | SQLite (better-sqlite3) |
| 认证方式 | JWT (JSON Web Token) |
| 密码加密 | bcryptjs |

## 项目结构

```
chat-app/
├── server/                 # 后端服务
│   ├── app.js             # 主入口
│   ├── package.json       # 依赖配置
│   ├── models/
│   │   └── database.js    # 数据库模型
│   ├── middleware/
│   │   └── auth.js        # JWT 认证中间件
│   ├── routes/
│   │   ├── auth.js        # 用户认证接口
│   │   ├── friends.js     # 好友管理接口
│   │   ├── groups.js      # 群组管理接口
│   │   └── messages.js    # 消息记录接口
│   └── utils/
│       └── socket.js      # Socket.io 事件处理
├── client/                 # UniApp 前端
│   ├── manifest.json      # 应用配置
│   ├── pages.json         # 页面路由
│   ├── main.js            # 入口文件
│   ├── App.vue            # 根组件
│   ├── uni.scss           # 全局样式
│   ├── pages/             # 页面目录
│   │   ├── login/         # 登录注册
│   │   ├── chat/          # 会话列表
│   │   ├── chat-detail/   # 聊天详情
│   │   ├── contacts/      # 通讯录
│   │   ├── profile/       # 个人中心
│   │   ├── add-friend/    # 添加好友
│   │   ├── friend-requests/ # 好友请求
│   │   ├── groups/        # 群组列表
│   │   ├── group-create/  # 创建群组
│   │   └── group-detail/  # 群聊详情
│   ├── components/        # 公共组件
│   │   ├── MessageBubble.vue
│   │   ├── ChatInput.vue
│   │   ├── ContactItem.vue
│   │   └── ConversationItem.vue
│   ├── store/             # 状态管理
│   ├── utils/             # 工具函数
│   └── static/            # 静态资源
└── README.md
```

## 快速开始

### 1. 启动后端服务

```bash
cd server
npm install
node app.js
```

服务默认运行在 `http://localhost:3000`

### 2. 配置前端

编辑 `client/utils/api.js`，将 `BASE_URL` 修改为你的后端地址：

```javascript
const BASE_URL = 'http://你的服务器IP:3000/api'
```

编辑 `client/utils/socket.js`，修改 Socket 连接地址：

```javascript
const SOCKET_URL = 'http://你的服务器IP:3000'
```

### 3. 运行前端

需要安装 [HBuilderX](https://www.dcloud.io/hbuilderx.html)（DCloud 官方 IDE）：

1. 打开 HBuilderX
2. 导入 `client` 目录作为 UniApp 项目
3. 选择运行目标平台：
   - **H5**: 浏览器预览调试
   - **Android**: 连接 Android 设备或模拟器
   - **iOS**: 需要 Mac + Xcode
   - **鸿蒙**: 需要 DevEco Studio

### 4. 编译发布

```bash
# 通过 HBuilderX 菜单: 发行 -> 各平台
# 或使用 CLI:
npm install -g @dcloudio/uni-cli
uni build -p app        # 打包 App (Android/iOS)
uni build -p h5         # 打包 H5
uni build -p harmony    # 打包鸿蒙
```

## API 接口文档

### 认证接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/auth/register | 用户注册 |
| POST | /api/auth/login | 用户登录 |
| GET | /api/auth/profile | 获取个人资料 |
| PUT | /api/auth/profile | 更新个人资料 |

### 好友接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/friends | 好友列表 |
| POST | /api/friends/request | 发送好友请求 |
| GET | /api/friends/pending | 待处理请求 |
| PUT | /api/friends/accept | 接受好友请求 |
| PUT | /api/friends/reject | 拒绝好友请求 |

### 群组接口
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/groups | 创建群组 |
| GET | /api/groups | 我的群组 |
| GET | /api/groups/:id | 群组详情 |
| GET | /api/groups/:id/members | 群成员列表 |
| POST | /api/groups/:id/join | 加入群组 |
| POST | /api/groups/:id/leave | 退出群组 |

### 消息接口
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/messages/conversations | 会话列表 |
| GET | /api/messages/conversation/:userId | 私聊记录 |
| GET | /api/messages/group/:groupId | 群聊记录 |

## 生产部署建议

1. **数据库**: 生产环境建议替换为 MySQL 或 PostgreSQL
2. **文件存储**: 头像/图片上传建议接入 OSS（如阿里云 OSS、腾讯云 COS）
3. **消息推送**: 集成 UniPush 实现离线消息推送
4. **HTTPS**: 配置 SSL 证书，使用 Nginx 反向代理
5. **环境变量**: 创建 `.env` 文件配置 JWT_SECRET 等敏感信息
6. **进程管理**: 使用 PM2 管理 Node.js 进程

## License

MIT
