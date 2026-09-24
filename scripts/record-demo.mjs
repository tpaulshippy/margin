import { mkdir, rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'

const baseUrl = process.env.DEMO_URL ?? 'http://127.0.0.1:5173'
const outputDirectory = fileURLToPath(new URL('../demo/', import.meta.url))
await mkdir(outputDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true })

async function preparePage() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    recordVideo: { dir: outputDirectory, size: { width: 1440, height: 960 } },
  })
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByText(/Jev connected|LLM connected/).waitFor({ timeout: 30_000 })
  await page.waitForFunction(() => {
    const text = document.querySelector('.score-count')?.textContent ?? ''
    const match = text.match(/^(\d+)\/(\d+) scored$/)
    return Boolean(match && Number(match[1]) === Number(match[2]) && Number(match[2]) > 0)
  }, undefined, { timeout: 120_000 })
  await page.mouse.move(720, 500)
  await page.waitForTimeout(900)
  return { context, page }
}

async function saveVideo(context, page, filename) {
  const video = page.video()
  await context.close()
  const source = await video?.path()
  if (!source) {
    throw new Error(`No recording was created for ${filename}.`)
  }
  await rename(source, join(outputDirectory, filename))
}

const first = await preparePage()
const editor = first.page.getByLabel('Essay text')
await editor.click()
await editor.press('Control+End')
await editor.type(' A final sentence adds a bounded recommendation.')
await first.page.waitForFunction(() => {
  const text = document.querySelector('.score-count')?.textContent ?? ''
  const match = text.match(/^(\d+)\/(\d+) scored$/)
  return Boolean(match && Number(match[1]) === Number(match[2]))
}, undefined, { timeout: 120_000 })
await first.page.waitForTimeout(1_200)
await saveVideo(first.context, first.page, 'margin-annotating.webm')

const second = await preparePage()
await second.page.getByRole('button', { name: 'Heat map' }).click()
await second.page.getByText('opacity = confidence').waitFor()
await second.page.mouse.move(400, 450)
await second.page.waitForTimeout(1_300)
await second.page.getByRole('button', { name: 'Edit text' }).click()
await second.page.getByRole('button', { name: 'Open trim mode' }).click()
await second.page.getByRole('heading', { name: 'Find cuts. Keep control.' }).waitFor()
const acceptButton = second.page.getByRole('button', { name: 'Accept cut' }).first()
if (await acceptButton.isVisible()) {
  await acceptButton.click()
}
await second.page.waitForTimeout(1_300)
await saveVideo(second.context, second.page, 'margin-heat-and-trim.webm')

await browser.close()
