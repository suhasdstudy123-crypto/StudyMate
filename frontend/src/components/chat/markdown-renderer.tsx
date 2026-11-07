"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SourceCitation } from "@/lib/chat";

interface MarkdownRendererProps {
  content: string;
  sources?: SourceCitation[];
  onCitationClick?: (sourceRank: number) => void;
  className?: string;
}

// Custom schema extending default to allow common attributes
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code || []), "className"],
    th: [...(defaultSchema.attributes?.th || []), "style", "align"],
    td: [...(defaultSchema.attributes?.td || []), "style", "align"],
  },
};

/**
 * Enhanced CodeBlock component with language badge and Copy Code button
 */
function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || "");
  const codeString = String(children).replace(/\n$/, "");

  if (inline) {
    return (
      <code
        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] font-semibold text-foreground border border-border/60"
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border bg-muted/30 shadow-2xs">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/60 px-3.5 py-1.5 text-[11px] font-mono font-medium text-muted-foreground">
        <span>{match ? match[1] : "code"}</span>
        <button
          onClick={handleCopy}
          type="button"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-background/80 hover:text-foreground transition-colors"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-500" />
              <span className="text-emerald-500 font-semibold">Copied</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-3.5 font-mono text-[12.5px] leading-relaxed text-foreground select-text">
        <pre className="m-0 bg-transparent p-0">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      </div>
    </div>
  );
}

/**
 * Text node processor that parses inline source markers like [Source 1], [Source 2]
 * and converts them into styled interactive badges linked to the retrieved study material citations.
 */
function processCitationsInText(
  text: string,
  sources?: SourceCitation[],
  onCitationClick?: (rank: number) => void
): React.ReactNode {
  // Regex matches [Source 1], [Source 2, Source 3], [Source 1, 2]
  const citationRegex = /\[Source\s+(\d+(?:\s*,\s*(?:Source\s+)?\d+)*)\]/gi;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = citationRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }

    const rawNumbers = match[1];
    // Extract individual rank integers
    const ranks = rawNumbers
      .split(",")
      .map((part) => parseInt(part.replace(/Source/gi, "").trim(), 10))
      .filter((n) => !isNaN(n));

    parts.push(
      <span key={`cite-group-${match.index}`} className="inline-flex items-center gap-1 mx-1 align-baseline">
        {ranks.map((rank) => {
          const matchedSource = sources?.find((s) => s.rank === rank);
          const tooltip = matchedSource
            ? `${matchedSource.material_title} · Page ${matchedSource.page_number}`
            : `Source ${rank}`;

          return (
            <button
              key={`cite-${match?.index}-${rank}`}
              type="button"
              onClick={() => onCitationClick?.(rank)}
              title={tooltip}
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md",
                "bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground",
                "transition-all duration-150 cursor-pointer shadow-2xs select-none"
              )}
            >
              <span>Source {rank}</span>
              {matchedSource && (
                <span className="text-[9px] opacity-80 font-normal">p.{matchedSource.page_number}</span>
              )}
            </button>
          );
        })}
      </span>
    );

    lastIndex = citationRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

/**
 * Recursive text enhancer to preserve React component trees while converting source tags in strings.
 */
function enhanceChildrenWithCitations(
  children: React.ReactNode,
  sources?: SourceCitation[],
  onCitationClick?: (rank: number) => void
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return processCitationsInText(child, sources, onCitationClick);
    }
    return child;
  });
}

export function MarkdownRenderer({
  content,
  sources,
  onCitationClick,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={cn("markdown-content text-foreground font-sans", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          // Headings
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-base sm:text-lg font-bold tracking-tight text-foreground border-b border-border/50 pb-1.5 first:mt-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3.5 mb-2 text-sm sm:text-base font-bold tracking-tight text-foreground border-b border-border/30 pb-1 first:mt-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1.5 text-xs sm:text-sm font-bold text-foreground first:mt-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-2.5 mb-1 text-xs font-bold text-foreground/90 uppercase tracking-wider first:mt-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </h4>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="mb-2.5 text-sm leading-relaxed text-foreground/95 last:mb-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </p>
          ),

          // Strong / Bold
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </strong>
          ),

          // Emphasis / Italic
          em: ({ children }) => (
            <em className="italic text-foreground/90">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </em>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="mb-3 list-disc list-outside pl-5 space-y-1 text-sm leading-relaxed marker:text-primary/70">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-decimal list-outside pl-5 space-y-1 text-sm leading-relaxed marker:text-primary/80 marker:font-semibold">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed text-foreground/95 pl-0.5">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </li>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-3 border-primary/60 bg-primary/5 px-3.5 py-2 rounded-r-md text-xs sm:text-sm italic text-foreground/80">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </blockquote>
          ),

          // Horizontal Rule
          hr: () => <hr className="my-4 border-t border-border/70" />,

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
            >
              <span>{enhanceChildrenWithCitations(children, sources, onCitationClick)}</span>
              <ExternalLink className="size-3 inline-block shrink-0 ml-0.5 opacity-70" />
            </a>
          ),

          // Code
          code: ({
            inline,
            className,
            children,
            ...props
          }: {
            inline?: boolean;
            className?: string;
            children?: React.ReactNode;
          } & React.HTMLAttributes<HTMLElement>) => (
            <CodeBlock inline={inline} className={className} {...props}>
              {children}
            </CodeBlock>
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-3 w-full overflow-x-auto rounded-lg border border-border shadow-2xs">
              <table className="w-full min-w-full border-collapse text-left text-xs sm:text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border bg-muted/60 text-xs font-semibold uppercase tracking-wider text-foreground">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/50 bg-card/40">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="transition-colors hover:bg-muted/30 even:bg-muted/15">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3.5 py-2.5 font-semibold text-foreground border-r border-border/40 last:border-r-0">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3.5 py-2 align-top text-foreground border-r border-border/40 last:border-r-0 leading-normal">
              {enhanceChildrenWithCitations(children, sources, onCitationClick)}
            </td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
