import { handleRail } from '../../api/rail.ts'

// Netlify entry for the sandbox rail; netlify.toml rewrites /api/rail here.
export default (request: Request) => handleRail(request)
