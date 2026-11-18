// A sunrise over a horizon, with the days ahead fading below it: one day at a time.
export default function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M9.5 17.5a6.5 6.5 0 0 1 13 0Z" fill="var(--accent)" />
      <path d="M16 5.5v2.6M8.4 8.6l1.8 1.8M23.6 8.6l-1.8 1.8" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 17.5h23" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8.5 22.5h15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".55" />
      <path d="M12.5 27.2h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity=".28" />
    </svg>
  );
}
