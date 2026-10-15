import { describe, it, expect } from "vitest";
import { clientIp } from "@/lib/ratelimit";

/**
 * Every rate limit in this application is keyed on whatever clientIp() returns:
 * five login attempts per ten minutes, twenty order lookups per minute, forty
 * staff writes per minute. If a visitor can choose their own key, they get a
 * fresh allowance per request and none of those limits exist.
 *
 * X-Forwarded-For is a list that each proxy appends to, so the leftmost entry
 * is whatever the client sent and the rightmost is the one the nearest trusted
 * proxy wrote. Reading it left to right reads the attacker's value.
 */

const REAL = "203.0.113.7";

describe("clientIp", () => {
  it("does not let a visitor choose their own rate-limit bucket", () => {
    const spoofed = new Headers({ "x-forwarded-for": `1.2.3.4, ${REAL}` });
    expect(clientIp(spoofed)).toBe(REAL);
  });

  it("gives every forged prefix the same bucket", () => {
    // The attack is a loop: send a different first entry each time and each
    // request looks like a new visitor. All of these must collapse to one key.
    const keys = new Set(
      ["9.9.9.9", "8.8.8.8", "1.1.1.1", ""].map((forged) =>
        clientIp(new Headers({ "x-forwarded-for": `${forged}, ${REAL}` }))
      )
    );
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(REAL);
  });

  it("ignores a forged x-real-ip when the proxy chain is present", () => {
    const headers = new Headers({
      "x-real-ip": "1.2.3.4",
      "x-forwarded-for": `1.2.3.4, ${REAL}`,
    });
    expect(clientIp(headers)).toBe(REAL);
  });

  it("uses a single x-forwarded-for value as-is", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": REAL }))).toBe(REAL);
  });

  it("trims the whitespace a proxy leaves after each comma", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": `1.2.3.4,   ${REAL}   ` }))).toBe(REAL);
  });

  it("falls back to x-real-ip when there is no forwarded chain", () => {
    expect(clientIp(new Headers({ "x-real-ip": REAL }))).toBe(REAL);
  });

  it("skips empty trailing entries rather than returning an empty key", () => {
    // A key of "" would silently merge with every other header-less request.
    expect(clientIp(new Headers({ "x-forwarded-for": `${REAL}, ` }))).toBe(REAL);
  });

  it("returns a single shared bucket when there is nothing to key on", () => {
    // Fail closed: one shared allowance is a working limit, a unique key per
    // request is no limit at all.
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
