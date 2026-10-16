import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { HealthMark } from '@/components/health-mark';
import { ServiceStatus } from '@/lib/shared/contract';

function render(status: ServiceStatus, size?: 11 | 14): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    createElement(HealthMark, size === undefined ? { status } : { status, size }),
  );
  const svg = host.querySelector('svg');
  if (!svg) throw new Error(`no svg for ${status}`);
  return svg;
}

/** Tag and attributes of the drawn shape, without colour. */
function shape(svg: SVGSVGElement): string {
  return [...svg.children]
    .map((child) => {
      const attrs = [...child.attributes]
        .filter((a) => !['class', 'fill', 'stroke'].includes(a.name) || child.tagName === 'x')
        .map((a) => `${a.name}=${a.value}`)
        .sort()
        .join(' ');
      const paint = ['fill', 'stroke-width']
        .map((n) => `${n}:${child.getAttribute(n) ?? ''}`)
        .join(',');
      return `${child.tagName.toLowerCase()} ${attrs} ${paint}`;
    })
    .join('|');
}

describe('HealthMark', () => {
  const statuses = ServiceStatus.options;

  test.each(statuses)('%s has role img and its status word as the name', (status) => {
    const svg = render(status);
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe(status);
  });

  test('draws six distinct shapes', () => {
    const shapes = statuses.map((status) => shape(render(status)));
    expect(statuses).toHaveLength(6);
    expect(new Set(shapes).size).toBe(6);
  });

  test('uses the matching status colour token', () => {
    for (const status of statuses) {
      expect(render(status).getAttribute('class')).toContain(`text-status-${status}`);
    }
  });

  test('size is 11 or 14 pixels, default 11', () => {
    expect(render('healthy').getAttribute('width')).toBe('11');
    expect(render('healthy', 14).getAttribute('width')).toBe('14');
    expect(render('healthy', 14).getAttribute('height')).toBe('14');
  });
});
