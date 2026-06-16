export function shouldUseHistoryBack(
  referrer: string,
  currentOrigin: string,
  expectedPath: string,
): boolean {
  if (!referrer) return false

  try {
    const referrerUrl = new URL(referrer)
    return (
      referrerUrl.origin === currentOrigin &&
      referrerUrl.pathname === expectedPath
    )
  } catch {
    return false
  }
}
