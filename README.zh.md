# Archon Ops

管理 Dynatrace 多租户环境的内部 UI：队列并执行 [Monaco CLI](https://github.com/Dynatrace/dynatrace-configuration-as-code) 命令（`deploy` / `download`），并将每个客户端/环境的备份版本化保存在本地 Git 仓库中，无需依赖任何外部服务。

关于功能细节和架构，请参阅 `specs/requirements.md`、`specs/design.md` 和 `specs/tasks.md`。

## ⚠️ 免责声明 (Disclaimer)

本软件按 **"原样" (AS IS)** 提供，不提供任何明示或暗示的保证。使用本软件即表示您同意以下内容：

- **部署 (deploy) 操作会覆盖真实配置** 并在您的 Dynatrace 环境中应用它们。如果您不清楚自己在做什么，这些操作可能会修改现有配置、导致配置不一致或损坏配置。在进行任何实际部署之前，系统都会要求进行双重确认，但**执行操作的责任完全由操作员承担**。
- 作者和贡献者对于因使用本工具而导致的配置丢失、监控中断、消费成本或任何其他直接或间接损失**不承担任何责任**。
- 在实际部署之前，请务必执行一次 **试运行 (dry-run)** 并查看完整日志。保持相关环境的最新备份（虽然本工具提供了备份功能，但验证备份的有效性是操作员的责任）。
- 本工具**不是 Dynatrace 的官方产品**，也不隶属于 Dynatrace LLC。Monaco CLI 和所使用的 API 均归其各自所有者所有，请在使用前查看其使用条款。

在对生产环境进行操作之前，请先在测试环境中进行验证并确认您的工作流程。

## 要求

- Node.js 20.19+ / 22.12+ (推荐；参见下方的兼容性说明)
- 伺服器/机器上已安装 Git
- **Dynatrace Monaco CLI (v2)** 二进制文件已安装且已添加到系统的 `PATH` 中（或者在 `.env` 中配置 `MONACO_BIN_PATH` 为其绝对路径）。

### 安装 Monaco CLI

#### 在 Windows (PowerShell) 下：
1. 从 [Dynatrace Releases 页面](https://github.com/dynatrace/dynatrace-configuration-as-code/releases) 下载可执行文件：
   ```powershell
   # 下载最新的稳定版本 (以 Windows amd64 为例)
   Invoke-WebRequest -Uri "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-windows-amd64.exe" -OutFile "C:\dynatrace\monaco.exe"
   ```
2. 将 `C:\dynatrace\` 添加到系统环境变量 (`PATH`) 中，或者在你的 `.env` 文件中定义其绝对路径：
   ```env
   MONACO_BIN_PATH="C:\\dynatrace\\monaco.exe"
   ```

#### 在 Linux / macOS (Bash) 下：
1. 下载并赋予执行权限：
   ```bash
   # 下载适用于 Linux amd64 的版本
   sudo curl -L "https://github.com/dynatrace/dynatrace-configuration-as-code/releases/latest/download/monaco-linux-amd64" -o /usr/local/bin/monaco
   sudo chmod +x /usr/local/bin/monaco
   ```
2. 如果您更倾向于将其保存在用户目录下，请记得在 `.env` 中进行配置：
   ```env
   MONACO_BIN_PATH="/home/user/bin/monaco"
   ```

> **兼容性说明：** 本项目是在 Node 20.16 环境下初始化和测试的。如果您的 Node 版本是 20.16 或类似版本，请使用已安装的 `prisma@6`/`@prisma/client@6` 版本，Prisma 7+ 版本需要 Node 20.19+。

## 安装（本地运行，单用户）

```bash
npm install
cp .env.example .env
# 编辑 .env：至少修改 ENCRYPTION_KEY 和 SEED_ADMIN_PASSWORD。
# 可以使用以下命令生成 ENCRYPTION_KEY：
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npx prisma migrate dev
npx prisma db seed   # 创建管理员用户 (SEED_ADMIN_EMAIL/PASSWORD)

# 启动开发服务器（默认端口 3000，或指定自定义端口）
PORT=3080 npm run dev
```

打开 http://localhost:3000 （或您指定的端口），使用初始化的管理员账号登录，并创建您的第一个客户端与环境。

## 服务器运行（多客户端及持久化运行）

1. 将 `prisma/schema.prisma` 中的 `datasource.provider` 修改为 `"postgresql"` 并配置 `.env` 中的 `DATABASE_URL` 连接到您的 Postgres 数据库。
2. 将 `DATA_DIR` 定义为服务器上的持久化目录（例如独立磁盘），用于保存每个客户端/环境的 Git 仓库。
3. 编译生产版本：
   ```bash
   npm run build
   ```
4. **使用 PM2 运行**：
   项目根目录下已包含可直接使用的 `ecosystem.config.js` 配置文件。您可以全局安装 PM2 并轻松启动应用：
   ```bash
   # 全局安装 PM2 (如尚未安装)
   npm install -g pm2

   # 启动应用（默认将在配置文件或环境变量指定的端口启动）
   pm2 start ecosystem.config.js

   # 如果您希望在启动时动态修改端口：
   PORT=4000 pm2 restart archon-ops --update-env
   ```
   *注意：任务执行 Worker 运行在 Next.js 服务同一个 Node 进程中，不需要额外的 Redis 或队列服务。*

## 运行机制

- **Deploy/Backup（部署/备份）** 操作在环境的 UI 页面上触发，并向数据库中写入一条 `Job` 记录（命令不会直接在当前的 HTTP 请求中执行）。
- 内部 Worker 线程 (`lib/server/worker.ts`) 会轮询获取状态为 `PENDING` 的任务，通过 `child_process.spawn` 调用并执行 `monaco` 命令（将令牌作为环境变量传入，不打印在日志中），并通过 Server-Sent Events (`/api/jobs/:id/stream`) 将实时日志推送到前端页面上。
- 在备份（或部署）成功完成后，系统会自动在当前环境的本地 Git 仓库（`DATA_DIR/<client>/<environment>`）中创建一次自动提交 — 此仓库无远端配置，仅用于本地版本历史回溯。
- 所有的 Dynatrace 令牌均使用 AES-256-GCM 算法加密存储，并在保存日志前将敏感令牌信息擦除。

## Dynatrace 权限 (令牌与 Scopes)

每个环境最多使用 **三种不同的凭证**，每项功能只请求其需要的权限。如果某个板块返回 `403`，说明相应的凭证缺少本表中所列的 scope。在编辑环境的表单中，每个凭证都提供了一个 **Test（测试）** 按钮，以便在保存前验证权限。

| 凭证类型 | 应用于 | 所需的 Scopes / 权限 |
|---|---|---|
| **传统 API 令牌** (`Api-Token`) | Monaco: `download` 和 `deploy` | `ReadConfig`, `settings.read` (备份) · `WriteConfig`, `settings.write` (部署) |
| **Platform 令牌** (`dt0s16`) — 仪表板 | 仪表板管理 (Document API) | `document:documents:read`, `document:documents:write`, `document:documents:admin` |
| **Platform 令牌** (`dt0s16`) — Lookups | 上传/列表/下载/删除 Grail 文件 (Grail Resource Store) | `storage:files:read`, `storage:files:write`, `storage:files:delete`, `storage:buckets:read`, `storage:system:read` |
| **账户 OAuth 客户端** (`dt0s02`) | 解析 SSO id → email (Account API) | `account-idm-read` |

> 每一个环境的 Platform 令牌是**唯一的**：只要该令牌同时具备上述两组权限，同一个令牌就可以同时管理仪表板和 Lookups。

### ⚠️ Platform 令牌具备“双重限制”

对于 Platform 令牌，仅在创建时勾选对应的 scopes 是不够的。其**有效权限**为以下两者的交集：

```
有效权限 = (令牌 scopes)  ∩  (令牌所有者用户的 IAM 策略权限)
```

也就是说，除了令牌自身的 scopes，**创建该令牌的用户所在的组在 Dynatrace 平台上的 IAM 策略**也必须授予这些权限。对于 Grail 文件，该策略必须包括（可根据需要调整路径 boundary 限制）：

```
ALLOW storage:files:read, storage:files:write, storage:files:delete
WHERE storage:file-path startsWith "/lookups/";
ALLOW storage:buckets:read;
ALLOW storage:system:read;
```

遇到 `403` 权限不足（即使令牌中勾选了对应的 scope）的常见原因：

- **Platform 令牌在创建后无法追加新的 scopes。** 如果修改了权限，请重新生成令牌并更新环境配置。
- 令牌是以**其创建者**的身份执行的。如果策略配置在某个组中，但令牌所有者不在该组内，则该策略不生效。
- 策略中的 **boundary**（根据路径或环境限制）未匹配会导致静默拒绝：请确认其包含了当前环境与 `/lookups/` 路径。

Lookups 页面上的 **Test** 按钮将分别汇报读取和写入的测试结果（`read` / `write`），以便精确排查缺失的权限。

## 目录结构

有关详细的目录结构，请参阅 `specs/design.md` 的第 7 节（`app/`、`lib/`、`prisma/`）。
