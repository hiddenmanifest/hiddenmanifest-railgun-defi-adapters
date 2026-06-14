import type {
  AdapterFetch,
  CrossContractCall,
  EVMAddress,
  HexString,
  RelayAdaptShieldERC20Recipient,
  RelayAdaptShieldERC721Recipient
} from './types.js';

/**
 * Shared EVM and RAILGUN call-plan helpers. Adapter modules should compose
 * these small primitives so validation and output construction stay consistent.
 */

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN = /^0x([a-fA-F0-9]{2})*$/;
const ERC20_APPROVE_SELECTOR = '0x095ea7b3';

/** Returns true when the value is a syntactically valid 20-byte EVM address. */
export function isEVMAddress(value: string): value is EVMAddress {
  return ADDRESS_PATTERN.test(value);
}

/** Narrows a string to an EVM address or throws with a caller-facing label. */
export function assertEVMAddress(value: string, label: string): asserts value is EVMAddress {
  if (!isEVMAddress(value)) {
    throw new Error(`${label} must be a valid EVM address`);
  }
}

/** Returns true for 0x-prefixed even-length calldata/ABI hex strings. */
export function isHexString(value: string): value is HexString {
  return HEX_PATTERN.test(value);
}

/** Narrows a string to calldata-safe hex or throws with a caller-facing label. */
export function assertHexString(value: string, label: string): asserts value is HexString {
  if (!isHexString(value)) {
    throw new Error(`${label} must be a 0x-prefixed even-length hex string`);
  }
}

/** Case-insensitive address comparison for allowlists and upstream responses. */
export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Encodes an ERC20 approve(spender, amount) call without pulling in an ABI library. */
export function encodeERC20Approve(spender: EVMAddress, amount: bigint): HexString {
  assertEVMAddress(spender, 'spender');
  if (amount < 0n) {
    throw new Error('approve amount cannot be negative');
  }

  const encodedSpender = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const encodedAmount = amount.toString(16).padStart(64, '0');
  return `${ERC20_APPROVE_SELECTOR}${encodedSpender}${encodedAmount}` as HexString;
}

/**
 * Applies the RAILGUN unshield fee to an amount before an adapter quotes or
 * approves downstream protocol calls. The original amount should still be the
 * value unshielded into RelayAdapt.
 */
export function calculatePostUnshieldAmount(
  amount: bigint,
  unshieldFeeBasisPoints: number
): bigint {
  if (!Number.isInteger(unshieldFeeBasisPoints)) {
    throw new Error('unshieldFeeBasisPoints must be an integer');
  }
  if (unshieldFeeBasisPoints < 0 || unshieldFeeBasisPoints >= 10_000) {
    throw new Error('unshieldFeeBasisPoints must be between 0 and 9999');
  }
  if (amount <= 0n) {
    throw new Error('amount must be greater than zero');
  }

  return (amount * BigInt(10_000 - unshieldFeeBasisPoints)) / 10_000n;
}

/** Validates the EVM chain ID shared by all adapter builders. */
export function assertChainId(chainId: number): void {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }
}

/** Validates basis-point style fields while allowing adapter-specific caps. */
export function assertBasisPoints(value: number, label: string, max = 10_000): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be an integer from 0 to ${max}`);
  }
}

/**
 * Ensures a shield recipient is present and delegates network/address-format
 * validation to the host app when it provides a RAILGUN SDK validator.
 */
export function assertRailgunRecipient(
  railgunAddress: string,
  validate?: (railgunAddress: string) => boolean
): void {
  if (!railgunAddress.trim()) {
    throw new Error('railgunAddress is required');
  }
  if (validate && !validate(railgunAddress)) {
    throw new Error('railgunAddress failed validation');
  }
}

/**
 * Asserts `address` is present in `allowlist` (a no-op when no allowlist is
 * given). `errorMessage` is thrown verbatim so adapters keep stable, specific
 * messages (e.g. naming the exact allowlist param).
 */
export function assertTrustedAddress(
  address: string,
  allowlist: EVMAddress[] | undefined,
  errorMessage: string
): void {
  if (allowlist && !allowlist.some((trusted) => sameAddress(trusted, address))) {
    throw new Error(errorMessage);
  }
}

/**
 * Structural validation of an external call returned by an upstream quote:
 * `to` is an address, `data` is non-empty calldata, and (optionally) `value`
 * is zero. Trusted-target allowlisting is intentionally separate
 * ({@link assertTrustedAddress}) so adapters control that message.
 */
export function assertActionTransaction(
  transaction: { to: string; data: string; value: bigint },
  options: { label?: string; requireZeroValue?: boolean; zeroValueErrorMessage?: string } = {}
): void {
  const label = options.label ?? 'transaction';
  assertEVMAddress(transaction.to, `${label}.to`);
  assertHexString(transaction.data, `${label}.data`);
  if (transaction.data === '0x') {
    throw new Error(`${label}.data cannot be empty`);
  }
  if (options.requireZeroValue && transaction.value !== 0n) {
    throw new Error(options.zeroValueErrorMessage ?? `${label}.value must be zero`);
  }
}

/** Builds the exact ERC20 approval call adapters should place before spending. */
export function buildApproveCall(
  tokenAddress: EVMAddress,
  spender: EVMAddress,
  amount: bigint
): CrossContractCall {
  assertEVMAddress(tokenAddress, 'tokenAddress');
  return {
    to: tokenAddress,
    data: encodeERC20Approve(spender, amount),
    value: 0n
  };
}

/**
 * Builds a deduped ERC20 shield-back list. RAILGUN only shields listed tokens,
 * so adapters should include outputs and possible dust/refund token addresses.
 */
export function buildERC20ShieldRecipients(
  tokenAddresses: EVMAddress[],
  railgunAddress: string
): RelayAdaptShieldERC20Recipient[] {
  const seen = new Set<string>();
  const recipients: RelayAdaptShieldERC20Recipient[] = [];
  for (const tokenAddress of tokenAddresses) {
    assertEVMAddress(tokenAddress, 'shield tokenAddress');
    const key = tokenAddress.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    recipients.push({ tokenAddress, recipientAddress: railgunAddress });
  }
  return recipients;
}

/** Builds a deduped ERC721 shield-back list keyed by contract and tokenSubID. */
export function buildERC721ShieldRecipients(
  tokenIds: { tokenAddress: EVMAddress; tokenSubID: bigint }[],
  railgunAddress: string
): RelayAdaptShieldERC721Recipient[] {
  const seen = new Set<string>();
  const recipients: RelayAdaptShieldERC721Recipient[] = [];
  for (const tokenId of tokenIds) {
    assertEVMAddress(tokenId.tokenAddress, 'shield tokenAddress');
    const key = `${tokenId.tokenAddress.toLowerCase()}:${tokenId.tokenSubID.toString()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    recipients.push({
      tokenAddress: tokenId.tokenAddress,
      tokenSubID: tokenId.tokenSubID,
      recipientAddress: railgunAddress
    });
  }
  return recipients;
}

/**
 * Fetches adapter JSON while redacting upstream error bodies. Quote APIs may
 * return sensitive route/accounting details that should not be surfaced in logs.
 */
export async function fetchAdapterJson<T>(
  url: string | URL,
  options: {
    fetch?: AdapterFetch;
    headers?: Record<string, string>;
    errorPrefix: string;
  }
): Promise<T> {
  const fetchImpl = options.fetch ?? (globalThis.fetch as AdapterFetch);
  if (!fetchImpl) {
    throw new Error('fetch implementation is required');
  }

  const init: { method: string; headers?: Record<string, string> } = { method: 'GET' };
  if (options.headers) {
    init.headers = options.headers;
  }

  const response = await fetchImpl(url, init);
  if (!response.ok) {
    // Drain but never surface the upstream body; it may contain sensitive quote data.
    await response.text().catch(() => '');
    throw new Error(`${options.errorPrefix} (${response.status})`);
  }

  return (await response.json()) as T;
}
