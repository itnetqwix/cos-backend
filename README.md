# Contest Operating System (COS) - Enterprise Backend

> High-scale, multi-tenant backend architecture built with **Fastify 5**, **Prisma ORM**, **Neon PostgreSQL**, **TypeScript**, and an enterprise **Repository-Service-Controller (RSC)** design pattern.

---

## 🏛️ Architecture & Directory Layout

```
cos-backend/
├── src/
│   ├── config/
│   │   ├── env.ts                   # Zod-validated environment config
│   │   ├── database.ts              # Neon PostgreSQL PrismaClient singleton
│   │   └── constants.ts             # System constants, roles, and status codes
│   │
│   ├── controllers/
│   │   ├── auth.controller.ts       # Auth HTTP handlers (Register, Login, Me)
│   │   └── user.controller.ts       # User management HTTP handlers
│   │
│   ├── services/
│   │   ├── auth.service.ts          # Auth business logic (JWT, bcrypt, org creation)
│   │   └── user.service.ts          # User query business logic
│   │
│   ├── repositories/
│   │   └── user.repository.ts       # Isolated Prisma ORM database queries
│   │
│   ├── schemas/
│   │   ├── auth.schema.ts           # Zod validation & Swagger OpenAPI schemas for Auth
│   │   └── user.schema.ts           # Zod validation & Swagger OpenAPI schemas for Users/System
│   │
│   ├── plugins/
│   │   ├── prisma.ts                # Fastify Prisma lifecycle decorator
│   │   ├── jwt.ts                   # Fastify JWT & authenticate decorator
│   │   ├── cors.ts                  # Fastify CORS security plugin
│   │   ├── helmet.ts                # Fastify Helmet security headers
│   │   └── swagger.ts               # Swagger UI & OpenAPI 3.0 specification
│   │
│   ├── middleware/
│   │   ├── auth.middleware.ts       # Token verification & role guard preHandlers
│   │   └── error.middleware.ts      # Global Fastify error handler & envelope formatter
│   │
│   ├── utils/
│   │   ├── logger.ts                # Centralized Pino logger
│   │   ├── response.ts              # Unified ApiResponse envelope & send helpers
│   │   ├── pagination.ts            # Standard pagination calculator & meta builder
│   │   └── crypto.ts                # Bcrypt password hashing & comparison
│   │
│   ├── types/
│   │   ├── auth.ts                  # Auth DTOs, JWT payloads
│   │   ├── user.ts                  # Sanitized user types, pagination types
│   │   └── fastify.d.ts             # Fastify type declaration merging
│   │
│   ├── routes/
│   │   └── index.ts                 # Master router registering all API endpoints
│   │
│   ├── app.ts                       # Fastify instance builder (buildApp)
│   └── server.ts                    # Application bootstrapping & listening entrypoint
│
├── prisma/
│   ├── schema.prisma                # Multi-tenant schema (Organization, User, Role)
│   ├── migrations/                  # Database migration logs
│   └── seed.ts                      # Database seeder (SuperAdmin, Brands, Creators)
│
├── tests/
│   ├── unit/
│   │   └── utils.test.ts            # Unit tests for core utilities
│   └── integration/
│       ├── auth.test.ts             # Integration tests for Auth & Swagger
│       └── user.test.ts             # Integration tests for Users & Guards
│
├── docs/
│   └── api/
│       └── README.md                # API specification and reference
│
├── .env                             # Local environment variables
├── .env.example                     # Environment template
├── .env.test                        # Test environment variables
├── Dockerfile                       # Multi-stage production container build
├── docker-compose.yml               # Container orchestration
├── package.json                     # NPM scripts and dependencies
├── tsconfig.json                    # TypeScript compiler configuration
└── README.md                        # Documentation
```

---

## ⚡ Quick Start

### 1. Installation
```bash
npm install
```

### 2. Environment Setup
Copy `.env.example` to `.env` and replace placeholders with local values. `.env` is gitignored — do not commit secrets.

Supported keys are only those in `src/config/env.ts` / `.env.example`: `PORT`, `NODE_ENV`, `DATABASE_URL`, `JWT_SECRET`, `LOG_LEVEL`, `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `STORAGE_PROVIDER`, `DEMO_MEDIA_PORT`. `CORS_ORIGIN` is not an env key. Production storage is `STORAGE_PROVIDER=s3`. `local-demo` is temporary and documented in `docs/LOCAL-DEMO-MODE.md`.

### 3. Database Migration & Seeding
```bash
npx prisma generate
npx prisma db push
npm run seed
```

### 4. Running Development Server
```bash
npm run dev
```

### 5. Running Tests & Typecheck
```bash
npm run typecheck
npm test
```

---

## 📖 Interactive API Documentation

Once the server is running, navigate to:
- **Swagger UI**: [http://localhost:5000/docs](http://localhost:5000/docs)
- **OpenAPI 3.0 JSON**: [http://localhost:5000/docs/json](http://localhost:5000/docs/json)
- **Health Check**: [http://localhost:5000/api/v1/health](http://localhost:5000/api/v1/health)
