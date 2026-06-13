import type { EVMAddress, HexString } from './types.js';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HEX_PATTERN = /^0x([a-fA-F0-9]{2})*$/;
const ERC20_APPROVE_SELECTOR = '0x095ea7b3';

export function isEVMAddress(value: string): value is EVMAddress {
  return ADDRESS_PATTERN.test(value);
}

export function assertEVMAddress(value: string, label: string): asserts value is EVMAddress {
  if (!isEVMAddress(value)) {
    throw new Error(`${label} must be a valid EVM address`);
  }
}

export function isHexString(value: string): value is HexString {
  return HEX_PATTERN.test(value);
}

export function assertHexString(value: string, label: string): asserts value is HexString {
  if (!isHexString(value)) {
    throw new Error(`${label} must be a 0x-prefixed even-length hex string`);
  }
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function encodeERC20Approve(spender: EVMAddress, amount: bigint): HexString {
  assertEVMAddress(spender, 'spender');
  if (amount < 0n) {
    throw new Error('approve amount cannot be negative');
  }

  const encodedSpender = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const encodedAmount = amount.toString(16).padStart(64, '0');
  return `${ERC20_APPROVE_SELECTOR}${encodedSpender}${encodedAmount}` as HexString;
}

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
    throw new Error('sell amount must be greater than zero');
  }

  return (amount * BigInt(10_000 - unshieldFeeBasisPoints)) / 10_000n;
}
