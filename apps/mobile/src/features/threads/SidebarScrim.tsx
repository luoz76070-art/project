export function SidebarScrim({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <button type="button" className={`mobile-scrim ${open ? "show" : ""}`} aria-label="关闭线程列表遮罩" aria-hidden={!open} tabIndex={open ? 0 : -1} onClick={onClose} />;
}
