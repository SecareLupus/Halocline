// Unit tests never reach the network: a test that needs `fetch` gives createCore
// a fake one. A real request makes a test slow and flaky, so it fails at once.
globalThis.fetch = (input) =>
  Promise.reject(new Error(`No network in unit tests (${String(input)})`))
