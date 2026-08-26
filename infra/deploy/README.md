# 生产部署目录

此目录由服务器上的 `/opt/family-life` 使用。生产环境不使用 Windows 的 Node.js 或 `node_modules`。

## 上线前准备

1. 不需要子域名。API 固定使用 `https://pp6v4.com/api/`；微信后台合法域名登记 `https://pp6v4.com`。
2. 服务器安装 Docker Engine 与 Docker Compose plugin。
3. 在 `apps/api/.env` 填入微信、COS、JWT 密钥；在 `infra/.env` 填入 PostgreSQL/Redis 密码。
4. 首次申请证书前，将 `infra/nginx/bootstrap.conf` 复制为 `infra/nginx/nginx.conf`。

## 首次运行

```bash
cd /opt/family-life
docker compose -f infra/docker-compose.yml build --no-cache
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml --profile certbot run --rm certbot certonly --webroot -w /var/www/certbot -d pp6v4.com --email YOUR_EMAIL --agree-tos --no-eff-email
cp infra/nginx/production.conf infra/nginx/nginx.conf
docker compose -f infra/docker-compose.yml exec nginx nginx -s reload
curl --fail https://pp6v4.com/api/v1/health
```

所有密钥仅保存在服务器 `.env`，不提交 Git。
