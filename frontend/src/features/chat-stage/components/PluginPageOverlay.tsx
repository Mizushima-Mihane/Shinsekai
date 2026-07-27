import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";

import { getPluginUiDetail } from "../../../entities/plugin/repository";
import { useI18n } from "../../../shared/i18n";
import { resolvePlatformHttpUrl } from "../../../shared/platform/platform";
import type { PluginPageTarget } from "../../../shared/plugin/PluginSlot";
import "./PluginPageOverlay.css";

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 640;
const VIEWPORT_MARGIN = 8;

type Pos = { x: number; y: number };
type Size = { height: number; width: number };
type PointerDrag = {
  moved: boolean;
  origin: Pos;
  pointerId: number;
  startX: number;
  startY: number;
};
type OverlayPage = { src: string; title: string };

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max));

// A cooperating page can shrink the frame to a "mini" silhouette at runtime by
// posting { __pluginOverlay: "drag", type: "size", mini }. Mini scales the
// declared (or default) frame down; both axes stay clamped to the viewport.
const MINI_SCALE = 0.72;

function directPage(target: PluginPageTarget): OverlayPage | null {
  if (!target.frontendUrl) {
    return null;
  }
  return {
    src: resolvePlatformHttpUrl(target.frontendUrl),
    title: target.pageTitle || target.pageId,
  };
}

function miniStorageKey(target: PluginPageTarget): string {
  return `shinsekai.plugin-overlay.mini:${target.pluginId}:${target.pageId}`;
}

function initialMini(target: PluginPageTarget): boolean {
  try {
    const saved = window.localStorage.getItem(miniStorageKey(target));
    if (saved === "1") {
      return true;
    }
    if (saved === "0") {
      return false;
    }
  } catch {
    // Storage can be unavailable in restricted desktop contexts; use the plugin default.
  }
  return target.overlayInitialMini === true;
}

function frameSize(target: PluginPageTarget, mini: boolean): Size {
  const baseHeight = target.overlayHeight ?? DEFAULT_HEIGHT;
  const baseWidth = target.overlayWidth ?? DEFAULT_WIDTH;
  const desiredHeight = mini ? Math.round(baseHeight * MINI_SCALE) : baseHeight;
  const desiredWidth = mini ? Math.round(baseWidth * MINI_SCALE) : baseWidth;
  return {
    height: Math.max(1, Math.min(desiredHeight, window.innerHeight - VIEWPORT_MARGIN * 2)),
    width: Math.max(1, Math.min(desiredWidth, window.innerWidth - VIEWPORT_MARGIN * 2)),
  };
}

function clampPosition(pos: Pos, size: Size): Pos {
  return {
    x: clamp(pos.x, VIEWPORT_MARGIN, window.innerWidth - size.width - VIEWPORT_MARGIN),
    y: clamp(pos.y, VIEWPORT_MARGIN, window.innerHeight - size.height - VIEWPORT_MARGIN),
  };
}

function initialPosition(size: Size): Pos {
  return clampPosition(
    {
      x: window.innerWidth - size.width - 24,
      y: 84,
    },
    size,
  );
}

/**
 * A floating, draggable window that hosts a plugin's frontend page over the chat
 * stage. Opened when a chat-UI-slot contribution declares pageMode "overlay"
 * (see FrontendChatUIContribution). Drag it by the bottom bar, or — for a
 * cooperating page — from any blank area inside it (the page streams
 * `{ __pluginOverlay: "drag", type, dx, dy }` messages using absolute screen
 * coordinates). Tapping the bottom bar (a press with no drag) collapses it.
 */
export function PluginPageOverlay({ onClose, target }: { onClose: () => void; target: PluginPageTarget }) {
  const { t } = useI18n();
  const [mini, setMini] = useState(() => initialMini(target));
  const [themeBg, setThemeBg] = useState<string | undefined>(target.overlayBackground);
  const [size, setSize] = useState<Size>(() => frameSize(target, initialMini(target)));
  const [pos, setPos] = useState<Pos>(() => initialPosition(frameSize(target, initialMini(target))));
  const [page, setPage] = useState<OverlayPage | null>(() => directPage(target));
  const [pageError, setPageError] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragBase = useRef<Pos | null>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const suppressClickRef = useRef(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameLoadedRef = useRef(false);

  useEffect(() => {
    let active = true;
    frameLoadedRef.current = false;
    setPage(null);
    setPageError(false);
    const immediatePage = directPage(target);
    if (immediatePage) {
      setPage(immediatePage);
      return () => {
        active = false;
      };
    }
    void getPluginUiDetail(target.pluginId)
      .then((detail) => {
        if (!active) {
          return;
        }
        const matchedPage = detail.pages.find(
          (item) => item.id === target.pageId && item.pluginId === target.pluginId && item.frontendUrl,
        );
        if (!matchedPage?.frontendUrl) {
          setPageError(true);
          return;
        }
        setPage({
          src: resolvePlatformHttpUrl(matchedPage.frontendUrl),
          title: matchedPage.title || target.pageId,
        });
      })
      .catch(() => {
        if (active) {
          setPageError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [target.frontendUrl, target.pageId, target.pageTitle, target.pluginId]);

  const postPresentation = useCallback(() => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow || !page || !target.presentationId) {
      return;
    }
    try {
      const targetOrigin = new URL(page.src, window.location.href).origin;
      frameWindow.postMessage(
        {
          __shinsekai: "plugin-page",
          payload: target.payload ?? {},
          presentationId: target.presentationId,
          type: "present",
        },
        targetOrigin,
      );
    } catch {
      // A malformed page URL is handled by the iframe load/error state.
    }
  }, [page, target.payload, target.presentationId]);

  useEffect(() => {
    if (frameLoadedRef.current) {
      postPresentation();
    }
  }, [postPresentation]);

  useEffect(() => {
    const applySize = () => {
      const nextSize = frameSize(target, mini);
      setSize(nextSize);
      setPos((current) => clampPosition(current, nextSize));
    };
    applySize();
    window.addEventListener("resize", applySize);
    return () => window.removeEventListener("resize", applySize);
  }, [mini, target]);

  const onBarPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDragRef.current = {
      moved: false,
      origin: posRef.current,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const onBarPointerMove = (event: ReactPointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }
    setPos(clampPosition({ x: drag.origin.x + dx, y: drag.origin.y + dy }, size));
  };

  const finishBarPointerDrag = (event: ReactPointerEvent) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    suppressClickRef.current = drag.moved;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onBarClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClose();
  };

  // Optional drag from inside a cooperating iframe page (press any blank area), streamed
  // via postMessage as absolute screen-coordinate deltas so moving the window stays exact.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) {
        return;
      }
      const d = event.data as {
        __pluginOverlay?: string;
        bg?: string;
        dx?: number;
        dy?: number;
        mini?: boolean;
        type?: string;
      } | null;
      if (!d || d.__pluginOverlay !== "drag") {
        return;
      }
      if (d.type === "start") {
        dragBase.current = posRef.current;
      } else if (d.type === "move" && dragBase.current) {
        const dx = Number.isFinite(d.dx) ? (d.dx ?? 0) : 0;
        const dy = Number.isFinite(d.dy) ? (d.dy ?? 0) : 0;
        setPos(
          clampPosition(
            {
              x: dragBase.current.x + dx,
              y: dragBase.current.y + dy,
            },
            size,
          ),
        );
      } else if (d.type === "end") {
        dragBase.current = null;
      } else if (d.type === "close") {
        onClose();
      } else if (d.type === "size") {
        const nextMini = d.mini === true;
        setMini(nextMini);
        try {
          window.localStorage.setItem(miniStorageKey(target), nextMini ? "1" : "0");
        } catch {
          // The live resize still works when persistent storage is unavailable.
        }
      } else if (d.type === "theme") {
        if (typeof d.bg === "string" && d.bg) {
          setThemeBg(d.bg);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onClose, size, target]);

  return createPortal(
    <section
      aria-label={page?.title || target.pageId}
      className="plugin-overlay"
      data-chat-stage-hitbox="true"
      data-plugin-page-overlay="true"
      role="dialog"
      style={{ background: themeBg, height: size.height, left: pos.x, top: pos.y, width: size.width }}
    >
      {page ? (
        <iframe
          className="plugin-overlay__frame"
          ref={frameRef}
          sandbox="allow-forms allow-same-origin allow-scripts"
          src={page.src}
          title={page.title}
          onLoad={() => {
            frameLoadedRef.current = true;
            postPresentation();
          }}
        />
      ) : (
        <div className="plugin-overlay__status" role={pageError ? "alert" : "status"}>
          {t(pageError ? "plugin.loadError.unavailable" : "plugin.detail.loading")}
        </div>
      )}
      <button
        aria-label={t("common.close")}
        className="plugin-overlay__bar"
        onClick={onBarClick}
        onPointerCancel={finishBarPointerDrag}
        onPointerDown={onBarPointerDown}
        onPointerMove={onBarPointerMove}
        onPointerUp={finishBarPointerDrag}
        style={themeBg ? ({ "--overlay-grip": "rgba(0, 0, 0, 0.3)", background: themeBg } as CSSProperties) : undefined}
        type="button"
      >
        <span aria-hidden className="plugin-overlay__grip" />
      </button>
    </section>,
    document.body,
  );
}
