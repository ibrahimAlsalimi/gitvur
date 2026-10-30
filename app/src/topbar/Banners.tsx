import { bannersFor } from "./banners";
import { useAppStore } from "../store/useAppStore";

/** Banners below the top bar; each can be dismissed for the session. */
export function Banners() {
  const bundle = useAppStore((s) => s.bundle);
  const dismissed = useAppStore((s) => s.dismissedBanners);
  const phase = useAppStore((s) => s.phase);
  const banners = bundle ? bannersFor(bundle).filter((b) => !dismissed.has(b.id)) : [];
  const busy = phase !== "ready";
  return (
    <div className="banners">
      {banners.map((b) => (
        <div key={b.id} className="banner" data-severity={b.severity} role="status">
          <span className="banner-text">{b.text}</span>
          <button
            type="button"
            className="button banner-action"
            disabled={busy}
            onClick={() => {
              const store = useAppStore.getState();
              void (b.action === "Validate" ? store.validate() : store.index());
            }}
          >
            {b.action}
          </button>
          <button
            type="button"
            className="button button-icon button-ghost banner-dismiss"
            aria-label={`Dismiss: ${b.text}`}
            onClick={() => {
              useAppStore.getState().dismissBanner(b.id);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
