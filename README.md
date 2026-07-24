# Page Pulse — Production-Grade URL Audit Service

[![Build Status](https://github.com/your-username/page-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/page-pulse/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Swagger Docs](https://img.shields.io/badge/Swagger-Docs-blue.svg)](/api/docs)

**Page Pulse** is a production-grade URL audit engine that processes third-party URLs to check connection health, SSL/TLS certificate details, and run a **Pulse Light Audit Engine** to evaluate basic SEO, Accessibility, Best Practices, and Performance indicators. 

The service serves a modern, glassmorphic visual dashboard at `/` and exposes a robust JSON REST API for developer integration.

---

## 🚀 Live Deployment & Footer

- **Live URL**: [Replace with your Render/Railway Link once deployed]
- **API Documentation**: `/api/docs` (Swagger UI)
- **Health Telemetry**: `/api/health`

> **Built for Digital Heroes Training Task** (linked to [digitalheroesco.com](https://digitalheroesco.com)).

---

## 🛠️ Key Production Features

1. **Input Validation**: Zod-schema-based URL syntax and structural checks.
2. **Request Timeouts**: Built-in 5-second limits on third-party HTTP requests to prevent backend hanging.
3. **Concurrency Limiting**: Uses a custom Semaphore pattern to cap active URL audit connections.
4. **Structured Error Responses**: Standardized error payloads (ValidationError, RateLimitExceeded, RouteNotFound, MalformedJson) with localized details.
5. **Configurable Caching**: Response caching powered by `node-cache` (configurable TTL, exports expiration details).
6. **Client Rate Limiting**: Limit audits per client IP via sliding window algorithms (`express-rate-limit`).
7. **Correlation IDs**: Trace every request from ingress to egress using `X-Request-ID` headers.
8. **Structured Logging**: Production logging using `pino` (structured JSON, silenced in test mode, pretty-printed in development).
9. **Security Hardening**: Equipped with `helmet` for CSP/security headers, `cors` for cross-origin compliance, and `compression` for response sizing optimization.

---

## 💻 Local Setup & Running

### Option A: Run via Docker (Recommended)
Make sure you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed.

1. **Spin up the containers**:
   ```bash
   docker compose up --build
   ```
2. **Access the service**:
   - Web Dashboard: `http://localhost:3000`
   - API Documentation: `http://localhost:3000/api/docs`
   - Health check: `http://localhost:3000/api/health`

---

### Option B: Run locally on your host

#### Prerequisites
- Node.js 18.x or newer
- npm 9.x or newer

1. **Install dependencies**:
   ```bash
   npm install
   ```
2. **Configure environment variables**:
   Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
3. **Start the application**:
   - **Development (with hot reload)**:
     ```bash
     npm run dev
     ```
   - **Production Mode**:
     ```bash
     npm start
     ```

---

## 🧪 Testing

The service includes a test suite covering 15+ assertions for connection edge cases, caching, rate limiting, and inputs.

```bash
# Run tests
npm test
```

---

## 📋 API Contract Documentation

### 1. Health Status
- **Method**: `GET`
- **Path**: `/api/health`
- **Response** (`200 OK`):
  ```json
  {
    "status": "healthy",
    "uptime": 12.34,
    "cache": {
      "keys": 2,
      "hits": 5,
      "misses": 1
    },
    "version": "1.0.0",
    "node": "v22.4.0",
    "timestamp": "2026-07-24T14:09:54.000Z",
    "concurrency": {
      "active": 0,
      "queued": 0,
      "max": 10
    }
  }
  ```

---

### 2. URL Audit Endpoint
- **Method**: `POST`
- **Path**: `/api/audit`
- **Headers**:
  - `Content-Type: application/json`
- **Request Body**:
  ```json
  {
    "url": "https://example.com"
  }
  ```
- **Success Response** (`200 OK`):
  ```json
  {
    "url": "https://example.com",
    "http": {
      "status": 200,
      "statusText": "OK",
      "responseTime": 156,
      "redirects": 0,
      "headers": {
        "server": "ECS (oxb/8B2E)",
        "contentType": "text/html; charset=UTF-8"
      }
    },
    "security": {
      "https": true,
      "sslExpiryDays": 120,
      "issuer": "DigiCert SHA2 Secure Server CA",
      "subject": "www.example.org",
      "validFrom": "2026-01-01T00:00:00.000Z",
      "validTo": "2026-12-31T23:59:59.000Z",
      "protocol": "TLSv1.3",
      "authorized": true,
      "authorizationError": null
    },
    "seo": {
      "title": true,
      "titleContent": "Example Domain",
      "metaDescription": true,
      "metaDescriptionContent": "Example domain metadata description for crawling.",
      "h1Count": 1,
      "missingAltImages": 0,
      "canonical": true
    },
    "performance": {
      "contentLength": "1.22 KB",
      "htmlSize": 1256,
      "scriptCount": 0,
      "cssCount": 0,
      "responseTimeMs": 156
    },
    "scores": {
      "seo": 100,
      "accessibility": 100,
      "bestPractices": 100,
      "performance": 100,
      "average": 100
    },
    "cache": {
      "cached": false,
      "cachedAt": null,
      "expiresIn": null
    }
  }
  ```

---

### 3. Example Error Response
- **Validation Failure** (`400 Bad Request`):
  ```json
  {
    "error": "ValidationError",
    "message": "Invalid input parameters provided.",
    "requestId": "d825c04b-7414-49c7-a417-1f41656ec568",
    "details": [
      {
        "field": "url",
        "issue": "Provide a valid target URL structure (e.g. google.com or https://example.com)"
      }
    ]
  }
  ```

---

## 🤖 AI Usage Statement

In building **Page Pulse**, an AI coding assistant (Antigravity by Google DeepMind) was utilized as an interactive pair-programming partner. 
- **Booster**: AI was leveraged to generate initial layout boilerplate for the glassmorphic CSS, bootstrap Swagger annotations, and construct standard unit test blocks.
- **Architectural Collaboration**: The scales design details for 10,000 requests, BullMQ separation, and failure mitigation plans were structured collaboratively.
- **Review and Integration**: All core logic, including the native Node `tls` certificate sockets, custom Concurrency Limiter semaphore, cache calculations, and global error middleware formatting, were curated and integrated directly by the engineer to guarantee performance, correctness, and dependency minimalism.
