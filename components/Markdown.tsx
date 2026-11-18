"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cx } from "./ui";

export default function Markdown({ children, className, small = false }: { children: string; className?: string; small?: boolean }) {
  return (
    <div className={cx("prose-lh", small && "prose-sm", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
