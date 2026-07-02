'use strict'

/**
 * Jest transformer for yoga-layout's Emscripten-generated WASM loader
 * (node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js).
 *
 * That file is ESM and reads `import.meta.url` purely to resolve a
 * same-directory `.wasm` file for the `document.currentScript` fallback
 * path. This particular build embeds the WASM binary inline as a base64
 * data: URI, so `_scriptDir` is captured but never actually used to fetch
 * anything — its value is irrelevant at runtime.
 *
 * `import.meta` has no CommonJS equivalent, so TypeScript/ts-jest cannot
 * transpile it, and there is no CJS build of yoga-layout to fall back to.
 * Rather than switching the whole Jest project to native ESM (a much
 * larger, riskier change to a live test suite) or adding a new Babel
 * dependency, this transform does two narrow textual substitutions before
 * handing the file to Jest's CommonJS module wrapper:
 *   1. `import.meta.url` -> a harmless string constant.
 *   2. The file's single `export default loadYoga;` -> `module.exports = loadYoga`.
 * All other code in the file (including the actual WASM instantiation
 * logic) is untouched — this is a syntax-only shim, not a behavioral mock.
 */
module.exports = {
  process(sourceText) {
    const code = sourceText
      .replace(/import\.meta\.url/g, "'jest://yoga-layout-wasm-loader'")
      .replace(/export\s+default\s+(\w+)\s*;?\s*$/, 'module.exports = $1;\n')
    return { code }
  },
}
