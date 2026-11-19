export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** URL for a generated JSON file in public/data, respecting the Pages base path. */
export function dataUrl(file: string): string {
  return `${BASE_PATH}/data/${file}`;
}
