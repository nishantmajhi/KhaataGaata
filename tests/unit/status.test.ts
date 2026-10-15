import { describe, it, expect } from "vitest";
import {
  PROGRESS_STEPS,
  EXCEPTION_STEPS,
  ALL_STEPS,
  isProgressStatus,
  isExceptionStatus,
  isTerminalStatus,
  progressReached,
  isBackwardsMove,
  normalizeUsername,
  STATUS_STEPS,
  ORDER_ID_RE,
  isOrderStatus,
  statusLabel,
  statusIndex,
  normalizeOrderId,
  generateOrderId,
} from "@/lib/status";

describe("order ID validation", () => {
  it("accepts 4 to 8 uppercase alphanumerics", () => {
    for (const id of ["ABCD", "KG24MB", "ABCD1234", "9999"]) {
      expect(ORDER_ID_RE.test(id), id).toBe(true);
    }
  });

  it("rejects anything outside that shape", () => {
    for (const id of ["ABC", "ABCD12345", "abcd", "AB-CD", "AB CD", "", "ABCD!"]) {
      expect(ORDER_ID_RE.test(id), id).toBe(false);
    }
  });

  it("upper-cases and trims before validating", () => {
    expect(normalizeOrderId("  kg24mb  ")).toBe("KG24MB");
    expect(normalizeOrderId("kg24mb")).toBe("KG24MB");
  });

  it("returns null rather than throwing on bad input", () => {
    expect(normalizeOrderId("abc")).toBeNull();
    expect(normalizeOrderId("../../etc/passwd")).toBeNull();
    expect(normalizeOrderId("' or 1=1 --")).toBeNull();
    expect(normalizeOrderId("")).toBeNull();
  });
});

describe("order ID generation", () => {
  it("produces IDs its own validator accepts", () => {
    for (let i = 0; i < 500; i++) {
      expect(ORDER_ID_RE.test(generateOrderId())).toBe(true);
    }
  });

  it("omits characters that get misread aloud", () => {
    // I/O/0/1 are the pairs customers confuse when reading an ID over the
    // phone or copying it out of a WhatsApp message.
    const sample = Array.from({ length: 800 }, () => generateOrderId()).join("");
    expect(sample).not.toMatch(/[IO01]/);
  });

  it("honours the requested length", () => {
    expect(generateOrderId(4)).toHaveLength(4);
    expect(generateOrderId(8)).toHaveLength(8);
  });

  it("does not collide meaningfully across 5000 draws", () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generateOrderId()));
    // 32^6 ≈ 1.07e9, so duplicates in 5000 draws should be very rare.
    expect(ids.size).toBeGreaterThan(4990);
  });

  it("is not obviously biased across the alphabet", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      for (const ch of generateOrderId()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    // 32 symbols over 24000 characters ≈ 750 each. Allow a wide band; this
    // only catches a genuinely broken distribution, not normal variance.
    expect(counts.size).toBe(32);
    for (const [ch, n] of counts) {
      expect(n, `symbol ${ch}`).toBeGreaterThan(500);
      expect(n, `symbol ${ch}`).toBeLessThan(1100);
    }
  });
});

describe("status helpers", () => {
  it("has five steps in delivery order", () => {
    expect(STATUS_STEPS.map((s) => s.key)).toEqual([
      "confirmed",
      "processing",
      "shipped",
      "out_for_delivery",
      "delivered",
    ]);
  });

  it("recognises only known statuses", () => {
    expect(isOrderStatus("shipped")).toBe(true);
    expect(isOrderStatus("cancelled")).toBe(true);
    expect(isOrderStatus("lost_in_transit")).toBe(false);
    expect(isOrderStatus("")).toBe(false);
    expect(isOrderStatus(null)).toBe(false);
    expect(isOrderStatus(42)).toBe(false);
  });

  it("falls back to the raw key for an unknown label", () => {
    expect(statusLabel("shipped")).toBe("Shipped");
    expect(statusLabel("mystery")).toBe("mystery");
  });

  it("returns -1 for an unknown status index", () => {
    expect(statusIndex("confirmed")).toBe(0);
    expect(statusIndex("delivered")).toBe(4);
    expect(statusIndex("nope")).toBe(-1);
  });
});

describe("progress versus exception statuses", () => {
  it("keeps cancellation out of the delivery sequence", () => {
    expect(PROGRESS_STEPS.map((s) => s.key)).not.toContain("cancelled");
    expect(EXCEPTION_STEPS.map((s) => s.key)).toEqual(["cancelled", "refunded"]);
    expect(ALL_STEPS).toHaveLength(7);
  });

  it("classifies each status correctly", () => {
    expect(isProgressStatus("shipped")).toBe(true);
    expect(isProgressStatus("cancelled")).toBe(false);
    expect(isExceptionStatus("refunded")).toBe(true);
    expect(isExceptionStatus("delivered")).toBe(false);
  });

  it("treats delivered, cancelled and refunded as final", () => {
    // This is what stops the customer's page polling forever.
    expect(isTerminalStatus("delivered")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("refunded")).toBe(true);
    expect(isTerminalStatus("shipped")).toBe(false);
  });

  it("gives cancelled and refunded no position in the sequence", () => {
    expect(statusIndex("cancelled")).toBe(-1);
    expect(statusIndex("refunded")).toBe(-1);
  });
});

describe("progressReached", () => {
  it("is just the current step for a normal order", () => {
    expect(progressReached("shipped", [])).toBe(2);
  });

  it("recovers the high-water mark for a cancelled order", () => {
    // Cancelled while shipped: the timeline should still show three steps
    // done rather than collapsing to nothing.
    const events = [
      { status: "confirmed" },
      { status: "processing" },
      { status: "shipped" },
      { status: "cancelled" },
    ];
    expect(progressReached("cancelled", events)).toBe(2);
  });

  it("returns -1 when a cancelled order has no progress events", () => {
    expect(progressReached("cancelled", [{ status: "cancelled" }])).toBe(-1);
  });

  it("ignores event order and takes the furthest reached", () => {
    const events = [{ status: "shipped" }, { status: "confirmed" }];
    expect(progressReached("cancelled", events)).toBe(2);
  });
});

describe("isBackwardsMove", () => {
  it("spots a step back down the sequence", () => {
    expect(isBackwardsMove("shipped", "processing")).toBe(true);
    expect(isBackwardsMove("delivered", "confirmed")).toBe(true);
  });

  it("does not flag forward moves or staying put", () => {
    expect(isBackwardsMove("processing", "shipped")).toBe(false);
    expect(isBackwardsMove("shipped", "shipped")).toBe(false);
  });

  it("does not flag reopening a cancelled order", () => {
    // Cancelled has no index, so reopening is handled as its own action
    // rather than being treated as a backwards step.
    expect(isBackwardsMove("cancelled", "processing")).toBe(false);
    expect(isBackwardsMove("shipped", "cancelled")).toBe(false);
  });
});

describe("normalizeUsername", () => {
  it("lower-cases and trims", () => {
    expect(normalizeUsername("  Sunita  ")).toBe("sunita");
  });

  it("accepts the punctuation people actually use", () => {
    expect(normalizeUsername("bikash.rai")).toBe("bikash.rai");
    expect(normalizeUsername("anjali_g")).toBe("anjali_g");
    expect(normalizeUsername("ram-2")).toBe("ram-2");
  });

  it("rejects anything too short, too long or with spaces", () => {
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("a".repeat(33))).toBeNull();
    expect(normalizeUsername("has space")).toBeNull();
    expect(normalizeUsername("has@symbol")).toBeNull();
    expect(normalizeUsername("")).toBeNull();
  });
});
