export async function tryRead(fn) {
  try {
    return await fn();
  } catch {
    return null;
  }
}
export function bnToDecimal(bn, decimals = 18) {
  try {
    return Number(bn) / 10 ** decimals;
  } catch {
    return 0;
  }
}
