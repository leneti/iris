// A browser_evaluate body for the Playwright MCP tool: paste the arrow function below as-is.
// It returns every visible link, button, role=button and list row (role=option) under 44 x 44 px,
// so the phone check (criterion 9.3) passes when the result is `[]`. A control inside a <label>
// that is itself 44 x 44 px counts as large enough, because tapping the label activates it.
// oxlint-disable-next-line no-unused-expressions -- the bare function is what browser_evaluate takes
() => {
  const MIN = 44;
  const TOLERANCE = 0.5;
  const small = (rect) => rect.width < MIN - TOLERANCE || rect.height < MIN - TOLERANCE;
  const describe = (el, rect) => {
    const name = el.getAttribute('aria-label') || el.textContent || '';
    return {
      tag: el.tagName.toLowerCase(),
      name: name.trim().replace(/\s+/g, ' ').slice(0, 40),
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  };
  const found = [];
  for (const el of document.querySelectorAll('a, button, [role="button"], [role="option"]')) {
    if (!el.checkVisibility()) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || !small(rect)) continue;
    const label = el.closest('label');
    if (label !== null && !small(label.getBoundingClientRect())) continue;
    found.push(describe(el, rect));
  }
  return found;
};
