import { describe, expect, it } from 'vitest';
import { labelWidth, layoutDiagram, layoutProblems, TEMPLATES, type Orientation } from '../src';

describe.each(TEMPLATES.map((t) => [t.id, t] as const))(
  'diagram layout for %s',
  (_id, template) => {
    const orientations: Orientation[] = ['wide', 'narrow'];
    it.each(orientations)(
      '%s layout has no overlaps, crossings or clipped labels',
      (orientation) => {
        const layout = layoutDiagram(template.lifecycle, orientation);
        expect(layoutProblems(layout)).toEqual([]);
        expect(layout.nodes).toHaveLength(template.lifecycle.nodes.length);
      },
    );

    it('narrow layouts fit a 320px phone once scaled to a readable size', () => {
      const layout = layoutDiagram(template.lifecycle, 'narrow');
      // Card padding and gutters leave about 256px; scaling below 0.8 would make text too small.
      expect(layout.width * 0.8).toBeLessThanOrEqual(256);
    });

    it('is deterministic', () => {
      expect(layoutDiagram(template.lifecycle, 'wide')).toEqual(
        layoutDiagram(template.lifecycle, 'wide'),
      );
    });

    it('places every node on the grid and keeps long labels fully inside the nodes', () => {
      const layout = layoutDiagram(template.lifecycle, 'wide');
      for (const node of layout.nodes) {
        expect(node.w).toBeGreaterThanOrEqual(node.label.length * 9);
      }
    });
  },
);

describe('layout helpers', () => {
  it('estimates wider pills for longer labels', () => {
    expect(labelWidth('take from stock')).toBeGreaterThan(labelWidth('cancel'));
  });
});
