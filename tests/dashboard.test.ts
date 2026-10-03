import { describe, expect, it } from "vitest";
import { renderDashboardHtml } from "../src/dashboard.js";

describe("renderDashboardHtml", () => {
  const html = renderDashboardHtml();

  it("contains the core dashboard surfaces", () => {
    expect(html).toContain("Agent Deck");
    expect(html).toContain('id="agents"');
    expect(html).toContain('id="sessions"');
    expect(html).toContain('id="output"');
    expect(html).toContain('id="stop-button"');
    expect(html).toContain("/api/events");
    expect(html).toContain("EventSource");
  });

  it("writes process output through textContent only", () => {
    expect(html).not.toContain("innerHTML");
    expect(html).toContain("textContent");
  });
});
