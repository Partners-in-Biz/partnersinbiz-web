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
