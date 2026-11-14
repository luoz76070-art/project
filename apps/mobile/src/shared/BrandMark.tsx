/** The A1 mark (the M stroke and the amber dot), drawn in the current text colour so it follows the theme. */
export function BrandMark({ size = 48 }: { size?: number }) {
  return <svg className="brand-mark" width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
    <path d="M332 712 V372 Q512 664 692 372 V712" fill="none" stroke="currentColor" strokeWidth={88} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="512" cy="300" r="40" fill="var(--signal)" />
  </svg>;
}
