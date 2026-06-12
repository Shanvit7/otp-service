# OTP Rate Limiting & Verification System

## Problem Statement

Design a backend system that generates and verifies OTPs for users using Redis.

The system must enforce rate limits, handle expiry using TTL, and ensure correctness under concurrent requests.

---

## Requirements

### OTP

- 6-digit OTP
- Valid for **5 minutes**
- Can be used **only once**

### Rate Limits (per user) — Generation

| Window | Limit |
|--------|-------|
| Minute | 3     |
| Hour   | 10    |
| Day    | 20    |

### Verification

- Max **5 attempts** per OTP
- After that → OTP invalid

### Resend

- New OTP **invalidates** the previous one

---

## Expectations

1. Core Components / Data Model (pseudo code)
2. Rate Limiter Logic
3. OTP Verification Logic
4. Concurrency Handling
