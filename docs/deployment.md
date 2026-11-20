# Deployment

## Local Compose

`docker-compose.yml` runs Postgres 16, Redis 7, the API, and the web image. Elasticsearch is behind the `search` profile so it stays off when memory is tight.

```bash
cp .env.example .env
# replace the JWT and webhook secrets
docker compose up --build
```

The web container proxies `/api` and `/uploads` to the API service. Leave `VITE_API_URL` empty so the browser stays on one origin and can store the refresh cookie.

Health check: `GET /api/v1/health`.

## Production shape

- Web: static Vite build behind a host that proxies `/api` to the API, or a separate origin with `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true`
- API: Node 22, `NODE_ENV=production`, long random `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and `MOCK_WEBHOOK_SECRET`
- Database: managed Postgres. Run `npm run db:migrate` before traffic.
- Redis: set `REDIS_URL`. The API keeps serving if Redis is down.
- Search: leave `ELASTICSEARCH_URL` empty to stay on Postgres, or set it and call `POST /api/v1/admin/search/reindex`
- Files: `STORAGE_DRIVER=s3` plus bucket, region, keys, and `S3_PUBLIC_URL`
- Payments: set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for Stripe test or live mode. Omit them to keep the mock provider.
- Mail: set `SMTP_HOST` or mail is only stored when `NODE_ENV` is not production

Do not commit `.env`. Do not put Stripe secrets or JWT secrets in the web bundle. `VITE_` variables are public.

## Logging

The API logs method, path, status, and duration with pino. Production error responses hide internal messages. Zod failures return 422 with field errors.
