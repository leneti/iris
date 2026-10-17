let cached: boolean | undefined;

/** Whether this browser can give us a WebGL2 context. Probed once per page; the probe context is released. */
export function hasWebGL2(): boolean {
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    ok = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    ok = false;
  }
  cached = ok;
  return ok;
}

/** Forget the cached answer. Tests only. */
export function resetWebGL2Probe(): void {
  cached = undefined;
}
