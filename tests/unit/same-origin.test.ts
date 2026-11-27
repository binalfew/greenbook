import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireSameOrigin } from "../../server/security";

function run(method: string, path: string, headers: Record<string, string>) {
  const req = {
    method,
    path,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const next = vi.fn();
  requireSameOrigin(req, { status } as unknown as Response, next);
  return next.mock.calls.length === 1 ? "allowed" : `refused ${status.mock.calls[0]?.[0]}`;
}

const host = "greenbook.example.org";

describe("requireSameOrigin", () => {
  it("allows a write from the site's own pages", () => {
    expect(run("POST", "/t/people/new", { host, origin: `https://${host}` })).toBe("allowed");
  });

  it("refuses a write posted from another site", () => {
    expect(run("POST", "/t/people/new", { host, origin: "https://evil.example" })).toBe(
      "refused 403",
    );
    expect(run("POST", "/resources/impersonate", { host, origin: "null" })).toBe("refused 403");
  });

  it("refuses a cross-site write that carries no Origin header", () => {
    expect(run("POST", "/t/x", { host, "sec-fetch-site": "cross-site" })).toBe("refused 403");
  });

  it("allows reads from anywhere", () => {
    expect(run("GET", "/", { host, origin: "https://evil.example" })).toBe("allowed");
  });

  it("allows non-browser clients, which send neither header", () => {
    expect(run("POST", "/t/x", { host })).toBe("allowed");
  });

  it("allows the SAML identity provider to post the assertion", () => {
    expect(run("POST", "/sso/callback", { host, origin: "https://idp.example" })).toBe("allowed");
  });
});
