/**
 * Generate PDF from HTML without using the browser print dialog.
 * This avoids default browser headers/footers and keeps the exported report stable.
 */

import type html2canvas from 'html2canvas'
import type jsPDF from 'jspdf'

interface ExportElementAsPdfOptions {
  element: HTMLElement
  title?: string
}

interface CanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): Pick<CanvasRenderingContext2D, 'drawImage' | 'fillRect' | 'fillStyle'> | null
  toDataURL(type?: string): string
}

interface PdfDocumentLike {
  internal: {
    pageSize: {
      getWidth(): number
      getHeight(): number
    }
  }
  addImage(
    imageData: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alias?: string,
    compression?: string
  ): void
  addPage(): void
  save(fileName: string): void
  setProperties?(properties: Record<string, string>): void
}

type Html2CanvasFn = typeof html2canvas
type JsPdfConstructor = typeof jsPDF

interface PdfGenerationDeps {
  html2canvas: Html2CanvasFn
  jsPDF: JsPdfConstructor
}

type CanvasFactory = (width: number, height: number, document: Document) => CanvasLike

let testDepsLoader: (() => Promise<PdfGenerationDeps>) | null = null
let testCanvasFactory: CanvasFactory | null = null

async function loadPdfGenerationDeps(): Promise<PdfGenerationDeps> {
  if (testDepsLoader) {
    return testDepsLoader()
  }

  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ])

  return { html2canvas, jsPDF }
}

function createCanvas(width: number, height: number, document: Document): CanvasLike {
  if (testCanvasFactory) {
    return testCanvasFactory(width, height, document)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function waitForAnimationFrame(document: Document): Promise<void> {
  const frameWindow = document.defaultView
  if (!frameWindow?.requestAnimationFrame) {
    return new Promise(resolve => setTimeout(resolve, 0))
  }

  return new Promise(resolve => {
    frameWindow.requestAnimationFrame(() => resolve())
  })
}

async function waitForStablePdfLayout(element: HTMLElement): Promise<void> {
  const document = element.ownerDocument
  const fonts = document.fonts
  if (fonts?.ready) {
    try {
      await fonts.ready
    } catch (error) {
      console.warn('[PDFExport] Font readiness failed; exporting current layout.', error)
    }
  }

  await Promise.all(
    Array.from(element.querySelectorAll('img')).map(async image => {
      try {
        await image.decode?.()
      } catch (error) {
        console.warn('[PDFExport] Image decoding failed; exporting current layout.', error)
      }
    })
  )

  await waitForAnimationFrame(document)
  await waitForAnimationFrame(document)
}

function getCaptureDimensions(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    width: Math.max(1, Math.ceil(element.scrollWidth || rect.width)),
    height: Math.max(1, Math.ceil(element.scrollHeight || rect.height))
  }
}

function createCanvasPageSlice(
  sourceCanvas: CanvasLike,
  startY: number,
  sliceHeight: number,
  document: Document
): CanvasLike {
  const pageCanvas = createCanvas(sourceCanvas.width, sliceHeight, document)
  const context = pageCanvas.getContext('2d')

  if (!context) {
    throw new Error('Unable to create PDF page canvas')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
  context.drawImage(
    sourceCanvas as unknown as CanvasImageSource,
    0,
    startY,
    sourceCanvas.width,
    sliceHeight,
    0,
    0,
    pageCanvas.width,
    pageCanvas.height
  )

  return pageCanvas
}

function getKeepTogetherRanges(element: HTMLElement, canvasWidth: number) {
  const rootRect = element.getBoundingClientRect()
  const layoutWidth = Math.max(1, element.scrollWidth || rootRect.width)
  const scale = canvasWidth / layoutWidth

  return Array.from(element.querySelectorAll<HTMLElement>('[data-pdf-keep-together]'))
    .map(node => {
      const rect = node.getBoundingClientRect()
      return {
        start: Math.max(0, Math.floor((rect.top - rootRect.top) * scale)),
        end: Math.max(0, Math.ceil((rect.bottom - rootRect.top) * scale))
      }
    })
    .filter(range => range.end > range.start)
    .sort((a, b) => a.start - b.start)
}

function getPageSliceHeight(
  offsetY: number,
  pageHeightPx: number,
  canvasHeight: number,
  keepTogetherRanges: Array<{ start: number; end: number }>
): number {
  const defaultHeight = Math.min(pageHeightPx, canvasHeight - offsetY)
  const targetEnd = offsetY + defaultHeight

  const crossingRange = keepTogetherRanges.find(
    range =>
      range.start > offsetY &&
      range.start < targetEnd &&
      range.end > targetEnd &&
      range.end - range.start <= pageHeightPx
  )

  return crossingRange ? crossingRange.start - offsetY : defaultHeight
}

export async function printElementAsPdf({
  element,
  title
}: ExportElementAsPdfOptions): Promise<void> {
  const document = element.ownerDocument
  const view = document.defaultView

  if (!document || !view) {
    throw new Error('Unable to access document context for PDF export')
  }

  await waitForStablePdfLayout(element)

  const { html2canvas, jsPDF } = await loadPdfGenerationDeps()
  const { width, height } = getCaptureDimensions(element)
  const devicePixelRatio = view.devicePixelRatio || 1
  const scale = Math.min(Math.max(devicePixelRatio, 1), 2)

  const sourceCanvas = await html2canvas(element, {
    backgroundColor: '#ffffff',
    logging: false,
    scale,
    useCORS: true,
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    scrollX: 0,
    scrollY: 0
  })

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true
  }) as PdfDocumentLike

  const pageWidthMm = pdf.internal.pageSize.getWidth()
  const pageHeightMm = pdf.internal.pageSize.getHeight()
  const pixelsPerMm = sourceCanvas.width / pageWidthMm
  const pageHeightPx = Math.max(1, Math.floor(pageHeightMm * pixelsPerMm))
  const keepTogetherRanges = getKeepTogetherRanges(element, sourceCanvas.width)

  if (title && pdf.setProperties) {
    pdf.setProperties({ title })
  }

  let offsetY = 0
  let pageIndex = 0

  while (offsetY < sourceCanvas.height) {
    const sliceHeight = getPageSliceHeight(
      offsetY,
      pageHeightPx,
      sourceCanvas.height,
      keepTogetherRanges
    )
    const pageCanvas = createCanvasPageSlice(sourceCanvas, offsetY, sliceHeight, document)
    const sliceHeightMm = sliceHeight / pixelsPerMm

    if (pageIndex > 0) {
      pdf.addPage()
    }

    pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidthMm, sliceHeightMm, undefined, 'FAST')

    offsetY += sliceHeight
    pageIndex += 1
  }

  pdf.save(title || 'report.pdf')
}

export async function generatePdfFromHtml(
  elementId: string,
  title?: string
): Promise<void> {
  const element = document.getElementById(elementId)
  if (!element) {
    throw new Error(`Element with id "${elementId}" not found`)
  }

  await printElementAsPdf({
    element,
    title
  })
}

/**
 * Legacy compatibility wrapper for older callers.
 * The current report flow renders HTML first and then exports it through `printElementAsPdf`.
 */
export async function generatePdfWithJsPDF(
  _inspectionReport: unknown,
  _robotName: string,
  fileName: string
): Promise<void> {
  const element = document.getElementById('inspection-report-pdf')
  if (!element) {
    throw new Error('Inspection report element not found')
  }

  await printElementAsPdf({
    element,
    title: fileName
  })
}

export function __setPdfGenerationDepsLoaderForTests(
  loader: (() => Promise<PdfGenerationDeps>) | null
): void {
  testDepsLoader = loader
}

export function __setPdfCanvasFactoryForTests(factory: CanvasFactory | null): void {
  testCanvasFactory = factory
}
