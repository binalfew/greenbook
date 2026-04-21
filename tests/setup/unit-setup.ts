import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../mocks/server";

// MSW intercepts outbound HTTP during unit tests.
// `onUnhandledRequest: "bypass"` lets unmocked calls pass through —
// flip to `"error"` if you want strict contract testing.
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
