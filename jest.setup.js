require('@testing-library/jest-dom')

// jsdom strips the global `fetch` / `Request` / `Response` / `Headers` that
// Node 18+ provides. Some dependencies (e.g. the @firebase/auth node platform
// entry) reference `fetch` at module-eval time and throw
// "ReferenceError: fetch is not defined" before any test can install its own
// mock. Provide a baseline implementation on the jsdom global. Individual tests
// still override `global.fetch` with a jest.fn() as needed.
try {
  // node-fetch ships spec-compatible Request/Response/Headers.
  const nodeFetch = require('node-fetch')
  const fetchImpl = nodeFetch.default || nodeFetch
  if (typeof global.fetch === 'undefined') global.fetch = fetchImpl
  if (typeof global.Request === 'undefined' && nodeFetch.Request) global.Request = nodeFetch.Request
  if (typeof global.Response === 'undefined' && nodeFetch.Response) global.Response = nodeFetch.Response
  if (typeof global.Headers === 'undefined' && nodeFetch.Headers) global.Headers = nodeFetch.Headers
} catch {
  // Last-resort stub: the dependencies above only reference `fetch` at module
  // load; the actual network call is always mocked in tests.
  if (typeof global.fetch === 'undefined') {
    global.fetch = () => Promise.reject(new Error('fetch is not mocked in this test'))
  }
}

// jsdom does not implement PointerEvent (see https://github.com/jsdom/jsdom/issues/2527).
// Without this, @testing-library/dom's fireEvent.pointerDown/Move/Up fall back to the
// base `Event` constructor, which silently drops `clientX`/`pointerId` init fields.
// Polyfill a minimal PointerEvent (extends MouseEvent, which jsdom does support) so
// pointer-drag interaction tests (e.g. timeline trim handles) get real coordinates.
if (typeof global.window !== 'undefined' && typeof global.window.PointerEvent === 'undefined') {
  class PointerEvent extends global.window.MouseEvent {
    constructor(type, params = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  global.window.PointerEvent = PointerEvent
  global.PointerEvent = PointerEvent
}
