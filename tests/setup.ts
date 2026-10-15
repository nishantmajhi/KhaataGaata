import "@testing-library/jest-dom/vitest";

// Deterministic environment for every test file. Individual tests override
// these with vi.stubEnv where they need to.
process.env.SESSION_SECRET ||= "test-secret-at-least-32-bytes-long-ok";
process.env.ADMIN_PASSWORD ||= "test-password";
process.env.DATABASE_URL ||= "postgresql://u:p@ep-test-pooler.aws.neon.tech/neondb";
process.env.TZ = "UTC";
