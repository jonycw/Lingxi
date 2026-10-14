const MILLION = 1_000_000n;

function ceilMulDiv(tokens: bigint, microsPerMillion: bigint): bigint {
  if (tokens <= 0n || microsPerMillion <= 0n) {
    return 0n;
  }
  return (tokens * microsPerMillion + MILLION - 1n) / MILLION;
}

/** Integer micro-credit cost. 1 credit = 1_000_000 micros. Prices are micros per 1,000,000 tokens. */
export function computeCostMicros(
  promptTokens: number,
  completionTokens: number,
  inputMicrosPerMillion: number,
  outputMicrosPerMillion: number,
): number {
  const cost =
    ceilMulDiv(BigInt(promptTokens), BigInt(inputMicrosPerMillion)) +
    ceilMulDiv(BigInt(completionTokens), BigInt(outputMicrosPerMillion));
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Token charge exceeds the safe integer range');
  }
  return Number(cost);
}
