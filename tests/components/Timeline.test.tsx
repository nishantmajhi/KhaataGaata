// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Timeline, formatStamp } from "@/components/Timeline";

const events = (...pairs: [string, string, string | null][]) =>
  pairs.map(([status, created_at, note]) => ({ status, created_at, note }));

describe("formatStamp", () => {
  it("renders in Kathmandu time regardless of server locale", () => {
    // 07:44 UTC is 13:29 in Kathmandu (UTC+05:45), shown 12-hour as 01:29 pm.
    // Pinning this is what stops the server and browser disagreeing and
    // triggering a hydration mismatch.
    const stamp = formatStamp("2026-08-10T07:44:00.000Z");
    expect(stamp).toContain("01:29 pm");
    expect(stamp).toContain("10 Aug 2026");
  });

  it("applies the +05:45 offset, not a whole-hour approximation", () => {
    // A naive UTC+06:00 would give 02:00 pm here; the odd 45-minute offset is
    // exactly the kind of thing a refactor quietly breaks.
    expect(formatStamp("2026-08-10T08:15:00.000Z")).toContain("02:00 pm");
  });

  it("shows a dash for a missing or unparseable stamp", () => {
    expect(formatStamp(null)).toBe("—");
    expect(formatStamp("not-a-date")).toBe("—");
  });

  it("rolls the date over correctly near midnight Kathmandu", () => {
    // 18:20 UTC is 00:05 the next day in Kathmandu.
    expect(formatStamp("2026-08-10T18:20:00.000Z")).toContain("11 Aug 2026");
  });
});

describe("Timeline", () => {
  it("renders all five steps whatever the current status", () => {
    render(<Timeline status="confirmed" events={[]} />);
    for (const label of [
      "Order confirmed",
      "Processing",
      "Shipped",
      "Out for delivery",
      "Delivered",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("marks earlier steps done and the current one active", () => {
    const { container } = render(
      <Timeline
        status="shipped"
        events={events(
          ["confirmed", "2026-08-10T07:44:00.000Z", null],
          ["processing", "2026-08-11T07:44:00.000Z", null],
          ["shipped", "2026-08-13T01:44:00.000Z", null]
        )}
      />
    );
    expect(container.querySelectorAll(".t-dot.done")).toHaveLength(2);
    expect(container.querySelectorAll(".t-dot.active")).toHaveLength(1);
  });

  it("greys out steps that have not happened yet", () => {
    const { container } = render(<Timeline status="processing" events={[]} />);
    // confirmed + processing are not future; the remaining three are.
    expect(container.querySelectorAll(".t-name.muted")).toHaveLength(3);
  });

  it("shows every step done-or-active when delivered", () => {
    const { container } = render(<Timeline status="delivered" events={[]} />);
    expect(container.querySelectorAll(".t-dot.done")).toHaveLength(4);
    expect(container.querySelectorAll(".t-dot.active")).toHaveLength(1);
  });

  it("renders the staff note under its step", () => {
    render(
      <Timeline
        status="shipped"
        events={events(["shipped", "2026-08-13T01:44:00.000Z", "Handed to the courier in Patan"])}
      />
    );
    expect(screen.getByText("Handed to the courier in Patan")).toBeInTheDocument();
  });

  it("shows a dash for steps with no recorded event", () => {
    render(<Timeline status="confirmed" events={[]} />);
    expect(screen.getAllByText("—")).toHaveLength(5);
  });

  it("prefers the latest event when a status was set twice", () => {
    render(
      <Timeline
        status="shipped"
        events={events(
          ["shipped", "2026-08-12T01:44:00.000Z", "First attempt"],
          ["shipped", "2026-08-13T01:44:00.000Z", "Corrected"]
        )}
      />
    );
    expect(screen.getByText("Corrected")).toBeInTheDocument();
    expect(screen.queryByText("First attempt")).not.toBeInTheDocument();
  });

  it("does not crash on an unknown status", () => {
    // statusIndex returns -1, so nothing is done and everything is future.
    const { container } = render(<Timeline status="cancelled" events={[]} />);
    expect(container.querySelectorAll(".t-dot.done")).toHaveLength(0);
    expect(container.querySelectorAll(".t-dot.active")).toHaveLength(0);
    expect(container.querySelectorAll(".t-name.muted")).toHaveLength(5);
  });

  it("uses an ordered list so the sequence is conveyed to screen readers", () => {
    const { container } = render(<Timeline status="confirmed" events={[]} />);
    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelectorAll("li")).toHaveLength(5);
  });

  it("does not draw a connecting line past the last step", () => {
    const { container } = render(<Timeline status="delivered" events={[]} />);
    const steps = container.querySelectorAll(".t-step");
    expect(steps[steps.length - 1].className).not.toContain("done-line");
  });
});

describe("Timeline for a halted order", () => {
  const cancelledMidway = events(
    ["confirmed", "2026-08-10T07:44:00.000Z", null],
    ["processing", "2026-08-11T07:44:00.000Z", null],
    ["shipped", "2026-08-12T07:44:00.000Z", null],
    ["cancelled", "2026-08-13T07:44:00.000Z", "Customer changed their mind"]
  );

  it("keeps the progress the order actually made", () => {
    const { container } = render(
      <Timeline status="cancelled" events={cancelledMidway} />
    );
    // Confirmed, processing and shipped all happened before the cancellation,
    // so the customer should still see them.
    expect(container.querySelectorAll(".t-dot.done")).toHaveLength(3);
  });

  it("shows no active step, because nothing is in progress any more", () => {
    const { container } = render(
      <Timeline status="cancelled" events={cancelledMidway} />
    );
    expect(container.querySelectorAll(".t-dot.active")).toHaveLength(0);
  });

  it("adds a closing step naming the outcome and the reason", () => {
    render(<Timeline status="cancelled" events={cancelledMidway} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Customer changed their mind")).toBeInTheDocument();
  });

  it("distinguishes a refund from a cancellation", () => {
    render(
      <Timeline
        status="refunded"
        events={events(["refunded", "2026-08-13T07:44:00.000Z", "Damaged in transit"])}
      />
    );
    expect(screen.getByText("Refunded")).toBeInTheDocument();
    expect(screen.queryByText("Cancelled")).not.toBeInTheDocument();
  });

  it("renders six list items: five steps plus the closing one", () => {
    const { container } = render(
      <Timeline status="cancelled" events={cancelledMidway} />
    );
    expect(container.querySelectorAll("li")).toHaveLength(6);
  });

  it("handles cancellation before anything else happened", () => {
    const { container } = render(
      <Timeline
        status="cancelled"
        events={events(["cancelled", "2026-08-13T07:44:00.000Z", "Duplicate order"])}
      />
    );
    expect(container.querySelectorAll(".t-dot.done")).toHaveLength(0);
    expect(container.querySelectorAll(".t-name.muted")).toHaveLength(5);
    expect(screen.getByText("Duplicate order")).toBeInTheDocument();
  });

  it("does not run the connecting line past the closing step", () => {
    const { container } = render(
      <Timeline status="cancelled" events={cancelledMidway} />
    );
    const steps = container.querySelectorAll(".t-step");
    expect(steps[steps.length - 1].className).toContain("t-step-halted");
  });
});
