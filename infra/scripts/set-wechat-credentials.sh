#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/apps/api/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到 $ENV_FILE，请先完成服务器部署。" >&2
  exit 1
fi

read -r -p "微信小程序 AppID: " app_id
read -r -s -p "微信小程序 AppSecret（输入不回显）: " app_secret
printf '\n'

[[ -n "$app_id" && -n "$app_secret" ]] || { echo "AppID 和 AppSecret 均不能为空。" >&2; exit 1; }

sed -i "s|^WECHAT_APP_ID=.*|WECHAT_APP_ID=$app_id|" "$ENV_FILE"
sed -i "s|^WECHAT_APP_SECRET=.*|WECHAT_APP_SECRET=$app_secret|" "$ENV_FILE"
chmod 600 "$ENV_FILE"

cd "$ROOT_DIR/infra"
sudo docker compose up -d --force-recreate api
echo "已保存凭证并重启 API。"
