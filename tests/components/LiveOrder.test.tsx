// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { PublicOrder } from "@/lib/orders";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const { LiveOrder } = await import("@/app/track/[orderId]/LiveOrder");

const POLL_MS = 15_000;

const order = (over: Partial<PublicOrder> = {}): PublicOrder => ({
  order_id: "KG24MB",
  status: "shipped",
  created_at: "2026-08-10T07:44:00.000Z",
  updated_at: "2026-08-13T01:44:00.000Z",
  events: [{ status: "confirmed", note: null, created_at: "2026-08-10T07:44:00.000Z" }],
  ...over,
});

function setVisibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
  fetchMock = vi.fn(async () => new Response(JSON.stringify(order()), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Advances timers and flushes the promise chain a poll produces. */
async function tick(ms = POLL_MS) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("initial render", () => {
  it("shows the server-rendered order without waiting for a fetch", () => {
    render(<LiveOrder initial={order()} />);
    expect(screen.getByText("KG24MB")).toBeInTheDocument();
    expect(screen.getAllByText("Shipped").length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says it is updating automatically while in progress", () => {
    render(<LiveOrder initial={order()} />);
    expect(screen.getByText(/updating automatically/i)).toBeInTheDocument();
  });
});

describe("polling", () => {
  it("polls the public endpoint after the interval", async () => {
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders/KG24MB");
  });

  it("asks for a fresh copy rather than a cached one", async () => {
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("renders a status change picked up from the server", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
          order({
            status: "delivered",
            events: [
              { status: "delivered", note: "Left with the neighbour", created_at: "2026-08-13T09:00:00.000Z" },
            ],
          })
        ),
        { status: 200 }
      )
    );
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(screen.getByText("Left with the neighbour")).toBeInTheDocument();
  });

  it("keeps polling while the order is still moving", async () => {
    render(<LiveOrder initial={order()} />);
    await tick();
    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("polling stops when it should", () => {
  it("never starts for an order that is already delivered", async () => {
    render(<LiveOrder initial={order({ status: "delivered" })} />);
    await tick();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/this order is complete/i)).toBeInTheDocument();
  });

  it("stops once a poll reports delivery", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(order({ status: "delivered" })), { status: 200 })
    );
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await tick();
    await tick();
    // No further requests after the terminal status arrives.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the request while the tab is hidden", async () => {
    setVisibility("hidden");
    render(<LiveOrder initial={order()} />);
    await tick();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resumes when the tab becomes visible again", async () => {
    setVisibility("hidden");
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the component unmounts", async () => {
    const { unmount } = render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("failure handling", () => {
  it("backs off instead of hammering a rate-limited endpoint", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 429 }));
    render(<LiveOrder initial={order()} />);

    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Next attempt is at 30s, not 15s.
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tells the customer it is reconnecting rather than failing silently", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });

  it("recovers and resets the interval after a successful poll", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    render(<LiveOrder initial={order()} />);

    await tick(POLL_MS);
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();

    // Backed off to 30s.
    await tick(POLL_MS * 2);
    expect(screen.getByText(/updating automatically/i)).toBeInTheDocument();

    // Interval is back to 15s.
    await tick(POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps showing the last known good data through an outage", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(screen.getByText("KG24MB")).toBeInTheDocument();
    expect(screen.getAllByText("Shipped").length).toBeGreaterThan(0);
  });

  it("caps the backoff so it always eventually retries", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<LiveOrder initial={order()} />);

    // Drive the backoff to its ceiling.
    for (let i = 0; i < 10; i++) await tick(200_000);
    const callsSoFar = fetchMock.mock.calls.length;

    // Two minutes is the documented ceiling, so this must produce a retry.
    await tick(120_000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsSoFar);
  });
});

describe("halted orders", () => {
  it("never polls for a cancelled order", async () => {
    render(<LiveOrder initial={order({ status: "cancelled" })} />);
    await tick();
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never polls for a refunded order", async () => {
    render(<LiveOrder initial={order({ status: "refunded" })} />);
    await tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says plainly what happened rather than 'updating automatically'", async () => {
    render(<LiveOrder initial={order({ status: "cancelled" })} />);
    expect(screen.getByText(/this order was cancelled/i)).toBeInTheDocument();
    expect(screen.queryByText(/updating automatically/i)).not.toBeInTheDocument();
  });

  it("stops polling as soon as a cancellation arrives", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
          order({
            status: "cancelled",
            events: [
              {
                status: "cancelled",
                note: "Customer changed their mind",
                created_at: "2026-08-13T09:00:00.000Z",
              },
            ],
          })
        ),
        { status: 200 }
      )
    );
    render(<LiveOrder initial={order()} />);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Customer changed their mind")).toBeInTheDocument();

    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
