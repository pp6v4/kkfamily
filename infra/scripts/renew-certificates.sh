#!/bin/sh
set -eu
cd /opt/family-life/infra
docker compose --profile certbot run --rm certbot renew --non-interactive
docker compose exec -T nginx nginx -t
docker compose exec -T nginx nginx -s reload
