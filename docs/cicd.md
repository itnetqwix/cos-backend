# Ripskis backend CI/CD

Production branch is `main`. The live host is EC2 `i-048289e22182b423a` (`18.116.186.37`), app directory `/home/ubuntu/cos-backend`, PM2 process `ripskis-backend`, port `5000`. Nginx and Cloudflare are not part of this pipeline.

## Workflows

| Workflow | When it runs |
|---|---|
| `.github/workflows/ci.yml` | Every pull request and push. Installs with `npm ci`, generates Prisma Client, typechecks, syncs a throwaway Postgres service with `prisma db push`, tests, and builds. The committed migrations are not a baseline, so CI does not use `migrate deploy`. |
| `.github/workflows/deploy-production.yml` | Manual, and only from `main`. GitHub Environment `production` must be approved first. |
| `.github/workflows/migrate-production.yml` | Manual, and only from `main`, with the same approval. This is the only workflow that runs `prisma migrate deploy`. |

Deploy checks out the chosen commit, runs `npm ci`, `prisma generate`, and `npm run build`, then `pm2 startOrReload ecosystem.config.cjs --update-env`. It does not run migrations, `db push`, or `migrate reset`. It does not replace `.env`.

## AWS

GitHub Actions assumes `arn:aws:iam::449112696823:role/ripskis-gha-backend-deploy` with OIDC. The role trusts only `repo:itnetqwix/cos-backend:environment:production` and can send an SSM command to that one instance. No AWS keys are stored in GitHub.

## Secrets and variables

None required for the backend. Do not add `DATABASE_URL`, `JWT_SECRET`, or the host `.env` to the repository or to Actions secrets. CI uses its own Postgres service.

## Rollback

The deploy script writes the previous SHA to `/home/ubuntu/cos-backend-releases/previous-sha` and keeps the previous `dist` at `/home/ubuntu/cos-backend-releases/dist-previous`. A failed build or health check checks that SHA back out and reloads PM2.

To roll back a deploy that stayed healthy, run **Deploy production** from `main` and pass that previous SHA. The SHA must be an ancestor of `origin/main`.

## First production run

Do not run Deploy production or Migrate production until the deployment plan is approved. CI on a pull request does not touch the EC2 instance or the production database.
