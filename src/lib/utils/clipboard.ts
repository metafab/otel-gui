/**
 * Copies text to the clipboard and temporarily sets a "copied" flag.
 *
 * @param text - The text to write to the clipboard.
 * @param setCopied - Setter that receives true immediately, then false after
 *                   `resetMs` milliseconds. Intended for `$state` variables.
 * @param resetMs - How long (in ms) to keep the copied state. Defaults to 1500.
 */
export async function copyToClipboard(
	text: string,
	setCopied: (v: boolean) => void,
	resetMs = 1500
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), resetMs);
	} catch {
		// Clipboard API not available in this context — silently ignore.
	}
}
