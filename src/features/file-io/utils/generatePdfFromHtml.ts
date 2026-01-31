/**
 * Generate PDF from HTML using browser's print functionality
 * This ensures proper Chinese character support without needing external fonts
 */

export async function generatePdfFromHtml(
  elementId: string,
  fileName: string,
  title?: string
): Promise<void> {
  const element = document.getElementById(elementId);
  if (!element) {
    throw new Error(`Element with id "${elementId}" not found`);
  }

  // Store original page title
  const originalTitle = document.title;
  if (title) {
    document.title = title;
  }

  // Store original styles
  const originalStyle = document.body.getAttribute('style');

  // Create a clone for printing
  const clone = element.cloneNode(true) as HTMLElement;

  // Create print container
  const printContainer = document.createElement('div');
  printContainer.id = 'pdf-print-container';
  printContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 99999;
    background: white;
    padding: 0;
    margin: 0;
    display: flex;
    justify-content: center;
  `;

  // Apply print-specific styles to the clone
  clone.style.cssText = `
    width: 100%;
    max-width: 210mm;
    padding: 20mm;
    box-sizing: border-box;
    background: white;
  `;

  printContainer.appendChild(clone);
  document.body.appendChild(printContainer);

  // Inject print styles
  const styleElement = document.createElement('style');
  styleElement.textContent = `
    @media print {
      body * {
        visibility: hidden;
      }
      #pdf-print-container,
      #pdf-print-container * {
        visibility: visible;
      }
      #pdf-print-container {
        position: absolute;
        left: 0;
        top: 0;
      }
      @page {
        margin: 0;
        size: A4;
      }
    }
  `;
  document.head.appendChild(styleElement);

  // Use print dialog to generate PDF
  try {
    await new Promise<void>((resolve, reject) => {
      const printHandler = () => {
        window.removeEventListener('afterprint', printHandler);
        cleanup();
        resolve();
      };

      const errorHandler = () => {
        window.removeEventListener('afterprint', printHandler);
        cleanup();
        reject(new Error('Print dialog was cancelled'));
      };

      // Wait a bit for styles to apply
      setTimeout(() => {
        window.addEventListener('afterprint', printHandler);
        window.addEventListener('cancel', errorHandler);
        window.print();
      }, 100);
    });
  } finally {
    // Restore original state
    document.title = originalTitle;
    if (originalStyle) {
      document.body.setAttribute('style', originalStyle);
    } else {
      document.body.removeAttribute('style');
    }
  }

  function cleanup() {
    const container = document.getElementById('pdf-print-container');
    if (container) {
      document.body.removeChild(container);
    }
    const styles = document.head.querySelectorAll('style[data-pdf-print]');
    styles.forEach((s) => s.remove());
  }
}

/**
 * Alternative: Generate PDF using jsPDF with autoTable plugin
 * This requires jsPDF to have Chinese font support
 */
export async function generatePdfWithJsPDF(
  inspectionReport: any,
  robotName: string,
  lang: 'zh' | 'en',
  fileName: string
): Promise<void> {
  // This is a fallback implementation that uses html2canvas + jsPDF
  // For now, we'll use the print-based approach which is more reliable for Chinese

  // Import jsPDF dynamically
  const { default: jsPDF } = await import('jspdf');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let yPos = margin;

  // Title (English only for jsPDF - fallback)
  doc.setFontSize(20);
  doc.setTextColor(50, 50, 50);
  doc.text('URDF Robot Inspection Report', pageWidth / 2, yPos, { align: 'center' });
  yPos += 15;

  // Robot name
  doc.setFontSize(14);
  doc.setTextColor(100, 100, 100);
  doc.text(`Robot Name: ${robotName}`, margin, yPos);
  yPos += 10;

  // Date
  const now = new Date();
  const dateStr = now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  doc.text(`Inspection Date: ${dateStr}`, margin, yPos);
  yPos += 15;

  // Overall score
  const overallScore = inspectionReport.overallScore ?? 0;
  const maxScore = inspectionReport.maxScore ?? 100;
  doc.setFontSize(16);
  doc.setTextColor(50, 50, 50);
  doc.text(`Overall Score: ${overallScore.toFixed(1)}/${maxScore}`, margin, yPos);
  yPos += 10;

  // Progress bar
  const scorePercentage = (overallScore / maxScore) * 100;
  const barWidth = pageWidth - 2 * margin;
  const barHeight = 5;
  doc.setFillColor(200, 200, 200);
  doc.rect(margin, yPos, barWidth, barHeight, 'F');

  let barColor: [number, number, number] = [239, 68, 68]; // red
  if (scorePercentage >= 90) barColor = [34, 197, 94]; // green
  else if (scorePercentage >= 60) barColor = [234, 179, 8]; // yellow
  doc.setFillColor(...barColor);
  doc.rect(margin, yPos, (barWidth * scorePercentage) / 100, barHeight, 'F');
  yPos += 15;

  // Summary
  doc.setFontSize(12);
  doc.setTextColor(50, 50, 50);
  doc.setFont('helvetica', 'bold');
  doc.text('Inspection Summary', margin, yPos);
  yPos += 8;
  doc.setFont('helvetica', 'normal');
  const summaryLines = doc.splitTextToSize(inspectionReport.summary, pageWidth - 2 * margin);
  doc.text(summaryLines, margin, yPos);
  yPos += summaryLines.length * 6 + 10;

  // Issues
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Total Issues: ${inspectionReport.issues.length}`, margin, yPos);

  doc.save(fileName);
}
