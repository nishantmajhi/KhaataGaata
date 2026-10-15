export type RecordedQuery = { text: string; params: unknown[] };

type Handler = (params: unknown[], text: string) => unknown[] | Promise<unknown[]>;

/**
 * Stands in for the tagged-template function returned by neon(). It records
 * every statement, substitutes $1/$2 placeholders the same way the real
 * driver does, and lets a test route statements to canned rows by regex.
 *
 * This exercises the real SQL our code builds without needing a database.
 */
export function createFakeSql() {
  const queries: RecordedQuery[] = [];
  const routes: { pattern: RegExp; handler: Handler }[] = [];

  const sql = (strings: TemplateStringsArray | string, ...values: unknown[]) => {
    let text: string;
    let params: unknown[];

    if (typeof strings === "string") {
      text = strings;
      params = (values[0] as unknown[]) ?? [];
    } else {
      text = strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ""),
        ""
      );
      params = values;
    }

    const normalized = text.replace(/\s+/g, " ").trim();
    queries.push({ text: normalized, params });

    const route = routes.find((r) => r.pattern.test(normalized));
    return Promise.resolve(route ? route.handler(params, normalized) : []);
  };

  return {
    sql,
    queries,
    /** Route statements matching `pattern` to `handler`. First match wins. */
    when(pattern: RegExp, handler: Handler) {
      routes.push({ pattern, handler });
      return this;
    },
    /** Every statement recorded so far, whitespace-normalised. */
    texts: () => queries.map((q) => q.text),
    find: (pattern: RegExp) => queries.find((q) => pattern.test(q.text)),
    all: (pattern: RegExp) => queries.filter((q) => pattern.test(q.text)),
    reset() {
      queries.length = 0;
      routes.length = 0;
    },
  };
}

export type FakeSql = ReturnType<typeof createFakeSql>;

/**
 * vi.mock is hoisted above every const in a test file, so the fake has to be
 * built inside vi.hoisted. Usage at the top of a test file:
 *
 *   const fake = await vi.hoisted(async () => {
 *     const { createFakeSql } = await import("../helpers/fake-sql");
 *     return createFakeSql();
 *   });
 *   vi.mock("@/lib/db", () => ({ sql: fake.sql }));
 */
