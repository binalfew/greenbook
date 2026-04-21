/** @type {Array<() => void | Promise<void>>} */
const hooks = [];

/**
 * Register a function to run on SIGTERM / SIGINT.
 * Hooks run in registration order, errors from one hook don't block the rest.
 * @param {() => void | Promise<void>} hook
 */
export function onShutdown(hook) {
  hooks.push(hook);
}

/** Best-effort cleanup — runs every hook, swallows individual failures. */
export async function runShutdownHooks() {
  for (const hook of hooks) {
    try {
      await hook();
    } catch {
      // Best-effort cleanup; log via pino if callers want visibility.
    }
  }
}
