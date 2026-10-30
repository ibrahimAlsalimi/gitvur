import { SHORTCUTS, copy } from "../copy";
import { useAppStore } from "../store/useAppStore";
import { Modal } from "./Modal";

/** `?`: the keyboard map, exactly as listed in `copy.ts`. */
export function ShortcutsSheet() {
  const open = useAppStore((s) => s.shortcutsOpen);
  return (
    <Modal
      open={open}
      title={copy.commands.shortcuts}
      className="dialog-narrow"
      onClose={() => {
        useAppStore.getState().setShortcutsOpen(false);
      }}
    >
      <table className="shortcuts">
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
