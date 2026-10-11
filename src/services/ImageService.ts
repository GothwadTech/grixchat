/**
 * ImageService handles image uploads to ImgBB.
 * This is used as an alternative to Firebase Storage.
 */

import { SupabaseStorageService } from './SupabaseStorageService';

export class ImageService {
  /**
   * Uploads an image file to Supabase Storage and returns the public URL.
   * @param file The image file to upload.
   * @param onProgress Callback for upload progress.
   * @returns The public URL of the uploaded image.
   */
  /**
   * Downscale + re-encode before upload.
   *
   * Photos used to go to Storage at full camera resolution (3–8 MB), and every
   * recipient then downloaded that original to render a 300 px bubble. Photos
   * are the one asset where the egress bill scales with the file, so shrink
   * them before they ever reach the bucket.
   *
   * JPEG/WebP only — a PNG may carry transparency, and a decoder may not exist
   * (SSR/older browsers), in which case the original is uploaded untouched.
   */
  static async compressImage(file: File, maxEdge: number = 1600, quality: number = 0.82): Promise<File> {
    const compressible = file.type === 'image/jpeg' || file.type === 'image/webp';
    if (!compressible) return file;
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return file;

    try {
      const bitmap = await createImageBitmap(file);
      const largestEdge = Math.max(bitmap.width, bitmap.height);
      const scale = Math.min(1, maxEdge / largestEdge);
      if (scale === 1 && file.size < 300 * 1024) return file;

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;

      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (!blob || blob.size >= file.size) return file;

      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return new File([blob], name, { type: 'image/jpeg' });
    } catch {
      return file;
    }
  }

  static async uploadImage(
    file: File, 
    onProgress?: (progress: number) => void,
    bucket: string = 'chat-media'
  ): Promise<string> {
    try {
      if (onProgress) onProgress(20);
      const optimized = await ImageService.compressImage(file);
      const url = await SupabaseStorageService.uploadImage(optimized, onProgress, bucket);
      if (onProgress) onProgress(100);
      return url;
    } catch (error) {
      console.error("Supabase Image Upload Error:", error);
      throw error;
    }
  }

  /**
   * Fallback to server proxy for image upload (still kept but redirects to Supabase conceptually)
   */
  static async uploadViaProxy(file: File, onProgress?: (progress: number) => void, bucket: string = 'chat-media'): Promise<string> {
    return this.uploadImage(file, onProgress, bucket);
  }

  /**
   * Converts a base64 string or data URL to a File object.
   */
  static dataURLtoFile(dataurl: string, filename: string): File {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }
}
