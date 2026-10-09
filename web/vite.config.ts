import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function railApi(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (!req.url?.startsWith('/api/rail')) return next()
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
      const { handleRail } = await import('./api/rail.ts')
      const response = await handleRail(new Request(`http://localhost${req.url}`, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'GET' ? undefined : body }))
      res.statusCode = response.status
      response.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await response.arrayBuffer()))
    })().catch(next)
  }
  return {
    name: 'paralyx-rail-api',
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  }
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), tailwindcss(), railApi()],
    define: { global: 'globalThis' },
    resolve: {
      alias: [{ find: /^@kamino-finance\/kliquidity-sdk(\/dist(\/utils\/(batch|math|utils|CreationParameters))?)?$/, replacement: fileURLToPath(new URL('./src/shims/kliquidity.ts', import.meta.url)) }],
    },
  }
})
