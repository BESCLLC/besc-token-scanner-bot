export async function tryRead(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
