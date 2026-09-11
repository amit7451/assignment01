# System Architecture Documentation

## 1. System Overview

This distributed system is an enterprise microservices architecture designed around **domain isolation, secure perimeter routing, and event-driven asynchronous processing**. 

The system consists of three independent services communicating via HTTP (external perimeter to gateway) and **NATS JetStream** (inter-service messaging without REST/WebSocket coupling):

```
+-----------------------------------------------------------------------------------+
|                                  API GATEWAY                                      |
|  - Rate Limiting (Brute Force & API quotas)                                      |
|  - Helmet Security Headers & CORS Policy                                         |
|  - JWT Authentication & Role Authorization                                        |
|  - Distributed Correlation ID Injection (x-correlation-id)                        |
|  - Centralized OpenAPI / Swagger UI (/docs) & Aggregated Health (/health)         |
+--------------------------+------------------------------------+-------------------+
                           | Forward HTTP                       | Forward HTTP
                           | (Authenticated)                    | (Audit Logs)
                           v                                    v
+--------------------------------------+      +-------------------------------------+
|             USER SERVICE             |      |        NOTIFICATION SERVICE         |
| - User registration & login (bcrypt) |      | - JetStream Durable Pull Consumer   |
| - Profile & password management      |      | - Idempotency ledger (dedup)        |
| - Database: PostgreSQL (or fallback) |      | - Notification audit store          |
| - JetStream Publisher (Nats-Msg-Id)  |      | - Multi-channel template engine     |
+------------------+-------------------+      | - Exponential Retry & DLQ Router    |
                   |                          +------------------+------------------+
                   | Publish                                     ^ Consume
                   | user.* events                               | user.* events
                   v                                             |
+----------------------------------------------------------------+------------------+
|                            NATS JETSTREAM MESSAGE BROKER                          |
|  Stream: USER_EVENTS                                                              |
|  Subjects: user.registered, user.password_changed, user.profile_updated, ...      |
|  Guarantees: At-Least-Once Delivery, Message Deduplication, Disk Persistence      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Inter-Service Communication Principles

### No REST / WebSocket Coupling Between Microservices
In compliance with requirements, the **User Service** and **Notification Service** do **not** communicate via REST APIs, gRPC, or WebSockets. All communication between them is:
1. **Asynchronous**: The User Service publishes an event immediately upon committed state change, allowing the user's HTTP request to return in under 20ms without waiting for email delivery.
2. **Decoupled**: The User Service has zero knowledge of the Notification Service. Additional consumers (e.g. Analytics Service, Fraud Detection Service, Audit Service) can attach to the same `USER_EVENTS` stream without modifying a single line of code in User Service.
3. **Reliable & Persistent**: Messages in NATS JetStream are written to disk before acknowledgement and survive broker restarts.

---

## 3. NATS JetStream Configuration & Reliability Patterns

### A. Stream Configuration
- **Stream Name**: `USER_EVENTS`
- **Subjects**: `user.*`
- **Storage**: `StorageType.File`
- **Retention**: `RetentionPolicy.Limits` (retained up to 7 days)
- **Deduplication Window**: `duplicate_window: 24 hours`
  - When the User Service publishes an event, it assigns a UUID `eventId` and attaches it to the `Nats-Msg-Id` header.
  - If a network glitch causes the User Service to republish the same event, NATS JetStream automatically deduplicates it at the broker level!

### B. Durable Pull Consumer
- **Durable Name**: `notification-service-worker`
- **Ack Policy**: `AckPolicy.Explicit` (The message is acknowledged **only** after processing succeeds).
- **Deliver Policy**: `DeliverPolicy.All` (Ensures new or rebooted consumer instances catch up on unacknowledged messages).
- **Max Deliver**: `5` (Poison message guard).

### C. Idempotent Consumer Pattern
Network timeouts, broker re-elections, or node crashes can lead to redelivery of an already-processed event. To maintain true **exactly-once processing semantics**:
1. Notification Service checks its `processed_events` table using `event.metadata.eventId`.
2. If already processed, it logs an idempotency hit and skips re-dispatching emails or alerts.
3. It immediately acknowledges (`msg.ack()`) the message so the broker doesn't attempt further redeliveries.

### D. Poison Message & Dead Letter Queue (DLQ)
If an event payload is malformed or unprocessable:
1. On each delivery failure, Notification Service calculates an exponential backoff (`Math.min(1000 * 2^(attempts-1), 10000)`) and sends a `msg.nak(backoff)`.
2. When `deliveryCount > 5`, the consumer intercepts the message, writes it to the `dead_letters` table with the failure reason and stack trace, and invokes `msg.term()` (terminate).
3. This prevents a single corrupt message from blocking the message stream indefinitely.

---

## 4. Security Architecture

### A. Perimeter Security at API Gateway
1. **Rate Limiting**:
   - Authentication endpoints (`/api/v1/auth/*`): Window 15 minutes, max 30 requests. Protects against brute-force and credential stuffing.
   - General API endpoints: Window 1 minute, max 100 requests. Prevents DoS attacks.
2. **Helmet**:
   - Prevents XSS, MIME-sniffing, clickjacking (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).
3. **CORS Policy**:
   - Restricts cross-origin requests to configured domains.

### B. Identity Propagation
1. Public clients authenticate at `/api/v1/auth/login`.
2. The Gateway validates JWT tokens using HMAC-SHA256 (`jwt.verify`).
3. Upon successful verification, Gateway injects sanitized identity headers into upstream requests:
   - `X-User-Id`: Authenticated user UUID
   - `X-User-Email`: Authenticated user email
   - `X-User-Role`: User permission role (`user`, `admin`)
4. Internal services trust headers from the Gateway, isolating auth logic.

### C. Password Protection
- Passwords hashed with `bcryptjs` using a salt work factor of **12**.
- Comparison runs in constant time to defeat timing analysis attacks.

### D. Broker Security
- NATS broker secured via token or username/password authentication configured through environment variables (`NATS_TOKEN`).

---

## 5. Distributed Tracing & Observability

Every request entering through the API Gateway receives or inherits an `X-Correlation-ID` (UUID v4):
1. Client sends request -> Gateway assigns `X-Correlation-ID`.
2. Gateway logs request with `correlationId` and forwards header to User Service.
3. User Service logs request with `correlationId` and embeds it in the `DomainEvent.metadata.correlationId` and NATS message header `X-Correlation-Id`.
4. Notification Service extracts `X-Correlation-Id` from NATS headers and attaches it to its structured worker logs and dispatched email headers.
5. End-to-end trace can be queried across all service logs by filtering for the specific `correlationId`!

---

## 6. Resilience & Graceful Shutdown

All three services implement standard OS signal listeners (`SIGTERM`, `SIGINT`):
1. Stop accepting new inbound HTTP requests.
2. Drain in-flight HTTP connections.
3. Drain and close NATS connections (`nc.drain() -> nc.close()`).
4. Close database connection pools (`pool.end()`).
5. Terminate cleanly with exit code 0 (with a 10-second fail-safe timeout).
