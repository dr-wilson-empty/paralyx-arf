import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const web = fileURLToPath(new URL('../web/', import.meta.url))

test('web3.js loads through require without require(esm), as on Vercel', () => {
  const result = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', "require('@solana/web3.js')"], { cwd: web, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})
