'use client';

import { layoutDiagram, type Lifecycle } from '@invariant-trail/engine';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface Props {
  title: string;
  lifecycle: Lifecycle;
  /** Id of the node the stored data is currently in. */
  current: string;
}

/**
 * Lifecycle diagram. Wide containers get full labels beside the lines; narrow ones get a vertical
 * layout with numbered markers that match the numbered table below, so nothing is ever cut off.
 */
export function LifecycleDiagram({ title, lifecycle, current }: Props) {
  const uid = useId();
  const markerId = `${uid}-arrow`;
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);

  const wideLayout = useMemo(() => layoutDiagram(lifecycle, 'wide'), [lifecycle]);
  const narrowLayout = useMemo(() => layoutDiagram(lifecycle, 'narrow'), [lifecycle]);

  useEffect(() => {
    const node = holder.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(node);
    setAvailable(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const layout = available !== null && available < wideLayout.width ? narrowLayout : wideLayout;
  const narrow = layout.orientation === 'narrow';
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const currentLabel = byId.get(current)?.label ?? current;

  return (
    <div className="diagram" ref={holder} data-orientation={layout.orientation}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={`${title} lifecycle. Currently: ${currentLabel}. A table with the same information follows.`}
        className="diagram-svg"
        style={{ maxWidth: layout.width }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0 0L10 5L0 10z" className="diagram-arrow" />
          </marker>
        </defs>
        {layout.edges.map((edge) => (
          <polyline
            key={`line-${edge.index}`}
            points={edge.points.map((p) => p.join(',')).join(' ')}
            className="diagram-edge"
            fill="none"
            markerEnd={`url(#${markerId})`}
          />
        ))}
        {layout.nodes.map((node) => {
          const active = node.id === current;
          return (
            <g key={node.id} className={active ? 'diagram-node is-current' : 'diagram-node'}>
              <rect x={node.x} y={node.y} width={node.w} height={node.h} rx="8" />
              <text
                x={node.x + node.w / 2}
                y={node.y + (active ? node.h / 2 - 3 : node.h / 2 + 5)}
                textAnchor="middle"
                className="diagram-node-label"
              >
                {node.label}
              </text>
              {active ? (
                <text
                  x={node.x + node.w / 2}
                  y={node.y + node.h / 2 + 14}
                  textAnchor="middle"
                  className="diagram-node-tag"
                >
                  ● current
                </text>
              ) : null}
            </g>
          );
        })}
        {layout.edges.map((edge) => (
          <g key={`badge-${edge.index}`} className="diagram-badge" data-edge={edge.index + 1}>
            <rect
              x={edge.badge.x}
              y={edge.badge.y}
              width={edge.badge.w}
              height={edge.badge.h}
              rx={narrow ? edge.badge.h / 2 : 6}
            />
            <text
              x={edge.badge.x + edge.badge.w / 2}
              y={edge.badge.y + edge.badge.h / 2 + 4.5}
              textAnchor="middle"
              className="diagram-edge-label"
            >
              {edge.badge.text}
            </text>
          </g>
        ))}
      </svg>
      <table className="diagram-table">
        <caption>Text version of the diagram</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">From</th>
            <th scope="col">Event</th>
            <th scope="col">To</th>
          </tr>
        </thead>
        <tbody>
          {lifecycle.edges.map((edge, i) => (
            <tr key={`${edge.from}-${edge.to}-${i}`}>
              <td>{i + 1}</td>
              <td>{lifecycle.nodes.find((n) => n.id === edge.from)?.label}</td>
              <td>{edge.label}</td>
              <td>{lifecycle.nodes.find((n) => n.id === edge.to)?.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="diagram-current">
        Stored data is currently in: <strong>{currentLabel}</strong>
      </p>
    </div>
  );
}
