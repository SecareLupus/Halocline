// Vite (electron-vite and Vitest) inlines `?raw` imports as strings.
declare module '*?raw' {
  const content: string
  export default content
}
