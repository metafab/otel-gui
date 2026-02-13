// Deterministic color palette for service names

const COLOR_PALETTE = [
	'#3b82f6', // blue
	'#10b981', // green
	'#f59e0b', // amber
	'#ef4444', // red
	'#8b5cf6', // purple
	'#ec4899', // pink
	'#14b8a6', // teal
	'#f97316', // orange
	'#6366f1', // indigo
	'#84cc16', // lime
	'#06b6d4', // cyan
	'#a855f7', // violet
	'#eab308', // yellow
	'#22c55e', // green-500
	'#0ea5e9', // sky
	'#f43f5e' // rose
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
		return '#6b7280'; // gray for unknown services
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
