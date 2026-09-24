import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const baseUrl = process.env.DEMO_URL ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})
page.on('pageerror', (error) => errors.push(error.message))
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelector('.score-count')?.textContent === '8/8 scored', undefined, { timeout: 120_000 })
await page.getByRole('button', { name: 'Heat map' }).click()
if (await page.locator('.heat-sentence').count() !== 8) throw new Error('Heat map did not render eight sentences.')
await page.getByRole('button', { name: 'Edit text' }).click()
const before = await page.getByLabel('Essay text').inputValue()
await page.getByRole('button', { name: 'Open trim mode' }).click()
const accept = page.getByRole('button', { name: 'Accept cut' }).first()
const trimmed = await accept.isVisible()
let expectedSentenceCount = 8
if (trimmed) {
  const candidateText = await page.locator('.trim-item').first().locator('.trim-item-copy p').textContent()
  if (!candidateText) throw new Error('Trim candidate did not include sentence text.')
  await accept.click()
  const after = await page.getByLabel('Essay text').inputValue()
  expectedSentenceCount = 7
  if (after === before || after.includes(candidateText)) {
    throw new Error('Accepting a cut did not remove the selected sentence.')
  }
  await page.waitForFunction(() => document.querySelector('.score-count')?.textContent === '7/7 scored', undefined, { timeout: 120_000 })
}
const [markdownDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'Markdown' }).click(),
])
const markdownPath = await markdownDownload.path()
if (!markdownPath || !(await readFile(markdownPath, 'utf8')).includes('Cut safety')) throw new Error('Markdown export is invalid.')
const [jsonDownload] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: 'JSON' }).click(),
])
const jsonPath = await jsonDownload.path()
const json = JSON.parse(await readFile(jsonPath, 'utf8'))
if (json.scores?.length !== expectedSentenceCount) throw new Error('JSON export is invalid.')
await page.setViewportSize({ width: 390, height: 844 })
if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Mobile layout overflows horizontally.')
await page.emulateMedia({ colorScheme: 'dark' })
const darkPaper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim())
if (darkPaper !== '#0c120f') throw new Error(`Dark preference was not applied: ${darkPaper}`)
await page.emulateMedia({ colorScheme: 'light' })
const lightPaper = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--paper').trim())
if (lightPaper !== '#f4f1e9') throw new Error(`Light preference was not restored: ${lightPaper}`)
if (errors.length) throw new Error(`Browser errors: ${errors.join(' | ')}`)
console.log('browser smoke passed: scoring, heat map, trim, exports, mobile, device themes')
await browser.close()
