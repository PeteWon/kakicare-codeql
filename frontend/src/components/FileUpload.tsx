import { useEffect, useId, useMemo, useState } from 'react';
import type { DragEvent } from 'react';

// FileUpload: a click-to-pick + drag-and-drop file field.
//
// SECURITY NOTES (see security report):
// - The file-type and file-size checks below are USABILITY measures ONLY and
//   are trivially bypassable (devtools, curl, a modified bundle). The BACKEND
//   must independently validate the REAL content type by inspecting file
//   contents/magic bytes — NOT the extension or the client-sent MIME type —
//   enforce the size limit, store the file OUTSIDE the web root, and serve it
//   only via an authenticated, authorised endpoint (abuse case AC-10;
//   SR-DATA-03, SR-DATA-04).
// - The accepted-type allow-list passed in via `accept` MUST be kept in sync
//   with the backend's allow-list. The backend remains the authoritative gate.
// - The filename is rendered through normal JSX text only (React escapes it).
//   A filename can contain markup, so we NEVER use dangerouslySetInnerHTML.
// - The image preview uses a locally-created object URL (URL.createObjectURL)
//   and is revoked (URL.revokeObjectURL) on cleanup to avoid memory leaks. We
//   never preview from a server URL.

interface FileUploadProps {
  label: string;
  /** Comma-separated MIME allow-list for the native input, e.g. "image/png". */
  accept: string;
  /** Human-readable hint of accepted types, e.g. "JPG, PNG or PDF". */
  acceptedLabel: string;
  /** Max file size in megabytes (usability check only). */
  maxSizeMB?: number;
  file: File | null;
  onChange: (file: File | null) => void;
  /** Hint the browser to offer the camera on mobile (still allows file pick). */
  capture?: boolean;
  /** Required-field error supplied by the parent form. */
  error?: string | null;
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUpload({
  label,
  accept,
  acceptedLabel,
  maxSizeMB = 5,
  file,
  onChange,
  capture = false,
  error,
}: FileUploadProps) {
  const inputId = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const accepted = useMemo(
    () => accept.split(',').map((s) => s.trim().toLowerCase()),
    [accept],
  );

  // Create/revoke an object URL for image previews only.
  useEffect(() => {
    if (file && file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreviewUrl(null);
  }, [file]);

  function typeAllowed(candidate: File): boolean {
    if (candidate.type && accepted.includes(candidate.type)) return true;
    // Fallback for browsers that report an empty type (some mobile cases).
    const ext = candidate.name.toLowerCase().split('.').pop() ?? '';
    const mapped = EXT_TO_MIME[ext];
    return mapped ? accepted.includes(mapped) : false;
  }

  function handleFile(candidate: File | undefined) {
    if (!candidate) return;
    if (!typeAllowed(candidate)) {
      setFileError(`Unsupported file type. Please upload ${acceptedLabel}.`);
      onChange(null);
      return;
    }
    if (candidate.size > maxSizeMB * 1024 * 1024) {
      setFileError(`File is too large. Maximum size is ${maxSizeMB} MB.`);
      onChange(null);
      return;
    }
    setFileError(null);
    onChange(candidate);
  }

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  const shownError = fileError ?? error ?? null;

  return (
    <div className="w-full" data-error={shownError ? 'true' : undefined}>
      <label htmlFor={inputId} className="block text-sm font-medium text-primary-800">
        {label}
      </label>

      {/* Hidden native input — the primary, click-to-pick path (works on mobile). */}
      <input
        id={inputId}
        type="file"
        accept={accept}
        {...(capture ? { capture: 'environment' as const } : {})}
        className="sr-only"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          // Reset so picking the same file again still fires onChange.
          e.target.value = '';
        }}
      />

      {file ? (
        <div className="mt-2 flex items-center gap-3 rounded-xl border border-cream-300 bg-white p-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Selected document preview"
              className="h-14 w-14 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-cream-200 text-xs font-semibold text-primary-600"
            >
              PDF
            </div>
          )}
          <div className="min-w-0 flex-1">
            {/* Rendered as escaped text by React — never as HTML. */}
            <p className="truncate text-sm font-medium text-primary-900">{file.name}</p>
            <p className="text-xs text-primary-400">{formatSize(file.size)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <label
              htmlFor={inputId}
              className="cursor-pointer rounded-lg px-3 py-2 text-sm text-primary-700 hover:bg-primary-50"
            >
              Replace
            </label>
            <button
              type="button"
              onClick={() => {
                setFileError(null);
                onChange(null);
              }}
              className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`mt-2 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
            dragging
              ? 'border-primary-500 bg-primary-50'
              : 'border-cream-300 bg-cream-50 hover:border-primary-300'
          }`}
        >
          <span className="text-sm font-medium text-primary-700">
            Tap to upload{capture ? ' or take a photo' : ''}
          </span>
          <span className="mt-1 text-xs text-primary-400">
            or drag a file here — {acceptedLabel}, up to {maxSizeMB} MB
          </span>
        </label>
      )}

      {shownError ? <p className="mt-1 text-sm text-red-600">{shownError}</p> : null}
    </div>
  );
}
