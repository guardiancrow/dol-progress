interface DisclosureIconProps {
  kind: "sidebar" | "chevron" | "filters";
  expanded?: boolean;
}

export function DisclosureIcon({ kind, expanded = false }: DisclosureIconProps) {
  return <svg className={`disclosure-icon disclosure-icon--${kind}`} width="20" height="20" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {kind === "sidebar" ? <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d={expanded ? "m16 9-3 3 3 3" : "m13 9 3 3-3 3"} />
    </> : kind === "chevron" ? <path d={expanded ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /> : <>
      <path d="M3 6h3m4 0h11M3 12h11m4 0h3M3 18h5m4 0h9" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>}
  </svg>;
}
