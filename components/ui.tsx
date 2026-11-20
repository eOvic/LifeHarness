// Small UI primitives shared by every page. Colors come from theme tokens only.
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-canvas hover:opacity-90",
  accent: "bg-accent text-accent-ink hover:brightness-105",
  secondary: "border border-line bg-panel text-ink hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-ink",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-sm",
  md: "h-9 gap-2 px-3.5 text-base",
  lg: "h-11 gap-2 px-5 text-lg",
};

export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...p}
      className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-lg font-medium transition disabled:pointer-events-none disabled:opacity-40", VARIANT[variant], SIZE[size], className)}
    />
  );
}

/** An on/off switch (the same look as the prayer-times toggle). */
export function Switch({ on, onChange, label, disabled, ...p }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      {...p}
      className={cx("relative h-6 w-11 shrink-0 rounded-full border transition disabled:opacity-40", on ? "border-accent bg-accent" : "border-line bg-panel")}
    >
      <span className={cx("absolute top-0.5 h-[18px] w-[18px] rounded-full transition-all", on ? "left-[22px] bg-accent-ink" : "left-0.5 bg-muted")} />
    </button>
  );
}

/** A link that looks like a Button. In the desktop app, links to other sites open in the browser. */
export function LinkButton({ variant = "secondary", size = "md", className, ...p }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant; size?: Size }) {
  return <a {...p} className={cx("inline-flex shrink-0 select-none items-center justify-center rounded-lg font-medium transition", VARIANT[variant], SIZE[size], className)} />;
}

export function IconButton({ className, active, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "inline-grid h-8 w-8 shrink-0 place-items-center rounded-lg transition disabled:opacity-40 [&_svg]:h-[17px] [&_svg]:w-[17px]",
        active ? "bg-selected text-ink" : "text-muted hover:bg-hover hover:text-ink",
        className,
      )}
    />
  );
}

/** Mono, uppercase, quiet: section labels and chrome text. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("lh-label", className)}>{children}</span>;
}

export function Pill({ children, className, tone = "muted", ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: "muted" | "accent" | "ok" | "warn" | "ink" }) {
  const tones = {
    muted: "border-line text-muted",
    ink: "border-line text-ink",
    accent: "border-accent/50 text-accent",
    ok: "border-ok/50 text-ok",
    warn: "border-warn/50 text-warn",
  };
  return (
    <span {...p} className={cx("lh-mono inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] uppercase tracking-[0.06em]", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx("rounded-xl border border-line bg-panel", className)} />;
}

export function Segmented<T extends string>({ options, value, onChange, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("lh-mono inline-flex rounded-lg border border-line p-0.5 text-[11px] uppercase tracking-[0.06em]", className)} role="tablist">
      {options.map((o) => (
        <button
          type="button"
          role="tab"
          aria-selected={o.value === value}
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx("flex-1 rounded-md px-3 py-1.5 transition", o.value === value ? "bg-selected text-ink" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx("lh-spin inline-block h-3.5 w-3.5 rounded-full border-2 border-line border-t-accent", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="lh-mono rounded border border-line px-1 text-[10.5px] text-muted">{children}</kbd>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <div className="lh-title text-2xl">{title}</div>
      {children && <p className="mt-2 text-lg leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
