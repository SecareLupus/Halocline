// Vite (electron-vite and Vitest) inlines `?raw` imports as strings.
declare module '*?raw' {
  const content: string
  export default content
}

// scripts/vite-bundle.ts turns `?bundle` imports into the string of a browser bundle.
declare module '*?bundle' {
  const code: string
  export default code
}
