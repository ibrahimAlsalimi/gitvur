import { Position } from "@xyflow/react";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Anchor {
  x: number;
  y: number;
  position: Position;
}

/** Gap between parallel lines joining the same two nodes. */
export const PARALLEL_GAP = 10;

/**
 * Endpoints on the sides of the two rectangles that face each other, offset sideways for
 * parallel lines (`index` of `count`), so lines between the same nodes never stack.
 */
export function facingAnchors(a: Rect, b: Rect, index = 0, count = 1): [Anchor, Anchor] {
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  const bx = b.x + b.width / 2;
  const by = b.y + b.height / 2;
  const shift = (index - (count - 1) / 2) * PARALLEL_GAP;
  if (Math.abs(bx - ax) * a.height >= Math.abs(by - ay) * a.width) {
    // Mostly horizontal: right side of the left node to left side of the right node.
    const leftToRight = bx >= ax;
    return [
      {
        x: leftToRight ? a.x + a.width : a.x,
        y: ay + shift,
        position: leftToRight ? Position.Right : Position.Left,
      },
      {
        x: leftToRight ? b.x : b.x + b.width,
        y: by + shift,
        position: leftToRight ? Position.Left : Position.Right,
      },
    ];
  }
  const topToBottom = by >= ay;
  return [
    {
      x: ax + shift,
      y: topToBottom ? a.y + a.height : a.y,
      position: topToBottom ? Position.Bottom : Position.Top,
    },
    {
      x: bx + shift,
      y: topToBottom ? b.y : b.y + b.height,
      position: topToBottom ? Position.Top : Position.Bottom,
    },
  ];
}
