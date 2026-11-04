export function outputSize(width: number, height: number, pro: boolean, resolution = 1080) {
  const target = pro ? ([720, 1080, 2160].includes(resolution) ? resolution : 1080) : 720;
  const scale = pro ? target / Math.min(width, height) : Math.min(1, target / Math.min(width, height));
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}
export function watermarkCanvas(width: number, height: number): HTMLCanvasElement {
  const mark = document.createElement('canvas');
  const font = Math.max(12, Math.min(width, height) * 0.025);
  const context = mark.getContext('2d');
  if (!context) throw new Error('Could not prepare export watermark');
  context.font = `500 ${font}px sans-serif`;
  mark.width = Math.ceil(context.measureText('Made with FrameCut').width + font);
  mark.height = Math.ceil(font * 2);
  context.font = `500 ${font}px sans-serif`;
  context.fillStyle = 'rgba(0,0,0,0.7)'; context.fillRect(0, 0, mark.width, mark.height);
  context.fillStyle = '#ffffff'; context.textBaseline = 'middle';
  context.fillText('Made with FrameCut', font / 2, mark.height / 2);
  return mark;
}
export function drawExportWatermark(context: CanvasRenderingContext2D, mark: HTMLCanvasElement) {
  const margin = Math.min(context.canvas.width, context.canvas.height) * 0.025;
  context.save(); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(mark, Math.max(margin, context.canvas.width - mark.width - margin), context.canvas.height - mark.height - margin);
  context.restore();
}

export function screenshotCanvas(source: HTMLCanvasElement, pro: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = pro ? source : outputSize(source.width, source.height, false);
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare screenshot');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!pro) drawExportWatermark(context, watermarkCanvas(canvas.width, canvas.height));
  return canvas;
}
