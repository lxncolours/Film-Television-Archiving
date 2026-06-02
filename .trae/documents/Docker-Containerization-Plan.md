# Docker 容器化改造计划

## 当前架构分析

```
┌─────────────────────────────────────────────────────────┐
│                    当前架构                               │
├─────────────────────────────────────────────────────────┤
│  前端 (index.html, annual-summary.html)                  │
│           │                                              │
│           ▼                                              │
│  后端 (Express.js)  ────────►  MySQL 数据库              │
│           │                      (端口 3306)               │
│           │                                              │
│           ▼                                              │
│  Redis 缓存                                             │
│  (端口 6379)                                            │
└─────────────────────────────────────────────────────────┘
```

## 依赖分析

| 组件 | 现状 | Docker 化必要性 |
|------|------|----------------|
| Node.js 应用 | ✅ 已有 package.json | 必须 |
| MySQL | ✅ 依赖环境变量 | 必须 |
| Redis | ⚠️ 断开连接时可能崩溃 | 可选（建议保留） |
| 前端静态文件 | ✅ 已集成在 Express | 无需改动 |

## 改造工作量评估

### 预估改造量：**中等** (~2-4 小时)

### 需要创建的文件

| 文件 | 复杂度 | 说明 |
|------|--------|------|
| `Dockerfile` | 低 | Node.js 应用容器化 |
| `docker-compose.yml` | 中 | 服务编排（Node + MySQL + Redis） |
| `.dockerignore` | 低 | 排除不必要的文件 |
| `scripts/init-db.sql` | 低 | SQL 建表脚本（可选） |

### 需要修改的代码

| 文件 | 修改内容 | 复杂度 |
|------|----------|--------|
| `server/redis.js` | Redis 连接失败时优雅降级 | 低 |
| `server/server.js` | 启动时等待 MySQL 就绪 | 低 |
| `package.json` | 添加 Docker 相关脚本 | 低 |

## 详细改造计划

### Phase 1: 创建 Docker 配置文件

1. **创建 `Dockerfile`**
   - 基于 Node.js 18/20 Alpine 镜像
   - 设置工作目录和端口
   - 复制 package.json 和依赖安装
   - 复制应用代码
   - 暴露端口 3000
   - 启动命令

2. **创建 `docker-compose.yml`**
   - `app` 服务：Node.js 应用
   - `db` 服务：MySQL 8.0
   - `redis` 服务：Redis 7（可选）
   - 网络配置
   - 卷配置（数据持久化）

3. **创建 `.dockerignore`**
   - 排除 node_modules
   - 排除 .git
   - 排除 .env
   - 排除临时文件

### Phase 2: 代码适配

1. **修改 `server/redis.js`**
   ```javascript
   // 当前：连接失败可能导致崩溃
   // 修改后：连接失败时静默降级，不影响主功能
   ```

2. **修改 `server/server.js`**
   ```javascript
   // 添加启动延迟，确保 MySQL 已就绪
   // 添加健康检查端点
   ```

### Phase 3: 环境配置

1. **创建 `docker-compose.yml` 中的环境变量配置**
   - MySQL 初始化密码
   - 数据库名称
   - TMDB API Key（可选）
   - Redis 配置

2. **创建 `.env.docker` 或使用 docker-compose 环境变量**

### Phase 4: 测试验证

1. 验证 Docker 构建成功
2. 验证 docker-compose up 启动所有服务
3. 验证数据持久化
4. 验证前端功能正常

## Docker 化后的架构

```
┌──────────────────────────────────────────────────────────────┐
│                    Docker Compose                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    │
│  │   app       │───►│   mysql     │    │   redis     │    │
│  │  (Node.js)  │    │   (MySQL)   │    │  (Redis)   │    │
│  │  :3000      │    │   :3306     │    │  :6379     │    │
│  └──────┬──────┘    └─────────────┘    └─────────────┘    │
│         │                                                  │
│         │  /api/movies                                     │
│         ▼                                                  │
│  ┌─────────────┐                                           │
│  │   浏览器    │                                           │
│  │  localhost  │                                           │
│  └─────────────┘                                           │
│                                                              │
│  volumes:                                                   │
│    - mysql_data:/var/lib/mysql                             │
│    - redis_data:/data                                      │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## 使用方式对比

### 当前方式
```bash
# 需要手动安装 MySQL 和 Redis
# 配置环境变量
# 启动各个服务
npm start
```

### Docker 化后
```bash
# 一键启动所有服务
docker-compose up -d

# 一键停止
docker-compose down

# 数据持久化，无需担心数据丢失
```

## 文件清单

### 新增文件
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `docker-compose.example.yml` (示例配置)

### 修改文件
- `server/redis.js` - 优雅降级处理
- `server/server.js` - 健康检查
- `.gitignore` - 添加 Docker 相关忽略规则

### 可选新增
- `scripts/init-db.sql` - SQL 建表脚本
- `scripts/backup.sh` - 数据库备份脚本

## 风险点

1. **数据持久化**：确保 MySQL 和 Redis 数据正确挂载
2. **首次启动慢**：MySQL 初始化需要时间，需添加等待逻辑
3. **Windows 兼容**：Docker Desktop on Windows 可能有一些差异
4. **外部 API 依赖**：TMDB API 在容器内仍需网络访问

## 结论

改造量：**中等**

主要工作集中在创建 Docker 配置文件，代码改动较少。现有的环境变量配置已经为 Docker 化做好了准备。
