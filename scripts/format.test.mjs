import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatAmount, formatClock, setDisplayLocale } from '../web/src/lib/format.ts'

test('amounts follow the display language', () => {
  setDisplayLocale('en-US')
  assert.equal(formatAmount(1234.5), '1,234.50')
  assert.equal(formatAmount(1.35, 4), '1.3500')
  setDisplayLocale('tr-TR')
  assert.equal(formatAmount(1234.5), '1.234,50')
  assert.equal(formatAmount(1.35, 4), '1,3500')
})

test('clock times follow the display language', () => {
  const afternoon = new Date(2026, 9, 12, 15, 5, 9).getTime()
  setDisplayLocale('en-US')
  assert.match(formatClock(afternoon), /^3:05:09\sPM$/)
  setDisplayLocale('tr-TR')
  assert.equal(formatClock(afternoon), '15:05:09')
})
