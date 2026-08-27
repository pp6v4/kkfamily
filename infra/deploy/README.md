# 生产部署目录

此目录由服务器上的 `/opt/family-life` 使用。生产环境不使用 Windows 的 Node.js 或 `node_modules`。

## 上线前准备

1. `api.pp6v4.com` 新建 A 记录到 `49.233.18.181`。
2. 服务器安装 Docker Engine 与 Docker Compose plugin。
3. 在 `apps/api/.env` 填入微信、COS、JWT 密钥；在 `infra/.env` 填入 PostgreSQL/Redis 密码。
4. 将 `infra/Caddyfile.example` 复制为 `infra/Caddyfile`，将 `YOUR_DOMAIN.com` 改为 `pp6v4.com`。

## 首次运行

```bash
cd /opt/family-life
docker compose -f infra/docker-compose.yml build --no-cache
docker compose -f infra/docker-compose.yml up -d
curl --fail https://api.pp6v4.com/v1/health
```

所有密钥仅保存在服务器 `.env`，不提交 Git。
