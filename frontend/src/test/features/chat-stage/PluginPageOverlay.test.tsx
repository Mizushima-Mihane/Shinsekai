import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PluginPageOverlay } from "../../../features/chat-stage/components/PluginPageOverlay";
import { I18nProvider } from "../../../shared/i18n/I18nProvider";
import type { PluginPageTarget } from "../../../shared/plugin/PluginSlot";

const repository = vi.hoisted(() => ({
  getUi: vi.fn(),
}));

vi.mock("../../../entities/plugin/repository", () => ({
  getPluginUiDetail: (pluginId: string) => repository.getUi(pluginId),
}));

function renderOverlay(
  onClose = vi.fn(),
  target: PluginPageTarget = {
    mode: "overlay",
    pageId: "dashboard",
    pluginId: "demo.plugin",
  },
) {
  render(
    <I18nProvider language="en">
      <PluginPageOverlay onClose={onClose} target={target} />
    </I18nProvider>,
  );
  return onClose;
}

describe("PluginPageOverlay", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 620, writable: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 360, writable: true });
    repository.getUi.mockReset().mockResolvedValue({
      pages: [
        {
          frontendUrl:
            "/api/plugins/demo.plugin/frontend/dashboard/?pluginId=demo.plugin&pageId=dashboard&shinsekai_bridge_token=secret",
          id: "dashboard",
          kind: "tools",
          order: 10,
          pluginId: "demo.plugin",
          pluginVersion: "1.0.0",
          title: "Dashboard",
        },
      ],
      plugin: { id: "demo.plugin" },
    });
  });

  it("loads the registered page through the configured bridge and stays inside a small viewport", async () => {
    vi.stubEnv("VITE_SHINSEKAI_API_BASE", "http://127.0.0.1:8787");
    renderOverlay();

    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    const overlay = screen.getByRole("dialog", { name: "Dashboard" });

    expect(repository.getUi).toHaveBeenCalledWith("demo.plugin");
    expect(frame.src).toBe(
      "http://127.0.0.1:8787/api/plugins/demo.plugin/frontend/dashboard/" +
        "?pluginId=demo.plugin&pageId=dashboard&shinsekai_bridge_token=secret",
    );
    expect(overlay).toHaveStyle({ height: "604px", left: "8px", top: "8px", width: "344px" });
  });

  it("mounts a contribution-provided page immediately without a detail request", async () => {
    vi.stubEnv("VITE_SHINSEKAI_API_BASE", "http://127.0.0.1:8787");
    renderOverlay(vi.fn(), {
      frontendUrl: "/api/plugins/demo.plugin/frontend/dashboard/?pluginId=demo.plugin&pageId=dashboard",
      mode: "overlay",
      pageId: "dashboard",
      pageTitle: "Dashboard",
      pluginId: "demo.plugin",
    });

    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    expect(repository.getUi).not.toHaveBeenCalled();
    expect(frame.src).toBe(
      "http://127.0.0.1:8787/api/plugins/demo.plugin/frontend/dashboard/?pluginId=demo.plugin&pageId=dashboard",
    );
  });

  it("closes from the host button and rejects pages not owned by the target plugin", async () => {
    repository.getUi.mockResolvedValue({
      pages: [
        {
          frontendUrl: "/api/plugins/other/frontend/dashboard/",
          id: "dashboard",
          kind: "tools",
          order: 10,
          pluginId: "other.plugin",
          pluginVersion: "1.0.0",
          title: "Wrong owner",
        },
      ],
      plugin: { id: "demo.plugin" },
    });
    const onClose = renderOverlay();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTitle("Wrong owner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }), { detail: 0 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clamps iframe-driven dragging so the host controls remain visible", async () => {
    renderOverlay();
    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    const overlay = screen.getByRole("dialog", { name: "Dashboard" });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", type: "start" },
          source: frame.contentWindow,
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", dx: 10_000, dy: 10_000, type: "move" },
          source: frame.contentWindow,
        }),
      );
    });

    await waitFor(() => expect(overlay).toHaveStyle({ left: "8px", top: "8px" }));
  });

  it("delivers a runtime presentation payload only to the registered page origin", async () => {
    vi.stubEnv("VITE_SHINSEKAI_API_BASE", "http://127.0.0.1:8787");
    renderOverlay(vi.fn(), {
      mode: "overlay",
      pageId: "dashboard",
      payload: { kind: "reminder", title: "Tea is ready" },
      pluginId: "demo.plugin",
      presentationId: "notice-42",
    });
    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");

    fireEvent.load(frame);

    expect(postMessage).toHaveBeenLastCalledWith(
      {
        __shinsekai: "plugin-page",
        payload: { kind: "reminder", title: "Tea is ready" },
        presentationId: "notice-42",
        type: "present",
      },
      "http://127.0.0.1:8787",
    );
  });

  it("honors a plugin-declared overlay size and background", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000, writable: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000, writable: true });
    renderOverlay(vi.fn(), {
      mode: "overlay",
      overlayBackground: "rgb(43, 26, 36)",
      overlayHeight: 720,
      overlayWidth: 420,
      pageId: "dashboard",
      pluginId: "demo.plugin",
    });

    const overlay = await screen.findByRole("dialog", { name: "Dashboard" });
    expect(overlay).toHaveStyle({ background: "rgb(43, 26, 36)", height: "720px", width: "420px" });
  });

  it("resizes to a mini silhouette on request and restores on normal", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000, writable: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000, writable: true });
    renderOverlay(vi.fn(), {
      mode: "overlay",
      overlayHeight: 720,
      overlayWidth: 420,
      pageId: "dashboard",
      pluginId: "demo.plugin",
    });
    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    const overlay = screen.getByRole("dialog", { name: "Dashboard" });
    expect(overlay).toHaveStyle({ height: "720px", width: "420px" });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", mini: true, type: "size" },
          source: frame.contentWindow,
        }),
      );
    });
    // 420*0.72 -> 302, 720*0.72 -> 518 (both well inside the 2000px viewport)
    await waitFor(() => expect(overlay).toHaveStyle({ height: "518px", width: "302px" }));

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", mini: false, type: "size" },
          source: frame.contentWindow,
        }),
      );
    });
    await waitFor(() => expect(overlay).toHaveStyle({ height: "720px", width: "420px" }));
  });

  it("uses the contribution's saved mini state on its first frame", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000, writable: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000, writable: true });
    renderOverlay(vi.fn(), {
      frontendUrl: "/api/plugins/demo.plugin/frontend/dashboard/",
      mode: "overlay",
      overlayHeight: 860,
      overlayInitialMini: true,
      overlayWidth: 400,
      pageId: "dashboard",
      pageTitle: "Dashboard",
      pluginId: "demo.plugin",
    });

    const overlay = await screen.findByRole("dialog", { name: "Dashboard" });
    expect(overlay).toHaveStyle({ height: "619px", width: "288px" });
    expect(repository.getUi).not.toHaveBeenCalled();
  });

  it("remembers a page's mini state when it is opened again", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 2000, writable: true });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000, writable: true });
    const target: PluginPageTarget = {
      frontendUrl: "/api/plugins/demo.plugin/frontend/dashboard/",
      mode: "overlay",
      overlayHeight: 860,
      overlayWidth: 400,
      pageId: "dashboard",
      pageTitle: "Dashboard",
      pluginId: "demo.plugin",
    };
    const first = render(
      <I18nProvider language="en">
        <PluginPageOverlay onClose={vi.fn()} target={target} />
      </I18nProvider>,
    );
    const firstFrame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", mini: true, type: "size" },
          source: firstFrame.contentWindow,
        }),
      );
    });
    first.unmount();
    renderOverlay(vi.fn(), target);

    const overlay = await screen.findByRole("dialog", { name: "Dashboard" });
    expect(overlay).toHaveStyle({ height: "619px", width: "288px" });
  });

  it("recolors the overlay shell to the theme color the page reports", async () => {
    renderOverlay(vi.fn(), {
      mode: "overlay",
      overlayBackground: "rgb(235, 230, 238)",
      pageId: "dashboard",
      pluginId: "demo.plugin",
    });
    const frame = (await screen.findByTitle("Dashboard")) as HTMLIFrameElement;
    const overlay = screen.getByRole("dialog", { name: "Dashboard" });
    expect(overlay).toHaveStyle({ background: "rgb(235, 230, 238)" });

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { __pluginOverlay: "drag", bg: "rgb(229, 237, 244)", type: "theme" },
          source: frame.contentWindow,
        }),
      );
    });
    await waitFor(() => expect(overlay).toHaveStyle({ background: "rgb(229, 237, 244)" }));
  });
});
