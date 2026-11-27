// Limits for a person's photo. Client-safe: the editor uses them for the file
// picker, the server enforces them.

/** Largest file the editor accepts. The stored photo is far smaller. */
export const PERSON_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Longest side, in pixels, of the stored photo. */
export const PERSON_PHOTO_MAX_DIMENSION = 400;

/** For the file input's `accept`; the server decides the type from the content. */
export const PERSON_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
