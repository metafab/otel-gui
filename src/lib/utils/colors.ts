// Deterministic pastel color palette for service names
// Avoids red (reserved for error spans)

const COLOR_PALETTE = [
	'#93c5fd', // pastel blue
	'#6ee7b7', // pastel emerald
	'#fcd34d', // pastel amber
	'#c4b5fd', // pastel violet
	'#a5f3fc', // pastel cyan-light
	'#5eead4', // pastel teal
	'#fdba74', // pastel orange
	'#a5b4fc', // pastel indigo
	'#bef264', // pastel lime
	'#67e8f9', // pastel cyan
	'#d8b4fe', // pastel purple
	'#fde047', // pastel yellow
	'#86efac', // pastel green
	'#7dd3fc', // pastel sky
	'#ddd6fe', // pastel lavender
	'#99f6e4' // pastel teal-light
];

// Simple hash function for strings
function hashString(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash; // Convert to 32-bit integer
	}
	return Math.abs(hash);
}

// Get color for service name (deterministic)
export function getServiceColor(serviceName: string): string {
	if (!serviceName) {
		return '#d1d5db'; // pastel gray for unknown services
	}

	const index = hashString(serviceName) % COLOR_PALETTE.length;
	return COLOR_PALETTE[index];
}

// Get all service names from spans and create color map
export function createServiceColorMap(serviceNames: string[]): Map<string, string> {
	const colorMap = new Map<string, string>();

	for (const serviceName of serviceNames) {
		if (!colorMap.has(serviceName)) {
			colorMap.set(serviceName, getServiceColor(serviceName));
		}
	}

	return colorMap;
}
