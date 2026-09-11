# Enterprise Event-Driven Microservices Platform

[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-v20+-green.svg)](https://nodejs.org/)
[![NATS JetStream](https://img.shields.io/badge/NATS-JetStream-27AAE1.svg)](https://nats.io/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED.svg)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A production-grade, distributed microservices system demonstrating clean architecture, perimeter security, distributed tracing, and resilient event-driven asynchronous processing using **NATS JetStream**.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |         CLIENT (Web / Mobile)         |
                      +-------------------+-------------------+
                                          | HTTP / HTTPS
                                          v
+------------------------------------------------------------------------------------+
|                                   API GATEWAY                                      |
|                               (Port 8080)                                          |
|                                                                                    |
|  * Perimeter Security: Helmet Headers, CORS Policy                                 |
|  * Rate Limiting: Brute Force Guard (Auth) & API Quota Limiter                     |
|  * Centralized Authentication: JWT Verification & Claims Injection                |
|  * Distributed Tracing: X-Correlation-ID Generation & Propagation                  |
|  * Centralized Documentation: Swagger / OpenAPI UI at /docs                        |
|  * System Health Aggregator: /health & /health/live                                |
+---------------------------+-----------------------------------+--------------------+
                            | Forward HTTP                      | Forward HTTP
                            | (Authenticated Context)           | (Notification Logs)
                            v                                   v
+---------------------------------------+       +------------------------------------+
|             USER SERVICE              |       |        NOTIFICATION SERVICE        |
|             (Port 8001)               |       |             (Port 8002)            |
|                                       |       |                                    |
| * Domain: Registration, Auth, Profile |       | * Multi-channel Notification Engine|
| * Security: Bcrypt (12 work factor)   |       | * Idempotency Ledger (Event Dedup) |
| * Storage: PostgreSQL (with fallback) |       | * Notification Audit History Store |
| * Publisher: JetStream (Nats-Msg-Id)  |       | * Retry with Backoff & DLQ Router  |
+-------------------+-------------------+       +-----------------+------------------+
                    |                                             ^
                    | Publish Domain Events                       | Pull Events
                    | (user.*)                                    | (Durable Consumer)
                    v                                             |
+-----------------------------------------------------------------+------------------+
|                            NATS JETSTREAM MESSAGE BROKER                           |
|                                    (Port 4222)                                     |
|                                                                                    |
|  * Stream: USER_EVENTS                                                             |
|  * Subjects: user.registered, user.password_changed, user.profile_updated, ...     |
|  * Guarantees: At-Least-Once Delivery, 24h Deduplication Window, Disk Persistence  |
|  * Security: Token Authentication (NATS_TOKEN)                                     |
+------------------------------------------------------------------------------------+
```

### Communication Principles
- **Strictly No REST or WebSockets between Backend Services**: As required, the **User Service** and **Notification Service** do **not** communicate with each other via REST APIs, gRPC, or WebSockets.
- **Purely Event-Driven**: Communication occurs exclusively via asynchronous messaging through **NATS JetStream**.
- **Loose Coupling & Extensibility**: The User Service has zero knowledge of notifications, email providers, or subscribers. New downstream consumers (such as analytics, audit, or fraud-detection services) can attach to the stream without any changes to existing services.

---

## Key Features & Production Reliability

### 1. Reliable Asynchronous Messaging with NATS JetStream
- **Persistent Streams**: Events are written to the `USER_EVENTS` JetStream stream with durable file storage.
- **Message Deduplication**: Emitted events include unique `Nats-Msg-Id` headers. NATS automatically enforces deduplication across a 24-hour window.
- **Durable Pull Consumers**: The Notification Service attaches via a named durable consumer (`notification-service-worker`) with `AckPolicy.Explicit`. Messages are only acknowledged (`msg.ack()`) after successful dispatch.
- **Idempotent Processing**: An internal idempotency ledger (`processed_events`) checks the `eventId` of incoming messages. If network timeouts cause broker redelivery, duplicate events are safely acknowledged without duplicate notifications.
- **Poison Message & Dead Letter Queue (DLQ)**: Configured with `max_deliver: 5`. If a message repeatedly fails processing, it is automatically captured in a dead-letter log (`dead_letters`) with failure context and terminated (`msg.term()`) so it does not poison or stall the stream.

### 2. Comprehensive Security
- **Perimeter Gatekeeper**: The API Gateway validates JWT tokens using HMAC-SHA256 and passes verified user identity downstream via trusted internal headers (`X-User-Id`, `X-User-Email`, `X-User-Role`).
- **Rate Limiting**:
  - Auth routes (`/api/v1/auth/*`): Window of 15 minutes, maximum 30 attempts (prevents credential stuffing and brute-force).
  - General API routes: Window of 1 minute, maximum 100 requests.
- **Password Security**: Bcrypt with work factor of 12; constant-time comparison prevents timing attacks.
- **Secure Broker**: NATS authentication enforced via secure tokens.
- **Input Validation**: Strict schema validation with Zod on all incoming HTTP payloads.
- **HTTP Hardening**: Helmet security headers (HSTS, clickjacking protection, MIME-type sniffing defense) and granular CORS.

### 3. Distributed Tracing & Observability
- **Correlation ID Propagation**: An `X-Correlation-ID` is assigned at the Gateway (or accepted from client), forwarded across HTTP to User Service, embedded in NATS JetStream headers, and carried into Notification Service logs and dispatched emails.
- **Health Probes**: Liveness (`/health/live`) and readiness (`/health/ready`) endpoints on each service, plus an aggregated cluster health endpoint (`/health`) on the API Gateway.
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT` across all services, draining HTTP connections, closing NATS channels, and releasing database pools cleanly.

---

## Project Structure

```
assignment01/
├── .env.example                     # Environment variables template
├── docker-compose.yml               # Production multi-container orchestration
├── package.json                     # Workspace scripts & root dependencies
├── tsconfig.base.json               # Shared strict TypeScript configuration
├── docs/
│   ├── architecture.md              # In-depth architectural design specification
│   └── openapi.yaml                 # OpenAPI 3.0 specification for all endpoints
├── scripts/
│   ├── init-db.sql                  # PostgreSQL multi-database initialization
│   └── test-e2e.js                  # Automated end-to-end verification test suite
├── shared/                          # Shared library (@system/shared)
│   ├── src/
│   │   ├── events.ts                # Domain event types, schemas & NATS subjects
│   │   ├── types.ts                 # DTOs, API responses, notification models
│   │   ├── logger.ts                # Structured JSON / colored console logger
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
└── services/
    ├── api-gateway/                 # API Gateway Service (:8080)
    │   ├── src/
    │   │   ├── config.ts            # Validated environment configuration
    │   │   ├── middleware/          # Auth, RateLimiter, CorrelationId
    │   │   ├── proxy/               # HTTP proxy middleware with header injection
    │   │   ├── routes/              # Aggregated health & Swagger docs routes
    │   │   └── index.ts             # Gateway server bootstrap & graceful shutdown
    │   ├── Dockerfile
    │   ├── package.json
    │   └── tsconfig.json
    ├── user-service/                # User Microservice (:8001)
    │   ├── src/
    │   │   ├── config.ts
    │   │   ├── db/                  # PostgreSQL repository with embedded fallback
    │   │   ├── events/              # NATS JetStream publisher with deduplication
    │   │   ├── services/            # Business logic & domain event publication
    │   │   ├── controllers/         # Input validation & controllers
    │   │   ├── routes/              # User, Auth & Health routes
    │   │   └── index.ts
    │   ├── Dockerfile
    │   ├── package.json
    │   └── tsconfig.json
    └── notification-service/        # Notification Microservice (:8002)
        ├── src/
        │   ├── config.ts
        │   ├── db/                  # Idempotency ledger, audit logs & DLQ store
        │   ├── events/              # JetStream durable pull consumer & DLQ routing
        │   ├── handlers/            # Event handlers (welcome, security alert, etc.)
        │   ├── providers/           # Multi-channel template & dispatch engine
        │   ├── routes/              # Audit queries & health probes
        │   └── index.ts
        ├── Dockerfile
        ├── package.json
        └── tsconfig.json
```

---

## Quickstart Guide

### Option 1: Run with Docker Compose (Recommended)

This starts NATS JetStream, PostgreSQL (with `user_db` and `notification_db`), User Service, Notification Service, and API Gateway in isolated containers with health checks.

```bash
# 1. Build and start all services
docker compose up --build -d

# 2. View container status
docker compose ps

# 3. View live logs across all services
docker compose logs -f
```

The system will be ready at:
- **API Gateway**: [http://localhost:8080](http://localhost:8080)
- **Interactive Swagger Docs**: [http://localhost:8080/docs](http://localhost:8080/docs)
- **Aggregated Health Check**: [http://localhost:8080/health](http://localhost:8080/health)
- **NATS Web Monitoring**: [http://localhost:8222](http://localhost:8222)

To stop the containers:
```bash
docker compose down -v
```

---

### Option 2: Run Locally (Without Docker)

#### Prerequisites
- Node.js 20+ and npm
- NATS Server running locally on port 4222 with JetStream enabled:
  ```bash
  nats-server -js --auth secure_nats_token_123
  ```
  *(Or run just NATS in docker: `docker run -d --name nats -p 4222:4222 -p 8222:8222 nats:alpine -js --auth secure_nats_token_123 -m 8222`)*

#### Steps
1. **Clone and install dependencies**:
   ```bash
   git clone https://github.com/amit7451/assignment01.git
   cd assignment01
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   ```

3. **Build the shared library and microservices**:
   ```bash
   npm run build
   ```

4. **Start the services** (in separate terminals or background):
   ```bash
   # Terminal 1: Notification Service
   npm run start:notification

   # Terminal 2: User Service
   npm run start:user

   # Terminal 3: API Gateway
   npm run start:gateway
   ```

---

## Running Automated Verification Tests

A comprehensive end-to-end test script is included to validate the entire workflow:

```bash
npm run test:e2e
```

The test script automatically verifies:
1. API Gateway liveness and aggregated cluster health check (`/health`).
2. Distributed tracing: `X-Correlation-ID` header generation and downstream propagation.
3. User Registration: validation, bcrypt hashing, and JetStream `user.registered` event publication.
4. Duplicate user registration rejection (HTTP 409 Conflict).
5. Authentication: login with invalid credentials (HTTP 401) and valid credentials (HTTP 200 with JWT).
6. Protected Routes: unauthorized rejection and authorized access (`/api/v1/users/me`).
7. User Profile Update: persists updates and emits `user.profile_updated`.
8. Password Change: updates password and emits `user.password_changed`.
9. Old password invalidation and new password authentication.
10. **Asynchronous Notification Consumption**: queries Notification Service audit logs to assert that:
    - `WELCOME_EMAIL` was received from JetStream and processed.
    - `SECURITY_ALERT` was triggered by password change and processed.
    - `PROFILE_UPDATED` notification was processed.

---

## API Documentation

### Interactive Swagger UI
Navigate to [http://localhost:8080/docs](http://localhost:8080/docs) in your browser when the API Gateway is running.

### Key Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | Public | Aggregated cluster health check |
| `GET` | `/health/live` | Public | Gateway liveness probe |
| `GET` | `/docs` | Public | Interactive Swagger / OpenAPI documentation |
| `POST` | `/api/v1/auth/register` | Public (Rate-limited) | Register a new user & trigger welcome event |
| `POST` | `/api/v1/auth/login` | Public (Rate-limited) | Login & receive signed JWT |
| `GET` | `/api/v1/users/me` | Bearer Token | Get authenticated user profile |
| `PUT` | `/api/v1/users/profile` | Bearer Token | Update user profile & trigger event |
| `POST` | `/api/v1/users/change-password` | Bearer Token | Change password & trigger security alert |
| `DELETE` | `/api/v1/users/me` | Bearer Token | Delete account & trigger deletion event |
| `GET` | `/api/v1/notifications` | Bearer Token | Query notification history and delivery status |

---

## Example cURL Commands

### 1. Register a User
```bash
curl -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePassword123!",
    "name": "Alice Developer",
    "role": "user"
  }'
```

*Response (201 Created):*
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "2b31ff5b-38ab-41c1-9d9e-1dc62194f4c2",
      "email": "alice@example.com",
      "name": "Alice Developer",
      "role": "user",
      "createdAt": "2026-09-11T07:15:00.000Z",
      "updatedAt": "2026-09-11T07:15:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
      "tokenType": "Bearer",
      "expiresIn": "24h"
    }
  },
  "meta": {
    "timestamp": "2026-09-11T07:15:00.000Z",
    "correlationId": "48b6bbdb-c98f-4cb1-97b7-6b6f00dbbe4c"
  }
}
```

### 2. Login
```bash
curl -X POST http://localhost:8080/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePassword123!"
  }'
```

### 3. Get User Profile (Protected)
```bash
curl -X GET http://localhost:8080/api/v1/users/me \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

### 4. Change Password (Triggers Asynchronous Security Alert)
```bash
curl -X POST http://localhost:8080/api/v1/users/change-password \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "currentPassword": "SecurePassword123!",
    "newPassword": "NewStrongPassword789!"
  }'
```

### 5. Check Notification History
```bash
curl -X GET http://localhost:8080/api/v1/notifications \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

*Response (200 OK):*
```json
{
  "success": true,
  "data": {
    "total": 2,
    "items": [
      {
        "id": "e9fb4df0-18e3-4d7e-9769-cf2c2a050519",
        "eventId": "2cbbe2bb-41db-4952-b13c-0e271a257c70",
        "userId": "2b31ff5b-38ab-41c1-9d9e-1dc62194f4c2",
        "recipient": "alice@example.com",
        "type": "SECURITY_ALERT",
        "channel": "EMAIL",
        "subject": "SECURITY ALERT: Password changed for your account",
        "status": "SENT",
        "attemptCount": 1,
        "createdAt": "2026-09-11T07:16:00.000Z",
        "sentAt": "2026-09-11T07:16:00.050Z"
      },
      {
        "id": "18f81216-e5c7-43cf-824f-aef6bebfbf68",
        "eventId": "7a3536c4-ee8b-4b1a-8c50-cf48dcaef750",
        "userId": "2b31ff5b-38ab-41c1-9d9e-1dc62194f4c2",
        "recipient": "alice@example.com",
        "type": "WELCOME_EMAIL",
        "channel": "EMAIL",
        "subject": "Welcome to the Platform, Alice Developer!",
        "status": "SENT",
        "attemptCount": 1,
        "createdAt": "2026-09-11T07:15:00.050Z",
        "sentAt": "2026-09-11T07:15:00.100Z"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-09-11T07:17:00.000Z"
  }
}
```

---

## Failure Scenarios & Resilience Testing

| Failure Scenario | Mitigation & Behavior |
|---|---|
| **NATS Broker Temporary Outage** | Publishers queue or retry with exponential backoff. Consumers auto-reconnect upon broker revival with state restored. |
| **Notification Consumer Crash** | JetStream retains unacknowledged messages. On restart, the consumer resumes from the last unacknowledged sequence without loss. |
| **Network Redelivery / Duplicate Messages** | Idempotency ledger checks `eventId` to ensure notifications are never dispatched more than once. |
| **Poison / Malformed Messages** | Handled by `max_deliver: 5` threshold; routed to Dead Letter Queue (`dead_letters`) and terminated so stream processing continues smoothly. |
| **User Service Outage** | API Gateway catches upstream error, prevents socket hangs, and returns a structured `503 Service Unavailable` with correlation ID. |

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
