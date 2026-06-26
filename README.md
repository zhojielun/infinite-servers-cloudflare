# Infinite Servers - Cloudflare Edition

基于 Cloudflare 平台的服务器集群监控工具。全平台部署在 Cloudflare Edge，无需自建服务器。

[English Documentation](./README_EN.md)

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                       │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │   Pages      │    │         Workers               │  │
│  │   React/Vite │◄──►│  TypeScript + Hono            │  │
│  └──────────────┘    └──────────────────────────────┘  │
│         │                       │                       │
│         │              ┌────────────────┐              │
│         │              │   D1 + KV      │              │
│         │              └────────────────┘              │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              Agent (被监控服务器，Bash 脚本)                │
└─────────────────────────────────────────────────────────┘
```

- **前端**: React + Vite → Cloudflare Pages
- **后端**: TypeScript + Hono → Cloudflare Workers
- **数据**: D1 (SQLite) + KV (配置)

---

## 快速部署

### 1. 创建 D1 数据库

Dashboard → Storage & Databases → D1 → 创建数据库 → 进入控制台，执行 SQL：

```sql
CREATE TABLE IF NOT EXISTS server_info (server TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS server_status (server TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS history (server TEXT NOT NULL, ts INTEGER NOT NULL, load1 REAL, mem_pct REAL, disk_pct REAL, net_rx INTEGER, net_tx INTEGER, cpu_pct REAL, swap_pct REAL, PRIMARY KEY (server, ts));
CREATE TABLE IF NOT EXISTS login_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL, success INTEGER NOT NULL DEFAULT 0, password_hash TEXT);
CREATE INDEX IF NOT EXISTS idx_login_logs_ip_ts ON login_logs(ip, ts);
CREATE TABLE IF NOT EXISTS ip_bans (ip TEXT PRIMARY KEY, banned_until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_ts ON rate_limits(ip, ts);
```

### 2. 创建 KV 命名空间

Dashboard → KV → 创建命名空间 `CONFIG`

### 3. 上传配置到 KV

进入 `CONFIG` → **查看数据** → **添加条目**：

**config.json**（直接复制，改密码即可）：

```json
{
  "password": "修改为你的密码",
  "sse": false,
  "interval": 5,
  "history-interval": 1,
  "history-days": 30,
  "cors-origins": "*.pages.dev,*.workers.dev",
  "telegram": { "enabled": false, "bot_token": "", "chat_id": "" }
}
```

**servers.json**（安装 Agent 后替换 token）：

```json
{
  "servers": {
    "My Server": {
      "region": "CN",
      "location": "Beijing",
      "tags": ["Production"],
      "token": "安装Agent后替换此值"
    }
  }
}
```

### 4. 创建 Worker + 绑定

1. Workers & Pages → 创建 Worker → 名称 `infinite-servers`
2. 设置 → 绑定 → 添加 D1（名称 `DB`）+ KV（名称 `CONFIG`）
3. 设置 → 触发器 → Cron Triggers → 添加 `0 0 * * *`

部署 Worker（需要 TypeScript 构建，通过 GitHub 集成或本地上传）：

```bash
cd worker && npm install && npx wrangler deploy
```

### 5. 部署前端

```bash
npm ci
VITE_API_BASE="https://your-worker.workers.dev/" VITE_ASSET_BASE=/ npm run build
npx wrangler pages deploy dist --project-name=infinite-servers-dashboard
```

> 自定义域名？在 KV `config.json` 的 `cors-origins` 中添加域名。

---

## Agent 部署

在被监控服务器上一键安装：

```bash
curl -fsSL https://raw.githubusercontent.com/zhojielun/infinite-servers-cloudflare/master/scripts/install-agent.sh | sudo bash
```

交互输入（也可通过环境变量跳过）：

| 参数 | 环境变量 | 说明 |
|------|----------|------|
| Server name | `AGENT_NAME` | 必须与 servers.json 中的 key 一致 |
| Dashboard URL | `DASHBOARD_URL` | Worker 地址 |
| Token | `AGENT_TOKEN` | 留空自动生成 |
| Push interval | `AGENT_INTERVAL` | 上报间隔秒数，默认 15 |
| Report IP | `AGENT_REPORT_IP` | `y`/`n`，是否上报公网 IP |
| Region | `AGENT_REGION` | 地区代码，如 `CN`、`US`（可选） |
| Location | `AGENT_LOCATION` | 位置名称，默认主机名（可选） |

管理命令：

```bash
sudo systemctl status infinite-agent-{server-name}
sudo systemctl restart infinite-agent-{server-name}
sudo journalctl -u infinite-agent-{server-name} -f
```

---

## 配置参数

### config.json

所有配置通过 KV 管理，修改后立即生效。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `password` | 无 | 登录密码，不设置跳过认证 |
| `sse` | `false` | SSE 实时推送 |
| `interval` | `5` | SSE 推送间隔（秒） |
| `history-interval` | `1` | 历史写入间隔（分钟），最小 0.5 |
| `history-days` | `30` | 历史保留天数 |
| `cors-origins` | `*.pages.dev,*.workers.dev` | CORS 白名单 |
| `telegram.enabled` | `false` | Telegram 到期提醒 |
| `telegram.bot_token` | `""` | Bot Token |
| `telegram.chat_id` | `""` | Chat ID |

### servers.json

| 参数 | 必填 | 说明 |
|------|------|------|
| `token` | 是 | Agent 推送令牌 |
| `region` | 否 | 国家代码，显示国旗 |
| `location` | 否 | 位置名称 |
| `tags` | 否 | 标签数组 |
| `ip_mask` | 否 | IP 遮罩，如 `x.x.*.*` |
| `expiry` | 否 | 到期日期 `YYYY-MM-DD` |
| `purchase_date` | 否 | 购买日期 `YYYY-MM-DD` |

> `expiry` 和 `purchase_date` 可通过 Dashboard 按钮设置（写入 `server_settings.json`），也可在 KV 中直接编辑。

### server_settings.json

Worker 自动管理，存储按钮设置的到期/购买时间和 Telegram 通知状态。用户无需手动编辑。

---

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/status?sse=1` | GET | SSE 实时推送 |
| `/status` | GET | 当前状态 JSON |
| `/servers` | GET | 硬件信息 |
| `/history` | GET | 历史数据 |
| `/availability` | GET | 可用性统计 |
| `/push` | POST | Agent 推送 |
| `/set-expiry` | POST | 设置到期时间 |
| `/set-purchase-date` | POST | 设置购买时间 |
| `/login` | POST | 登录 |
| `/logout` | GET | 登出 |

---

## 本地开发

```bash
# 前端
npm ci && npm run dev

# Worker（单独终端）
cd worker && npm install && npx wrangler dev

# Worker 类型检查
cd worker && npm run typecheck
```

---

## License

MIT License
