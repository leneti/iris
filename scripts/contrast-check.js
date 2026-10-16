// A browser_evaluate body for the Playwright MCP tool: paste the arrow function below as-is.
// Run it once per view and theme (criterion 6.6). It returns { texts, marks, controls, checked }:
//   texts    visible text whose colour against its resolved background is under 4.5:1
//            (3:1 for large text: 24 px, or 18.66 px and bold)
//   marks    [data-status] marks whose colour against the background behind them is under 3:1
//   controls buttons, inputs, switches and radios with a visible border under 3:1; a border in
//            one of the hairline tokens is decoration (README: tiles and cards are named by their
//            text), so those are counted in `decorative` and not held to 3:1
// Every list is empty when the view passes. Disabled controls are exempt (WCAG 1.4.3).
// Colours go through a canvas, so color-mix() and color(srgb ...) values are read correctly.
// A background is found by compositing the ancestors' background colours, and an ancestor's
// `opacity` fades both the text and its own background towards what lies behind.
// oxlint-disable-next-line no-unused-expressions -- the bare function is what browser_evaluate takes
() => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  };
  const over = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const page = rgba(getComputedStyle(document.body).backgroundColor);
  const canvasBase =
    page.a > 0 ? over(page, { r: 255, g: 255, b: 255, a: 1 }) : { r: 255, g: 255, b: 255, a: 1 };

  // The colour behind `el`: ancestors' backgrounds composited from the root down, with each
  // ancestor's opacity applied to what it paints.
  const backdrop = (el) => {
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    let acc = canvasBase;
    for (const n of chain.reverse()) {
      const cs = getComputedStyle(n);
      const bg = rgba(cs.backgroundColor);
      const opacity = Number(cs.opacity);
      if (bg.a > 0) acc = over({ ...bg, a: bg.a * opacity }, acc);
    }
    return acc;
  };
  const opacityOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const label = (el) =>
    (el.getAttribute('aria-label') || el.textContent || el.tagName)
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  const visible = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const round = (n) => Math.round(n * 100) / 100;

  const texts = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue.trim()) continue;
    const el = node.parentElement;
    if (
      !el ||
      !visible(el) ||
      el.closest('[disabled], [aria-disabled="true"], iframe, script, style')
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const cs = getComputedStyle(el);
    const bg = backdrop(el);
    const fg = rgba(cs.color);
    const o = opacityOf(el);
    const text = over({ ...fg, a: fg.a * o }, bg);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const got = ratio(text, bg);
    checked += 1;
    if (got < need) texts.push({ text: label(el), ratio: round(got), need, size, fg: cs.color });
  }

  const marks = [];
  for (const el of document.querySelectorAll('[data-status]')) {
    if (!visible(el) || el.closest('iframe')) continue;
    const cs = getComputedStyle(el);
    const bg = backdrop(el.parentElement ?? el);
    const mark = over(rgba(cs.color), bg);
    const got = ratio(mark, bg);
    checked += 1;
    if (got < 3)
      marks.push({ status: el.getAttribute('data-status'), ratio: round(got), color: cs.color });
  }

  const controls = [];
  let decorative = 0;
  const rootStyle = getComputedStyle(document.documentElement);
  const hairlines = ['--color-hairline', '--color-hairline-raised', '--color-hairline-strong'].map(
    (v) => {
      const c = rgba(rootStyle.getPropertyValue(v).trim());
      return `${c.r},${c.g},${c.b}`;
    },
  );
  const selector =
    'button, input, select, textarea, [role="switch"], [role="radio"], [role="combobox"]';
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || el.matches(':disabled, [aria-disabled="true"]')) continue;
    const cs = getComputedStyle(el);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(
      (s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none',
    );
    if (sides.length === 0) continue;
    const bg = backdrop(el.parentElement ?? el);
    // The strongest visible side counts: a flagged row's 3 px status bar is its border mark.
    let got = 0;
    let shown = '';
    let decorativeOnly = true;
    for (const side of sides) {
      const line = rgba(cs[`border${side}Color`]);
      if (line.a === 0) continue;
      if (!hairlines.includes(`${line.r},${line.g},${line.b}`)) decorativeOnly = false;
      const r = ratio(over(line, bg), bg);
      if (r > got) {
        got = r;
        shown = cs[`border${side}Color`];
      }
    }
    if (shown === '') continue;
    if (decorativeOnly) {
      decorative += 1;
      continue;
    }
    checked += 1;
    // A flagged row or card carries a 3 px status bar (an absolutely placed child); when that bar
    // reaches 3:1, it is the row's border mark and the faint 1 px outline is decoration.
    if (got < 3) {
      const barred = Array.from(el.querySelectorAll('*')).some((child) => {
        const c = getComputedStyle(child);
        const w = parseFloat(c.width);
        if (c.position !== 'absolute' || !(w > 0 && w <= 4)) return false;
        const fill = rgba(c.backgroundColor);
        return fill.a > 0 && ratio(over(fill, bg), bg) >= 3;
      });
      if (barred) {
        decorative += 1;
        continue;
      }
    }
    if (got < 3) controls.push({ control: label(el), ratio: round(got), color: shown });
  }
  return { texts, marks, controls, checked, decorative };
};
