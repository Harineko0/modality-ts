import { describe, expect, it } from "vitest";
import {
  parseNextConfig,
  synthesizeConfigRedirectTransitions,
} from "./config.js";

describe("parseNextConfig", () => {
  it("parses static redirects and rewrites from object literal export", () => {
    const config = parseNextConfig(
      `
        const nextConfig = {
          basePath: "/app",
          trailingSlash: true,
          redirects: async () => [
            { source: "/old", destination: "/new", permanent: true },
          ],
          rewrites: () => [
            { source: "/api/:path*", destination: "/backend/:path*" },
          ],
          i18n: {
            locales: ["en", "fr"],
            defaultLocale: "en",
          },
          cacheComponents: true,
          serverActions: {
            allowedOrigins: ["https://example.com"],
          },
        };
        export default nextConfig;
      `,
      "next.config.ts",
    );
    expect(config.basePath).toBe("/app");
    expect(config.trailingSlash).toBe(true);
    expect(config.redirects).toEqual([
      { source: "/old", destination: "/new", permanent: true },
    ]);
    expect(config.rewrites).toEqual([
      { source: "/api/:path*", destination: "/backend/:path*" },
    ]);
    expect(config.i18n).toEqual({
      locales: ["en", "fr"],
      defaultLocale: "en",
    });
    expect(config.cacheComponents).toBe(true);
    expect(config.serverActionsAllowedOrigins).toEqual(["https://example.com"]);
  });

  it("warns when config object cannot be parsed statically", () => {
    const config = parseNextConfig(
      `
        const remote = await import("./remote-config.js");
        export default remote.default;
      `,
      "next.config.mjs",
    );
    expect(config.redirects).toEqual([]);
    expect(config.warnings.some((warning) => warning.includes("static"))).toBe(
      true,
    );
  });
});

describe("synthesizeConfigRedirectTransitions", () => {
  it("creates replace navigations for static redirects", () => {
    const transitions = synthesizeConfigRedirectTransitions(
      {
        redirects: [{ source: "/old", destination: "/new", permanent: true }],
        rewrites: [],
        headers: [],
        warnings: [],
      },
      {
        routes: [
          { pattern: "/old", kind: "page" },
          { pattern: "/new", kind: "page" },
        ],
      },
    );
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.effect).toMatchObject({
      kind: "assign",
      var: "sys:route",
      expr: { kind: "lit", value: "/new" },
    });
  });
});
