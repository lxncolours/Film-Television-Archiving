# Film-Television-Archiving | 观影记录管理系统

一个自托管的影视记录管理应用，集成 TMDB 与豆瓣数据源，支持影片搜索、详情管理、年度统计、数据导入导出，适配 Docker 一键部署。

## 功能特性

- **影片管理** — 添加、编辑、删除观影记录，支持评分、标记状态、自定义备注
- **TMDB 集成** — 通过标题搜索并自动获取影片详情、海报、演员、简介等元数据
- **豆瓣数据源** — 支持从豆瓣搜索影片信息并获取详情
- **年度统计** — 按年份汇总观影数据，生成年度观影报告（平台分布、评分统计、月度趋势）
- **数据导入导出** — 支持 JSON 格式全量导出/导入，CSV 数据迁移
- **海报代理** — 内置图片代理，自动防盗链 Referer，支持 TMDB 与豆瓣图片域名
- **代理配置** — 可视化代理设置，解决中国大陆 TMDB API 访问问题
- **Redis 缓存** — 基于 SCAN 的缓存失效机制，提升列表查询响应速度
- **后台任务** — 可选的后台海报批量获取任务

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js + Express 4 |
| 数据库 | MySQL 8.0 |
| 缓存 | Redis 7 |
| 前端 | 原生 HTML/CSS/JS 单页应用 |
| 容器 | Docker + Docker Compose |
| CI/CD | GitHub Actions（自动构建并推送镜像） |

## 快速开始

### 方式一：Docker Compose 部署（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/lxncolours/Film-Television-Archiving.git
cd Film-Television-Archiving

# 2. 设置 TMDB API Key 并启动
TMDB_API_KEY=your_key_here docker compose up -d

# 3. 查看启动日志，等待就绪
docker compose logs -f app
```

看到以下输出即启动成功：

```
Movie Archive Server v1.0.31 running at:
  Local:   http://localhost:5280
  Network: http://<your-ip>:5280
```

浏览器访问 `http://localhost:5280` 即可使用。

> **获取 TMDB API Key**：前往 [TMDB Settings](https://www.themoviedb.org/settings/api)，注册/登录后申请 Developer 类型 API Key。

### 方式二：本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填写数据库连接信息和 TMDB API Key

# 3. 初始化数据库
npm run init-db

# 4. 启动服务
npm start
```

<details>
<summary>本地开发环境要求</summary>

- Node.js 22+
- MySQL 8.0+
- Redis 7+

</details>

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `DB_HOST` | 是 | — | MySQL 主机地址 |
| `DB_USER` | 是 | — | MySQL 用户名 |
| `DB_PASSWORD` | 否 | — | MySQL 密码 |
| `DB_NAME` | 是 | — | 数据库名 |
| `REDIS_HOST` | 否 | `127.0.0.1` | Redis 主机地址 |
| `REDIS_PORT` | 否 | `6379` | Redis 端口 |
| `TMDB_API_KEY` | 是 | — | TMDB API 密钥 |
| `ENCRYPTION_KEY` | 否 | — | 加密密钥（AES-256-GCM，用于加密存储 TMDB Key 和代理配置） |
| `PORT` | 否 | `5280` | 服务端口 |
| `CORS_ORIGINS` | 否 | （同源） | 允许的跨域来源，逗号分隔 |
| `APP_VERSION` | 否 | `latest` | Docker 镜像版本标签 |

> ⚠️ **重要**：`ENCRYPTION_KEY` 一旦设置后不可更改——TMDB API Key 和代理配置使用此密钥加密存储在数据库中，密钥变更将导致已加密数据无法解密。

## Docker 镜像

镜像在每次推送到 `master` 分支时由 GitHub Actions 自动构建：

| Registry | 镜像地址 |
|----------|----------|
| GitHub Container Registry | `ghcr.io/lxncolours/film-television-archiving:latest` |
| Docker Hub | `liberica/film-television-archiving:latest` |

支持版本标签（如 `v1.0.31`）和 `latest` 浮动标签。生产部署建议锁定版本号：

```bash
# 在 .env 中指定版本
APP_VERSION=v1.0.31

# 然后拉取更新
docker compose pull app
docker compose up -d app
```

## 项目结构

```
Film-Television-Archiving/
├── server/                  # 后端服务
│   ├── server.js            # Express 主入口
│   ├── routes/              # API 路由
│   │   ├── movies.js        # 影片 CRUD + 导入导出
│   │   ├── tmdb.js          # TMDB 搜索/详情/配置
│   │   └── douban.js        # 豆瓣搜索/详情
│   ├── tmdb.js              # TMDB API 客户端
│   ├── douban.js            # 豆瓣 API 客户端
│   ├── proxy-config.js      # 代理配置管理（加密存储）
│   ├── redis.js             # Redis 缓存 + SCAN 失效
│   ├── db.js                # MySQL 连接池
│   ├── background_tasks.js  # 后台海报获取任务
│   ├── init-db.js           # 数据库初始化脚本
│   ├── migrate-csv.js       # CSV 数据迁移脚本
│   └── utils/
│       ├── crypto.js        # AES-256-GCM 加解密
│       ├── settings.js      # 设置读写（DB + Redis 缓存）
│       ├── logger.js        # 日志工具
│       └── env.js           # 环境变量加载
├── index.html               # 主页面（单页应用）
├── annual-summary.html      # 年度统计页面
├── docker-compose.yml       # Compose 编排
├── Dockerfile               # 多阶段构建
├── docker-entrypoint.sh     # 容器入口脚本
├── .env.example             # 环境变量模板
├── .githooks/pre-commit     # 版本号自动递增钩子
└── DOCKER_SETUP.md          # 详细 Docker 部署文档
```

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/movies` | 影片列表（分页、搜索、筛选） |
| GET | `/api/movies/:id` | 影片详情 |
| POST | `/api/movies` | 添加影片 |
| PUT | `/api/movies/:id` | 编辑影片 |
| GET | `/api/movies/export` | 导出 JSON |
| POST | `/api/movies/import` | 导入 JSON |
| POST | `/api/movies/fetch-poster/:id` | 获取海报 |
| GET | `/api/movies/stats` | 统计信息 |
| GET | `/api/movies/annual/:year` | 年度统计 |
| POST | `/api/tmdb/detail` | TMDB 搜索并获取详情 |
| GET/POST | `/api/tmdb/config` | TMDB API Key 配置 |
| GET | `/api/douban/search` | 豆瓣搜索 |
| GET | `/api/douban/detail/:id` | 豆瓣详情 |
| GET/PUT | `/api/proxy/config` | 代理配置 |
| GET | `/api/proxy/image?url=` | 图片代理（SSRF 白名单） |
| GET | `/api/health` | 健康检查 |
| GET | `/api/network/info` | 网络信息 |

## 安全特性

| 措施 | 说明 |
|------|------|
| SSRF 防护 | 图片代理仅允许 TMDB / 豆瓣域名白名单 |
| XSS 防护 | 前端所有用户数据渲染前 HTML 转义 |
| 加密存储 | TMDB Key 与代理配置使用 AES-256-GCM 加密入库 |
| TLS 验证 | 代理请求始终验证 TLS 证书（`rejectUnauthorized: true`） |
| CORS | 默认同源，可配置跨域白名单 |
| 输入校验 | 分页参数 NaN 校验、导入数据字段长度/范围校验 |
| SQL 脱敏 | 数据库错误返回通用消息，不泄露 SQL 细节 |
| 静态文件保护 | 拦截 `/server/`、`.env`、`package.json` 等敏感路径 |
| Body 限制 | 请求体上限 300MB（覆盖大体积 JSON 导入场景） |

## 版本迭代机制

项目使用 Git pre-commit 钩子自动递增版本号（PATCH +1）：

```bash
# 首次 clone 后需启用钩子
git config core.hooksPath .githooks
```

之后每次 `git commit` 会自动将 `package.json` 的 `version` 递增（如 `1.0.31 → 1.0.32`），并自动暂存。推送到 `master` 后触发 CI 构建对应版本的 Docker 镜像。

## 常用命令

```bash
# Docker 操作
docker compose up -d              # 启动所有服务
docker compose logs -f app        # 查看应用日志
docker compose pull app           # 拉取最新镜像
docker compose down               # 停止（保留数据）
docker compose down -v            # 停止并删除数据（不可逆）

# 数据库
docker exec -it movie-archive-mysql mysql -u root -p movie_archive
docker exec movie-archive-mysql mysqldump -u root -p<PW> movie_archive > backup.sql

# 本地开发
npm start                         # 启动服务
npm run init-db                   # 初始化数据库
```

## 常见问题

<details>
<summary>启动后访问 502？</summary>

MySQL 尚未初始化完成，等待 10-20 秒后刷新。查看日志确认：`docker compose logs -f app`，看到 `running at:` 即就绪。
</details>

<details>
<summary>TMDB 接口报错/搜索不到结果？</summary>

中国大陆访问 TMDB API 需要代理。在前端设置页面配置代理地址（或通过 `PUT /api/proxy/config` 接口设置）。配置更改后需重启服务使缓存生效。
</details>

<details>
<summary>重启后 TMDB Key / 代理配置丢失？</summary>

如果 `.env` 中的 `ENCRYPTION_KEY` 被修改或删除，已加密的设置将无法解密。请确保 `ENCRYPTION_KEY` 保持不变。
</details>

## License

ISC
