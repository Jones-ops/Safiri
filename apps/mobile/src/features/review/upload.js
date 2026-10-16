/**
 * Review photos and clips go to the private "media" bucket with resumable (tus) uploads, so a
 * 40 MB clip on a patchy connection carries on from where it stopped instead of starting over.
 * Each traveller may only write under their own folder (Storage policy), so paths are
 * `<userId>/<timestamp>-<n>.<ext>`.
 */
import * as tus from 'tus-js-client';
import { supabase } from '../../lib/supabase';

const CHUNK = 6 * 1024 * 1024; // Supabase requires 6 MB chunks for resumable uploads
const BUCKET = 'media';

const extensionFor = (asset) => {
  if (asset.mimeType === 'image/png') return 'png';
  if (asset.mimeType === 'image/webp') return 'webp';
  if (asset.type === 'video') return 'mp4';
  return 'jpg';
};

const mimeFor = (asset) => asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg');

/** Picks a Storage path for each picked asset, up front, so the review can reference them. */
export function pathsFor(userId, assets) {
  const stamp = Date.now();
  return assets.map((asset, i) => `${userId}/${stamp}-${i + 1}.${extensionFor(asset)}`);
}

/** Uploads one asset; `onProgress(0..1)`. Resolves when the file is fully stored. */
export async function uploadAsset(asset, path, onProgress) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_signed_in');
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL;

  await new Promise((resolve, reject) => {
    const upload = new tus.Upload(
      { uri: asset.uri, name: path.split('/').pop(), type: mimeFor(asset) },
      {
        endpoint: `${base}/storage/v1/upload/resumable`,
        retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
        chunkSize: CHUNK,
        headers: { authorization: `Bearer ${token}`, 'x-upsert': 'true' },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: { bucketName: BUCKET, objectName: path, contentType: mimeFor(asset), cacheControl: '3600' },
        onError: reject,
        onProgress: (sent, total) => onProgress?.(total ? sent / total : 0),
        onSuccess: resolve,
      },
    );
    // Carry on with a previous attempt of the same file if there is one.
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    }, reject);
  });
}

/** Uploads all assets in turn, reporting overall progress. */
export async function uploadAll(assets, paths, onProgress) {
  for (let i = 0; i < assets.length; i++) {
    await uploadAsset(assets[i], paths[i], (p) => onProgress?.((i + p) / assets.length));
  }
  onProgress?.(1);
}
