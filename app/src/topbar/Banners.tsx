import { bannersFor } from "./banners";
import { copy } from "../copy";
import { useAppStore } from "../store/useAppStore";

/** Banners below the top bar; each can be dismissed for the session. */
export function Banners() {
  const bundle = useAppStore((s) => s.bundle);
  const dismissed = useAppStore((s) => s.dismissedBanners);
  const phase = useAppStore((s) => s.phase);
  // The repository's own size, not the Changes lens's union.
  const nodes = useAppStore((s) => (s.base?.model ?? s.model)?.totals.nodes ?? 0);
  const banners = bundle ? bannersFor(bundle, nodes).filter((b) => !dismissed.has(b.id)) : [];
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
              if (b.action === "changes") store.setLens("changes");
              else void (b.action === "validate" ? store.validate() : store.index());
            }}
          >
            {b.actionLabel}
          </button>
          <button
            type="button"
            className="button button-icon button-ghost banner-dismiss"
            aria-label={copy.banners.dismiss(b.text)}
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
