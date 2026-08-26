/**
 * The result of an attempt to write a file's contents to disk.
 *
 * Shared between the main process (which performs the write) and the renderer
 * (which needs to know whether its optimistic "clean" state actually held, so
 * a rejected write can be retried instead of silently dropped).
 */
export enum FileSaveResult {
	Failed = -1,
	Identical = 0,
	Success = 1
}
