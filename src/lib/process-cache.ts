/**
 * PropertyPro - A short-lived cache every copy of a module shares
 *
 * Next builds route handlers and pages into separate bundles, so a module a
 * route imports and the same module a page imports are two instances, each
 * with its own module-level variables. The platform settings, landing
 * content and plans each kept a 60-second cache that way: saving in the
 * console cleared the route's copy, then revalidatePath re-rendered the
 * static pages — which read the page's copy, still holding the old value,
 * and baked it in until their next revalidation. Saving the site name
 * "did nothing".
 *
 * Held on globalThis instead, one slot per name, so clearing it from the
 * route that saved clears it for the page that renders.
 */

interface Slot<T> {
  value: T;
  at: number;
}

type Store = Map<string, Slot<unknown>>;

const KEY = Symbol.for("propertypro.processCache");

function store(): Store {
  const holder = globalThis as typeof globalThis & { [KEY]?: Store };
  return (holder[KEY] ??= new Map());
}

export function processCache<T>(name: string, ttlMs: number) {
  return {
    /** The cached value while it is fresh. */
    fresh(): T | undefined {
      const slot = store().get(name) as Slot<T> | undefined;
      return slot && Date.now() - slot.at < ttlMs ? slot.value : undefined;
    },
    /** The last value, however old — the fallback when a read fails. */
    last(): T | undefined {
      return (store().get(name) as Slot<T> | undefined)?.value;
    },
    set(value: T): void {
      store().set(name, { value, at: Date.now() });
    },
    clear(): void {
      store().delete(name);
    },
  };
}
