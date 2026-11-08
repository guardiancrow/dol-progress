import { expect, it } from "vitest";
import config from "../../src-tauri/tauri.conf.json";
import viteSource from "../../vite.config.ts?raw";
import { RELEASE_API_URL } from "./checkRelease";

it("limits production and desktop development CSP to the fixed API while retaining IPC and local HMR", () => {
  const { csp, devCsp } = config.app.security;
  for (const policy of [csp, devCsp]) {
    const sources = policy.split(/\s+/).slice(1);
    expect(sources.filter(s=>s.startsWith("https:"))).toEqual([RELEASE_API_URL]);
    expect(sources).toContain("ipc:");
    expect(sources).toContain("http://ipc.localhost");
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("https:");
    expect(sources).not.toContain("ws:");
  }
  expect(csp).not.toContain("ws://");
  expect(devCsp).toContain("ws://localhost:1420");
  expect(viteSource).toContain(`"Content-Security-Policy": ${JSON.stringify(devCsp)}`);
  expect(viteSource).toContain('"**/tmp/**"');
});
