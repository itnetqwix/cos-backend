# Contest Operating System (COS) - REST API Documentation

The Contest Operating System (COS) API provides multi-tenant authentication, role-based identity management, organization scoping, and contest orchestration.

## Base URL
- **Local Development**: `http://localhost:5000/api/v1`
- **Swagger Interactive UI**: `http://localhost:5000/docs`
- **OpenAPI 3.0 Specification JSON**: `http://localhost:5000/docs/json`

---

## Standard Response Format

Frozen by **M01-P01-T01** (`cos-backend/src/utils/response.ts`: `sendSuccess` / `sendError`).

All API responses strictly adhere to the unified `ApiResponse<T>` envelope. Top-level fields are exactly `success`, `message`, `data`, and `errors` — there is no envelope-level `timestamp`.

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "errors": null
}
```

On validation or server errors:

```json
{
  "success": false,
  "message": "Validation error",
  "data": null,
  "errors": [
    {
      "field": "email",
      "message": "Invalid email address format"
    }
  ]
}
```

---

## Authentication Endpoints (`/api/v1/auth`)

### 1. Register Creator
- **Method**: `POST`
- **Path**: `/api/v1/auth/register/creator`
- **Description**: Registers a standalone content creator (`CREATOR` role) and issues a 7-day JWT access token.
- **Request Body**:
  ```json
  {
    "email": "creator@contestos.com",
    "password": "Password123!",
    "name": "Alex Rivers"
  }
  ```

### 2. Register Brand
- **Method**: `POST`
- **Path**: `/api/v1/auth/register/brand`
- **Description**: Atomically creates an Organization record and initial `BRAND_ADMIN` user in a database transaction.
- **Request Body**:
  ```json
  {
    "email": "admin@ripskis.com",
    "password": "Password123!",
    "name": "Jordan Vance",
    "organizationName": "Ripskis Entertainment",
    "slug": "ripskis"
  }
  ```

### 3. Login
- **Method**: `POST`
- **Path**: `/api/v1/auth/login`
- **Description**: Validates credentials using Bcrypt (10 salt rounds) and returns user profile + JWT.
- **Request Body**:
  ```json
  {
    "email": "creator@contestos.com",
    "password": "Password123!"
  }
  ```

### 4. Get Current User Profile
- **Method**: `GET`
- **Path**: `/api/v1/auth/me`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Retrieves session data and associated organization info for the authenticated user.

---

## User Management Endpoints (`/api/v1/users`)

### 1. List Users
- **Method**: `GET`
- **Path**: `/api/v1/users?page=1&limit=20&search=keyword&role=CREATOR`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Paginated user search and filtering.

### 2. Get User by ID
- **Method**: `GET`
- **Path**: `/api/v1/users/:id`
- **Headers**: `Authorization: Bearer <token>`
- **Description**: Fetches user details by UUID.

---

## System Endpoints (`/api/v1`)

### 1. Health Check
- **Method**: `GET`
- **Path**: `/api/v1/health`

### 2. Root Info
- **Method**: `GET`
- **Path**: `/api/v1/`
