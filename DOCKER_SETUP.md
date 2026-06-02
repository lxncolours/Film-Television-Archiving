# Docker Compose 部署教程

## 系统要求

| 软件 | 版本要求 |
|------|----------|
| Docker | 20.10+ |
| Docker Compose | 2.0+ |

### 检查是否已安装

```bash
docker --version
docker compose version
```

如果未安装，请前往 [Docker 官网](https://www.docker.com/products/docker-desktop/) 下载安装。

---

## 快速开始（5 分钟）

### 第一步：获取 TMDB API Key

本应用依赖 TMDB 获取影片信息，需要先申请 API Key：

1. 打开 [https://www.themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
2. 登录或注册 TMDB 账号
3. 申请 API Key（选择 Developer 类型即可）
4. 复制得到的密钥（形如 `a1b2c3d4e5f6...`）

### 第二步：启动应用

```bash
# 1. 进入项目目录
cd /path/to/Film-Television-Archiving

# 2. 一键启动（将 your_key 替换为你的 TMDB API Key）
TMDB_API_KEY=your_key_here docker compose up -d
```

首次启动会自动：
- 拉取 MySQL 8.0 和 Redis 7 镜像
- 构建 Node.js 应用镜像
- 启动所有服务并初始化数据库

### 第三步：访问应用

打开浏览器访问：**[http://localhost:5280](http://localhost:5280)**

---

## 部署架构

```
┌──────────────────────────────────────────────────────────┐
│                    docker-compose.yml                     │
│                                                          │
│  ┌──────────────────┐    ┌─────────────────────────┐     │
│  │   MySQL 8.0       │    │      Redis 7            │     │
│  │   容器内部 3306    │    │     容器内部 6379       │     │
│  │   宿主机  3307    │    │     宿主机  6380        │     │
│  │   ▲ 持久化卷      │    │   ▲ 持久化卷            │     │
│  └──────┬───────────┘    └──────┬──────────────────┘     │
│         │                       │                        │
│         └──────────┬────────────┘                        │
│                    │  app-network                         │
│         ┌──────────┴────────────┐                        │
│         │    Node.js 20 App     │                        │
│         │   容器内部 5280       │                        │
│         │   宿主机  5280       │                        │
│         │                      │                        │
│         │   启动流程：           │                        │
│         │   ① 等待 MySQL 就绪   │                        │
│         │   ② 初始化数据库      │                        │
│         │   ③ 启动 Web 服务     │                        │
│         └──────────────────────┘                        │
└──────────────────────────────────────────────────────────┘
```

### 服务说明

| 服务 | 镜像 | 容器名 | 宿主机端口 | 用途 |
|------|------|--------|-----------|------|
| `mysql` | mysql:8.0 | movie-archive-mysql | 3307 | 存储观影记录数据 |
| `redis` | redis:7-alpine | movie-archive-redis | 6380 | 缓存 API 响应 |
| `app` | 本地构建 | movie-archive-app | 5280 | Node.js Web 服务 |

> **为什么使用 3307/6380 而不是默认端口？**
> 避免与宿主机上可能已安装的 MySQL(3306) 和 Redis(6379) 冲突。

---

## 详细说明

### 1. 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `TMDB_API_KEY` | (必填) | TMDB API 密钥 |
| `MYSQL_ROOT_PASSWORD` | `root123` | MySQL root 密码 |
| `PORT` | `5280` | Web 服务端口 |

### 2. 数据持久化

Docker Compose 使用命名卷持久化数据：

- `mysql_data` → MySQL 数据文件，**删除容器后数据不丢失**
- `redis_data` → Redis 数据文件，**删除容器后数据不丢失**

卷存储位置：`docker volume inspect movie-archive_mysql_data`

### 3. 健康检查机制

```
MySQL ──[mysqladmin ping]──→ 就绪 ──┐
                                    ├──→ App 启动
Redis ──[redis-cli ping]──→ 就绪 ──┘
```

App 容器会等待 MySQL 和 Redis 都通过健康检查后才开始启动。

---

## 常用命令

### 基础操作

```bash
# 启动（后台运行）
docker compose up -d

# 查看日志
docker compose logs -f

# 查看某个服务的日志
docker compose logs -f app

# 停止服务
docker compose down

# 停止并删除数据卷（⚠️ 会丢失所有数据）
docker compose down -v
```

### 镜像管理

```bash
# 重新构建应用镜像（代码变更后需要）
docker compose build

# 一键重新构建并启动
docker compose up -d --build

# 查看镜像大小
docker images movie-archive-app
```

### 容器管理

```bash
# 查看运行状态
docker compose ps

# 重启某个服务
docker compose restart app

# 进入容器内部
docker exec -it movie-archive-app sh
docker exec -it movie-archive-mysql mysql -u root -p
```

---

## 数据迁移：导入已有数据

如果你已有 CSV 数据文件，可以将其复制到容器内导入：

```bash
# 1. 将 CSV 文件放入项目根目录（如 movies.csv）

# 2. 复制到容器
docker cp movies.csv movie-archive-app:/app/movies.csv

# 3. 执行迁移
docker exec movie-archive-app node server/migrate-csv.js
```

---

## 常见问题

### Q: 启动后访问 http://localhost:5280 显示 502

可能是因为 MySQL 尚未初始化完成。等待 10-20 秒后刷新即可。

查看启动日志确认：
```bash
docker compose logs -f app
```
看到 `Movie Archive Server running at:` 即表示启动完成。

### Q: 如何修改端口？

编辑 `docker-compose.yml`，修改 app 服务的 ports 和 PORT 环境变量：

```yaml
services:
  app:
    ports:
      - "8080:8080"    # 宿主机:容器
    environment:
      PORT: "8080"
```

### Q: 如何修改 MySQL 密码？

```bash
# 启动时指定密码
MYSQL_ROOT_PASSWORD=my_secure_pw docker compose up -d
```

或编辑 `docker-compose.yml` 修改 `MYSQL_ROOT_PASSWORD` 的默认值。

> **注意**：首次启动后修改密码不会影响已有数据，如需更改请同时更新已存在的数据库密码。

### Q: 容器启动后如何查看数据库？

```bash
# 连接到 MySQL（密码默认为 root123）
docker exec -it movie-archive-mysql mysql -u root -p movie_archive

# 进入后可以执行 SQL
mysql> SELECT COUNT(*) FROM movies;
mysql> SHOW TABLES;
```

### Q: Docker Desktop 占用资源太多怎么办？

可以使用 `docker compose` 的 `--profile` 功能，或者在不用时暂停容器：

```bash
# 停止所有容器（保留数据）
docker compose stop

# 重新启动
docker compose start
```

---

## 完整部署流程示例

```bash
# 1. 克隆项目
git clone https://github.com/lxncolours/Film-Television-Archiving.git
cd Film-Television-Archiving

# 2. 设置 API Key 并启动
TMDB_API_KEY=a1b2c3d4e5f6g7h8i9j0 docker compose up -d

# 3. 查看启动过程（等待初始化完成）
docker compose logs -f app

# 看到如下输出即成功：
#   Movie Archive Server running at:
#   Local:   http://localhost:5280
#   Network: http://192.168.5.14:5280

# 4. 打开浏览器访问
open http://localhost:5280
```

---

## 备份与恢复

### 备份数据库

```bash
# 导出 SQL
docker exec movie-archive-mysql mysqldump -u root -proot123 movie_archive > backup.sql
```

### 恢复数据库

```bash
# 导入 SQL
cat backup.sql | docker exec -i movie-archive-mysql mysql -u root -proot123 movie_archive
```
