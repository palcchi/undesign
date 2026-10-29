/**
 * PNG export: rasterize the SVG the editor already generates for a page or
 * selection. Images embedded as data: URLs stay same-origin, so the canvas
 * is never tainted; background is transparent unless the design paints one.
 */

/** Rewrite the SVG root's width/height for a raster scale factor. */
export function scaledSvg(svg: string, scale: number): { svg: string; w: number; h: number } {
  const wMatch = svg.match(/<svg[^>]*\swidth="([\d.]+)"/);
  const hMatch = svg.match(/<svg[^>]*\sheight="([\d.]+)"/);
  const w = Math.max(1, Math.round(Number(wMatch?.[1] ?? 800) * scale));
  const h = Math.max(1, Math.round(Number(hMatch?.[1] ?? 600) * scale));
  const out = svg
    .replace(/(<svg[^>]*\swidth=")[\d.]+(")/, `$1${w}$2`)
    .replace(/(<svg[^>]*\sheight=")[\d.]+(")/, `$1${h}$2`);
  return { svg: out, w, h };
}

/** Rasterize an SVG document string to a PNG blob at the given scale. */
export function svgToPngBlob(svg: string, scale: number): Promise<Blob> {
  const { svg: sized, w, h } = scaledSvg(svg, scale);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))),
          'image/png',
        );
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e instanceof Error ? e : new Error('PNG export failed'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not render the design for PNG export'));
    };
    img.src = url;
  });
}

/** Trigger a download for a Blob (PNG path; string downloads use downloadFile). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
