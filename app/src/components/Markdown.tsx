import { Fragment, type ReactNode } from "react";

import { type Block, type Inline, parseMarkdown } from "./markdown";

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return <Fragment key={i}>{n.text}</Fragment>;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "strong":
        return <strong key={i}>{inline(n.children)}</strong>;
      case "em":
        return <em key={i}>{n.children.length > 0 ? inline(n.children) : null}</em>;
      case "link":
        // Shown, not followed: the app is offline and never navigates its own window.
        return (
          <span key={i} className="md-link">
            {n.text} <code>{n.href}</code>
          </span>
        );
    }
  });
}

function block(b: Block, key: number): ReactNode {
  switch (b.kind) {
    case "heading": {
      // The dialog title is the h2; document headings start one level below it.
      const level = Math.min(6, b.level + 2);
      const Tag = `h${String(level)}` as "h3";
      return <Tag key={key}>{inline(b.content)}</Tag>;
    }
    case "paragraph":
      return <p key={key}>{inline(b.content)}</p>;
    case "rule":
      return <hr key={key} />;
    case "code":
      return (
        <pre key={key}>
          <code>{b.text}</code>
        </pre>
      );
    case "table":
      return (
        <div key={key} className="md-table">
          <table>
            <thead>
              <tr>
                {b.header.map((c, i) => (
                  <th key={i}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={key}>
          {b.items.map((item, i) => (
            <li key={i}>
              {inline(item.content)}
              {item.children && block(item.children, 0)}
            </li>
          ))}
        </Tag>
      );
    }
  }
}

/** Renders trusted, bundled Markdown as React elements. */
export function Markdown({ source }: { source: string }) {
  return <div className="md">{parseMarkdown(source).map(block)}</div>;
}
