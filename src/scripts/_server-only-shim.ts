/**
 * An empty stand-in for the `server-only` package, for scripts.
 *
 * `server-only` is a marker: its real entry point throws on import, and Next
 * swaps it for an empty module when building a server bundle. Modules that
 * carry the marker — lib/db/scopes.ts among them — therefore cannot be
 * imported by a plain Node process, which is exactly what the verification
 * scripts are.
 *
 * Mapping the package to this file in tsconfig.scripts.json lets a script
 * import the real rule module rather than a copy of it. A copy would be the
 * worse trade: a spec that verifies its own duplicate proves nothing.
 */
export {};
