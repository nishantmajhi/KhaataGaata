import { PROGRESS_STEPS, isExceptionStatus, progressReached, statusLabel } from "@/lib/status";

type TimelineEvent = { status: string; note: string | null; created_at: string };

// Fixed to Kathmandu so the server and the browser render the same string.
// Without an explicit time zone this component would hydrate with a mismatch.
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kathmandu",
});
const TIME_FMT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
  timeZone: "Asia/Kathmandu",
});

export function formatStamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${DATE_FMT.format(d)} · ${TIME_FMT.format(d)}`;
}

const Check = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
    <polyline
      points="1.5,4 3.2,5.8 6.5,2.5"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const Dot = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
    <circle cx="4" cy="4" r="2" fill="white" />
  </svg>
);

const Cross = () => (
  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
    <path
      d="M2 2l4 4M6 2l-4 4"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export function Timeline({
  status,
  events,
}: {
  status: string;
  events: TimelineEvent[];
}) {
  const halted = isExceptionStatus(status);
  // For a halted order this is the furthest step it actually reached, so the
  // customer still sees the history rather than an empty timeline.
  const currentIdx = progressReached(status, events);

  // Latest event wins if a status was set more than once.
  const byStatus = new Map<string, TimelineEvent>();
  for (const ev of events) byStatus.set(ev.status, ev);
  const closing = halted ? byStatus.get(status) : undefined;

  return (
    <ol className="timeline">
      {PROGRESS_STEPS.map((step, i) => {
        const isDone = i < currentIdx || (halted && i <= currentIdx);
        const isActive = !halted && i === currentIdx;
        const isLast = i === PROGRESS_STEPS.length - 1 && !halted;
        const ev = byStatus.get(step.key);

        return (
          <li
            key={step.key}
            className={`t-step${(isDone || isActive) && !isLast ? " done-line" : ""}`}
          >
            <div className="t-dot-col">
              <div className={`t-dot${isDone ? " done" : isActive ? " active" : ""}`}>
                {isDone ? <Check /> : isActive ? <Dot /> : null}
              </div>
            </div>
            <div className="t-content">
              <div className={i > currentIdx ? "t-name muted" : "t-name"}>{step.label}</div>
              <div className="t-date">{formatStamp(ev?.created_at ?? null)}</div>
              {ev?.note ? <div className="t-note">{ev.note}</div> : null}
            </div>
          </li>
        );
      })}

      {halted ? (
        <li className="t-step t-step-halted">
          <div className="t-dot-col">
            <div className="t-dot halted">
              <Cross />
            </div>
          </div>
          <div className="t-content">
            <div className="t-name halted">{statusLabel(status)}</div>
            <div className="t-date">{formatStamp(closing?.created_at ?? null)}</div>
            {closing?.note ? <div className="t-note">{closing.note}</div> : null}
          </div>
        </li>
      ) : null}
    </ol>
  );
}
