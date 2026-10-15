// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

// The form imports the server-action module, which pulls in next/headers.
// Stub it: these tests are about the client-side behaviour of the form.
vi.mock("@/app/admin/actions", () => ({
  addOrder: vi.fn(async () => ({})),
  editOrder: vi.fn(async () => ({})),
  signIn: vi.fn(async () => ({})),
  updateStatus: vi.fn(async () => ({})),
  closeOrderAction: vi.fn(async () => ({})),
  signOut: vi.fn(),
}));

const { TrackForm } = await import("@/app/TrackForm");
const { OrderForm } = await import("@/components/OrderForm");
const { addOrder } = await import("@/app/admin/actions");

const NewOrderForm = () => (
  <OrderForm action={addOrder} submitLabel="Save order" pendingLabel="Saving…" showNote />
);

beforeEach(() => push.mockClear());

describe("TrackForm", () => {
  const type = (value: string) => {
    const input = screen.getByLabelText(/order id/i);
    fireEvent.change(input, { target: { value } });
    return input;
  };

  it("upper-cases as the customer types", () => {
    render(<TrackForm />);
    const input = type("kg24mb") as HTMLInputElement;
    expect(input.value).toBe("KG24MB");
  });

  it("navigates to the tracking page for a valid ID", () => {
    render(<TrackForm />);
    type("KG24MB");
    fireEvent.click(screen.getByRole("button", { name: /track order/i }));
    expect(push).toHaveBeenCalledWith("/track/KG24MB");
  });

  it("explains what is wrong instead of navigating", () => {
    render(<TrackForm />);
    type("AB");
    fireEvent.click(screen.getByRole("button", { name: /track order/i }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/4–8 letters and numbers/i);
  });

  it("clears the error as soon as the customer edits the field", () => {
    render(<TrackForm />);
    type("AB");
    fireEvent.click(screen.getByRole("button", { name: /track order/i }));
    expect(screen.getByRole("alert")).not.toBeEmptyDOMElement();

    type("ABCD");
    expect(screen.getByRole("alert")).toBeEmptyDOMElement();
  });

  it("does not submit an empty field", () => {
    render(<TrackForm />);
    fireEvent.click(screen.getByRole("button", { name: /track order/i }));
    expect(push).not.toHaveBeenCalled();
  });

  it("stops the customer typing past the maximum length", () => {
    render(<TrackForm />);
    expect(screen.getByLabelText(/order id/i)).toHaveAttribute("maxLength", "8");
  });

  it("ties the error message to the input for screen readers", () => {
    render(<TrackForm />);
    const input = screen.getByLabelText(/order id/i);
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveAttribute("role", "alert");
  });
});

describe("NewOrderForm", () => {
  const rupees = () => screen.getAllByPlaceholderText("0");
  const titles = () => screen.getAllByPlaceholderText(/A5 ruled/i);

  it("starts with a single empty item row", () => {
    render(<NewOrderForm />);
    expect(titles()).toHaveLength(1);
  });

  it("adds a row on request", () => {
    render(<NewOrderForm />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    expect(titles()).toHaveLength(2);
  });

  it("will not let staff remove the last remaining row", () => {
    render(<NewOrderForm />);
    expect(screen.getByRole("button", { name: /remove item 1/i })).toBeDisabled();
  });

  it("removes the row the staff actually clicked, not the last one", () => {
    render(<NewOrderForm />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(titles()[0], { target: { value: "First" } });
    fireEvent.change(titles()[1], { target: { value: "Second" } });

    fireEvent.click(screen.getByRole("button", { name: /remove item 1/i }));

    const remaining = titles() as HTMLInputElement[];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].value).toBe("Second");
  });

  it("shows a running total as amounts are entered", () => {
    render(<NewOrderForm />);
    const qty = screen.getAllByDisplayValue("1")[0];
    fireEvent.change(qty, { target: { value: "2" } });
    fireEvent.change(rupees()[0], { target: { value: "650" } });
    expect(screen.getByText("Rs 1,300")).toBeInTheDocument();
  });

  it("sums across several rows", () => {
    render(<NewOrderForm />);
    fireEvent.click(screen.getByRole("button", { name: /add item/i }));
    fireEvent.change(rupees()[0], { target: { value: "650" } });
    fireEvent.change(rupees()[1], { target: { value: "550" } });
    expect(screen.getByText("Rs 1,200")).toBeInTheDocument();
  });

  it("shows zero rather than NaN for junk input", () => {
    render(<NewOrderForm />);
    fireEvent.change(rupees()[0], { target: { value: "abc" } });
    expect(screen.getByText("Rs 0")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("pre-fills a sensible first timeline note", () => {
    render(<NewOrderForm />);
    expect(screen.getByLabelText(/first timeline note/i)).toHaveValue(
      "Payment confirmed, order recorded."
    );
  });

  it("marks the customer name as required", () => {
    render(<NewOrderForm />);
    expect(screen.getByLabelText(/customer name/i)).toBeRequired();
  });
});

describe("OrderForm in edit mode", () => {
  const defaults = {
    customerName: "Sunita Shrestha",
    customerPhone: "+977 9800000000",
    address: "Jhamsikhel, Lalitpur",
    items: [
      { title: "A5 ruled", qty: "2", price: "650" },
      { title: "A6 plain", qty: "1", price: "550" },
    ],
  };

  const renderEdit = () =>
    render(
      <OrderForm
        action={addOrder}
        orderId="KG24MB"
        submitLabel="Save changes"
        pendingLabel="Saving…"
        defaults={defaults}
      />
    );

  it("pre-fills the customer's existing details", () => {
    renderEdit();
    expect(screen.getByLabelText(/customer name/i)).toHaveValue("Sunita Shrestha");
    expect(screen.getByLabelText(/whatsapp number/i)).toHaveValue("+977 9800000000");
    expect(screen.getByLabelText(/delivery address/i)).toHaveValue("Jhamsikhel, Lalitpur");
  });

  it("pre-fills every existing item row", () => {
    renderEdit();
    const titles = screen.getAllByPlaceholderText(/A5 ruled/i) as HTMLInputElement[];
    expect(titles).toHaveLength(2);
    expect(titles[0].value).toBe("A5 ruled");
    expect(titles[1].value).toBe("A6 plain");
  });

  it("shows the existing total straight away", () => {
    renderEdit();
    // 2 × 650 + 1 × 550
    expect(screen.getByText("Rs 1,850")).toBeInTheDocument();
  });

  it("carries the order ID so the action knows what to update", () => {
    const { container } = renderEdit();
    const hidden = container.querySelector('input[name="orderId"]') as HTMLInputElement;
    expect(hidden.value).toBe("KG24MB");
  });

  it("does not offer a first timeline note when editing", () => {
    renderEdit();
    // That note seeds the timeline on creation; editing must not re-write it.
    expect(screen.queryByLabelText(/first timeline note/i)).not.toBeInTheDocument();
  });

  it("still lets staff add and remove item rows", () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: /remove item 1/i }));
    const titles = screen.getAllByPlaceholderText(/A5 ruled/i) as HTMLInputElement[];
    expect(titles).toHaveLength(1);
    expect(titles[0].value).toBe("A6 plain");
  });

  it("uses the caller's submit label", () => {
    renderEdit();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });
});
