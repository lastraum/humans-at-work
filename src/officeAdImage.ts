/** Client-side resize/compress for office window ads. Longest side ≤ 512px. */

export const OFFICE_AD_MAX_EDGE = 512;
export const OFFICE_AD_MAX_BYTES = 180_000;

export type CompressedOfficeAd = {
  dataUrl: string;
  mime: "image/jpeg" | "image/webp";
  width: number;
  height: number;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that image."));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not encode image."));
    reader.readAsDataURL(blob);
  });
}

export async function compressOfficeAd(file: File): Promise<CompressedOfficeAd> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error("Image has no size.");
  const scale = Math.min(1, OFFICE_AD_MAX_EDGE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw image.");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const tryEncode = async (mime: "image/webp" | "image/jpeg", quality: number) => {
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!blob || blob.size === 0) return null;
    return { blob, mime };
  };

  let picked: { blob: Blob; mime: "image/webp" | "image/jpeg" } | null = null;
  for (const quality of [0.82, 0.7, 0.58, 0.45]) {
    const webp = await tryEncode("image/webp", quality);
    const jpeg = await tryEncode("image/jpeg", quality);
    const candidates = [webp, jpeg].filter((row): row is { blob: Blob; mime: "image/webp" | "image/jpeg" } => Boolean(row));
    candidates.sort((a, b) => a.blob.size - b.blob.size);
    const fit = candidates.find((row) => row.blob.size <= OFFICE_AD_MAX_BYTES) ?? candidates[0];
    if (!fit) continue;
    picked = fit;
    if (fit.blob.size <= OFFICE_AD_MAX_BYTES) break;
  }
  if (!picked) throw new Error("Could not compress that image.");
  if (picked.blob.size > OFFICE_AD_MAX_BYTES) {
    throw new Error("Image is still too large after compress.");
  }
  return {
    dataUrl: await blobToDataUrl(picked.blob),
    mime: picked.mime,
    width,
    height,
  };
}
