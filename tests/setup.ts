// Tests must never hit the real API; allow the client to be constructed with
// a mocked fetch while keeping every other guardrail active.
process.env.ALLOW_LIVE_API = "true";
process.env.NODE_ENV = "test";
