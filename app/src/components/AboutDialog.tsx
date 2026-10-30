import { useState } from "react";

import license from "../../../LICENSE?raw";
import { copy } from "../copy";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

const REPO_URL = "https://github.com/ibrahimAlsalimi/gitvur";

/** Version, build commit, source link and the MIT license text. */
export function AboutDialog() {
  const open = useAppStore((s) => s.aboutOpen);
  const [copied, setCopied] = useState(false);
  const a = copy.about;
  return (
    <Modal
      open={open}
      title={a.title}
      className="dialog-narrow"
      onClose={() => {
        setCopied(false);
        useAppStore.getState().setAboutOpen(false);
      }}
    >
      <p className="about-text">{a.text}</p>
      <dl className="facts about-facts">
        <dt>{a.version}</dt>
        <dd>{__GITVUR_VERSION__}</dd>
        <dt>{a.commit}</dt>
        <dd className="inline-code">{__GITVUR_COMMIT__}</dd>
        <dt>{a.source}</dt>
        <dd className="about-link">
          {/* Shown, not opened: the viewer never navigates its own window. */}
          <span className="inline-code">{REPO_URL}</span>
          <button
            type="button"
            className="gv-link"
            onClick={() => {
              void navigator.clipboard
                .writeText(REPO_URL)
                .then(() => {
                  setCopied(true);
                })
                .catch(() => undefined);
            }}
          >
            {copied ? a.copied : a.copyLink}
          </button>
        </dd>
        <dt>{a.license}</dt>
        <dd>MIT</dd>
      </dl>
      <pre className="about-license">{license}</pre>
    </Modal>
  );
}
