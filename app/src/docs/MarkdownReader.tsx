import {
  type CSSProperties,
  createContext,
  useContext,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeSanitize from "rehype-sanitize";
import type { ThemedToken } from "shiki/core";
import { getApi } from "../api";
import { copy } from "../copy";
import type { ModelNode } from "../model/buildModel";
import { highlightCode } from "./highlightCode";
import { DOC_SCHEMA, safeDiagram, safeMarkdownUrl } from "./security";
import {
  type DocLink,
  externalUrl,
  localPath,
  mentionIndex,
  qualifiedName,
  resolveLink,
} from "./resolveLink";

// Mermaid is lazy and serialised: initialise/render is global and themes can change mid-render.
let diagramQueue: Promise<unknown> = Promise.resolve();
let diagramSeq = 0;
function renderDiagram(code: string, dark: boolean): Promise<string> {
  const task = diagramQueue
    .catch(() => undefined)
    .then(async () => {
      // Diagrams are text-only: block embedded resources/config overrides before Mermaid sees them.
      if (!safeDiagram(code)) throw new Error("Unsupported diagram resource");
      const { default: mermaid } = await import("mermaid");
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(`--gv-${name}`).trim();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        maxTextSize: 50_000,
        htmlLabels: false,
        themeVariables: {
          darkMode: dark,
          background: token("bg-surface"),
          primaryColor: token("bg-sunken"),
          primaryTextColor: token("text-primary"),
          primaryBorderColor: token("border-strong"),
          lineColor: token("text-secondary"),
          secondaryColor: token("accent-soft"),
          tertiaryColor: token("bg-surface"),
          fontFamily: token("font-ui"),
        },
      });
      const { svg } = await mermaid.render(`gv-diagram-${String(++diagramSeq)}`, code);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  diagramQueue = task;
  return task;
}

function CodeBlock({ code, language, dark }: { code: string; language: string; dark: boolean }) {
  const [tokens, setTokens] = useState<ThemedToken[][] | null>(null);
  const [diagram, setDiagram] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (language === "mermaid") {
      void renderDiagram(code, dark)
        .then((svg) => {
          if (!cancelled) {
            setDiagram(svg);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    } else {
      void highlightCode(code, language)
        .then((t) => {
          if (!cancelled) setTokens(t);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [code, language, dark]);
  return (
    <div className="gv-doc-code">
      <div className="gv-doc-code-header">
        <span>{language || "text"}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(code)
              .then(() => {
                setCopied(true);
              })
              .catch(() => undefined);
          }}
        >
          {copied ? "Copied" : "Copy code"}
        </button>
      </div>
      {language === "mermaid" && diagram && !failed ? (
        <img className="gv-doc-diagram" src={diagram} alt="Document diagram" />
      ) : (
        <pre className="gv-code-text">
          <code>
            {tokens
              ? tokens.map((line, i) => (
                  <span className="gv-doc-code-line" key={i}>
                    {line.map((t, j) => (
                      <span key={j} style={t.htmlStyle as CSSProperties | undefined}>
                        {t.content}
                      </span>
                    ))}
                    {"\n"}
                  </span>
                ))
              : code}
          </code>
        </pre>
      )}
      {failed && <p className="gv-doc-note">{copy.docs.diagramFailed}</p>}
    </div>
  );
}

function DocImage({
  root,
  doc,
  href,
  alt,
  allowRemote,
}: {
  root: string;
  doc: string;
  href: string;
  alt: string;
  allowRemote: boolean;
}) {
  const [asset, setAsset] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const remote = externalUrl(href);
  const http = remote && /^https?:/.test(remote);
  useEffect(() => {
    if (remote) return;
    let cancelled = false;
    const path = localPath(doc, href);
    if (path === null || href === "") return;
    // Use the normalised root-relative path. The Rust boundary checks it again.
    void getApi()
      .then((api) => api.readDocAsset(root, doc, `/${path}`))
      .then((data) => {
        if (!cancelled) setAsset(data.dataUrl);
      })
      .catch(() => {
        if (!cancelled) setBlocked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [root, doc, href, remote]);
  if (http)
    return allowRemote ? (
      <img src={remote} alt={alt} referrerPolicy="no-referrer" />
    ) : (
      <span className="gv-doc-image-placeholder">
        {copy.docs.remoteBlocked} <span>{new URL(remote).host}</span>
      </span>
    );
  if (blocked || !href || localPath(doc, href) === null || remote)
    return <span className="gv-doc-image-placeholder">{copy.docs.assetBlocked}</span>;
  return asset ? (
    <img src={asset} alt={alt} />
  ) : (
    <span className="gv-doc-image-placeholder">{alt}</span>
  );
}

const InLink = createContext(false);

function CodeMention({
  node,
  children,
  onAction,
}: {
  node: ModelNode;
  children: ReactNode;
  onAction: (link: DocLink) => void;
}) {
  const id = useId();
  const inLink = useContext(InLink);
  if (inLink) return <code>{children}</code>;
  return (
    <span className="gv-doc-mention-wrap">
      <button
        className="gv-doc-mention"
        type="button"
        data-mention={node.id}
        aria-describedby={id}
        onClick={() => {
          onAction({ kind: "source", id: node.id });
        }}
      >
        <code>{children}</code>
      </button>
      <span className="gv-doc-mention-card" role="tooltip" id={id}>
        <strong>
          {node.kind === "function" ? "ƒ" : node.kind === "class" ? "C" : "▤"} {qualifiedName(node)}
        </strong>
        <span>
          {node.kind} · {node.source?.file}:{node.source?.startLine}–{node.source?.endLine}
        </span>
        <span>{node.description?.split("\n")[0] ?? "No description yet."}</span>
        <span>{node.docStatus}</span>
      </span>
    </span>
  );
}

export function MarkdownReader({
  text,
  root,
  path,
  docs,
  nodes,
  dark,
  allowRemote,
  onAction,
}: {
  text: string;
  root: string;
  path: string;
  docs: string[];
  nodes: ModelNode[];
  dark: boolean;
  allowRemote: boolean;
  onAction: (link: DocLink) => void;
}) {
  const mentions = useMemo(() => mentionIndex(nodes), [nodes]);
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug, [rehypeSanitize, DOC_SCHEMA]]}
      urlTransform={safeMarkdownUrl}
      components={{
        input: ({ checked }) => (
          <input
            type="checkbox"
            checked={checked ?? false}
            disabled
            aria-label={checked ? "Completed task" : "Incomplete task"}
          />
        ),
        a: ({ href, children }) => {
          const link = resolveLink(path, href ?? "", docs, nodes);
          if (link.kind === "unsupported")
            return <span title={copy.docs.unsupported}>{children}</span>;
          return (
            <button
              type="button"
              className="gv-doc-link"
              data-mention={link.kind === "source" ? link.id : undefined}
              onClick={() => {
                onAction(link);
              }}
            >
              {link.kind === "source" && <span aria-hidden="true">⌖ </span>}
              <InLink.Provider value={true}>{children}</InLink.Provider>
            </button>
          );
        },
        img: ({ src, alt }) => (
          <DocImage
            key={`${path}:${src ?? ""}`}
            root={root}
            doc={path}
            href={src ?? ""}
            alt={alt ?? ""}
            allowRemote={allowRemote}
          />
        ),
        pre: ({ children }) => <>{children}</>,
        code: ({ node, className, children }) => {
          const language = className?.replace(/^language-/, "") ?? "";
          const raw = typeof children === "string" ? children : "";
          const value = raw.replace(/\n$/, "");
          // Fenced blocks are code children of pre; position includes the fence's full range.
          const block =
            !!className ||
            (node?.position?.end.line ?? 0) > (node?.position?.start.line ?? 0) ||
            raw.endsWith("\n");
          if (block) return <CodeBlock code={value} language={language} dark={dark} />;
          const match = mentions.get(value);
          return match ? (
            <CodeMention node={match} onAction={onAction}>
              {children}
            </CodeMention>
          ) : (
            <code>{children}</code>
          );
        },
        table: ({ children }) => (
          <div className="gv-doc-table">
            <table>{children}</table>
          </div>
        ),
        h1: ({ id, children }) => (
          <DocHeading path={path} level={1} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
        h2: ({ id, children }) => (
          <DocHeading path={path} level={2} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
        h3: ({ id, children }) => (
          <DocHeading path={path} level={3} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
        h4: ({ id, children }) => (
          <DocHeading path={path} level={4} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
        h5: ({ id, children }) => (
          <DocHeading path={path} level={5} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
        h6: ({ id, children }) => (
          <DocHeading path={path} level={6} id={id} onAction={onAction}>
            {children}
          </DocHeading>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function DocHeading({
  path,
  level,
  id,
  children,
  onAction,
}: {
  path: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  id: string | undefined;
  children: ReactNode;
  onAction: (link: DocLink) => void;
}) {
  const Tag = `h${String(level)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={id}>
      {children}
      <button
        className="gv-doc-heading-anchor"
        type="button"
        aria-label="Copy heading link"
        onClick={() => {
          onAction({ kind: "anchor", anchor: id ?? "" });
          void navigator.clipboard
            .writeText(`${path}#${id?.replace(/^user-content-/, "") ?? ""}`)
            .catch(() => undefined);
        }}
      >
        #
      </button>
    </Tag>
  );
}
