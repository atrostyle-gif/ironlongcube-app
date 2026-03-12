const DRAWINGS_API = "/.netlify/functions/drawings";
const UPLOAD_DRAWING_API = "/.netlify/functions/upload-drawing";

export type Drawing = {
  model_id: string;
  size: string;
  stage: number;
  drawing_name: string;
  drawing_path: string;
};

export async function fetchDrawings(): Promise<Drawing[]> {
  const res = await fetch(DRAWINGS_API, { method: "GET" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string })?.error ?? `図面一覧の取得に失敗しました (${res.status})`
    );
  }
  const data = (await res.json()) as { drawings?: Drawing[] };
  return Array.isArray(data?.drawings) ? data.drawings : [];
}

export function getDrawingFileUrl(drawingPath: string): string {
  return `/.netlify/functions/drawing-file?path=${encodeURIComponent(drawingPath)}`;
}

export async function uploadDrawing(
  model_id: string,
  size: string,
  stage: number,
  file: File
): Promise<void> {
  const form = new FormData();
  form.append("model_id", model_id);
  form.append("size", size);
  form.append("stage", String(stage));
  form.append("file", file);
  const res = await fetch(UPLOAD_DRAWING_API, {
    method: "POST",
    body: form,
  });
  const data = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || !data.success) {
    throw new Error(
      data?.error ?? `図面のアップロードに失敗しました (${res.status})`
    );
  }
}
