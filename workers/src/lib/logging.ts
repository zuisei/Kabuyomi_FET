export function logEvent(event: string, payload: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      event,
      ...payload,
      loggedAt: new Date().toISOString()
    })
  );
}
