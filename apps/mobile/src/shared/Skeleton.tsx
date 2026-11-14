/** U6: placeholders shaped like the content that is loading, instead of a spinner. */
export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return <div className="skeleton-list" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, index) => <span className="skeleton-row" key={index}><i /><i /></span>)}
  </div>;
}

export function MessageSkeleton({ label }: { label: string }) {
  return <div className="skeleton-messages" role="status" aria-label={label}>
    <i className="skeleton-bubble" /><i className="skeleton-line" /><i className="skeleton-line short" /><i className="skeleton-line" />
  </div>;
}
