// DESIGN 11.7: whether the scene may start at all. This file must never import three, because it decides whether that chunk loads.
let usable: boolean | null = null;
let why: string | null = null;
let transient = false;
let tries = 0;

const SOFTWARE = /swiftshader|llvmpipe|software/i;
/** A context that fails while the GPU process starts is not the same as no GPU. The critic caught 2 cold starts in 26 stuck on the Plate. */
const TRIES = 4;

function probe(): boolean {
  tries += 1;
  transient = false;
  if (typeof document === 'undefined') { why = 'no document'; return false; }
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) {
    why = `no WebGL2 context, ${tries} of ${TRIES} tries`;
    transient = true;
    return false;
  }
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  // One context for the scene, DESIGN 11.2. This one has done its job.
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  if (SOFTWARE.test(renderer)) { why = `software renderer: ${renderer}`; return false; }
  why = null;
  return true;
}

export function webglUsable(): boolean {
  usable ??= probe();
  return usable;
}

/** Why the slot is empty, in a few words. Null when it is not. */
export const gateWhy = (): string | null => why;

/** Forgets a failure that may pass. Returns whether there is another try to make. */
export function retryGate(): boolean {
  if (usable !== false || !transient || tries >= TRIES) return false;
  usable = null;
  return true;
}
