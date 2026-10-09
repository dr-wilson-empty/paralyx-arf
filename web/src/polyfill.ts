import { Buffer } from 'buffer'

const scope = globalThis as unknown as { Buffer?: typeof Buffer }
if (!scope.Buffer) scope.Buffer = Buffer
