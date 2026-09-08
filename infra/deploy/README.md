# 生产部署目录

此目录由服务器上的 `/opt/family-life` 使用。生产环境不使用 Windows 的 Node.js 或 `node_modules`。

## 上线前准备

1. 不需要子域名。API 固定使用 `https://pp6v4.com/api/`；微信后台合法域名登记 `https://pp6v4.com`。
2. 服务器安装 Docker Engine 与 Docker Compose plugin。
3. 在 `apps/api/.env` 填入微信、COS、JWT 密钥，并用 `openssl rand -base64 32` 生成 `ARCHIVE_ENCRYPTION_KEY`；在 `infra/.env` 填入 PostgreSQL/Redis 密码。档案加密密钥必须单独备份，丢失后数据库密文不能恢复。
4. 首次申请证书前，将 `infra/nginx/bootstrap.conf` 复制为 `infra/nginx/nginx.conf`。

## 首次运行

部署前先在Docker主机的仓库根目录执行 `node scripts/verify-database.cjs`。此命令使用独立测试网络和临时PostgreSQL，不读取生产配置；只有迁移及HTTP集成结果通过后才继续。具体证据位置和失败处理见[隔离数据库验收](../verification/README.md)。

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

## 证书自动续期

首次证书签发成功后安装 systemd 单元（按服务器时区每天检查两次，附加随机延迟）：

```bash
sudo install -m 644 /opt/family-life/infra/deploy/family-life-cert-renew.service /etc/systemd/system/
sudo install -m 644 /opt/family-life/infra/deploy/family-life-cert-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now family-life-cert-renew.timer
sudo systemctl start family-life-cert-renew.service
sudo systemctl show family-life-cert-renew.service -p Result -p ExecMainStatus
cd /opt/family-life/infra
sudo docker compose --profile certbot run --rm certbot renew --dry-run --non-interactive
```

执行日志用 `journalctl -u family-life-cert-renew.service` 查看。生产 `nginx.conf` 已切换 HTTPS；新服务器首次签发前仍须使用 `bootstrap.conf`，不得在已有证书的服务器上误覆盖回 HTTP 配置。API 需要同时加入 `internal` 与 `edge` 网络以访问微信/COS；PostgreSQL、Redis 保持仅内部访问。

`notification-worker` 会等待 API 健康检查通过后启动，每30秒领取到期的站内提醒；完成、取消、改派或版本变化会使旧任务失效。微信订阅发送仍须先在微信后台取得模板并完成模板字段联调，未配置时站内提醒正常工作。
