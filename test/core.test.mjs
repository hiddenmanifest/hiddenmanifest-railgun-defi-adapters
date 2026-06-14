import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertActionTransaction,
  assertTrustedAddress,
  buildApproveCall,
  buildERC20ShieldRecipients,
  buildERC721ShieldRecipients,
  encodeERC20Approve,
  fetchAdapterJson
} from '../dist/core/encoding.js';

const allowanceHolder = '0x0000000000001fF3684f28c67538d4D072C22734';
const railgunAddress =
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts';
const usdc = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
const usdt = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';
const nft = '0x8D04a8c79Ceb0889Bdd12ACdf3fa9D207Ed3Ff63';

test('assertTrustedAddress is a no-op without an allowlist', () => {
  assert.doesNotThrow(() => assertTrustedAddress(allowanceHolder, undefined, 'unexpected'));
});

test('assertTrustedAddress matches case-insensitively', () => {
  assert.doesNotThrow(() =>
    assertTrustedAddress(allowanceHolder.toLowerCase(), [allowanceHolder], 'unexpected')
  );
});

test('assertTrustedAddress throws the supplied message when not allowlisted', () => {
  assert.throws(
    () => assertTrustedAddress(usdc, [allowanceHolder], 'spender is not trusted'),
    /spender is not trusted/
  );
});

test('assertActionTransaction rejects empty calldata', () => {
  assert.throws(
    () => assertActionTransaction({ to: allowanceHolder, data: '0x', value: 0n }),
    /transaction\.data cannot be empty/
  );
});

test('assertActionTransaction rejects non-zero value when zero is required', () => {
  assert.throws(
    () =>
      assertActionTransaction(
        { to: allowanceHolder, data: '0x2213bc0b', value: 1n },
        { requireZeroValue: true }
      ),
    /transaction\.value must be zero/
  );
});

test('assertActionTransaction supports adapter-specific zero-value messages', () => {
  assert.throws(
    () =>
      assertActionTransaction(
        { to: allowanceHolder, data: '0x2213bc0b', value: 1n },
        { requireZeroValue: true, zeroValueErrorMessage: 'swap value must be zero' }
      ),
    /swap value must be zero/
  );
});

test('buildApproveCall produces the exact approval call', () => {
  const call = buildApproveCall(usdc, allowanceHolder, 997_500n);
  assert.equal(call.to, usdc);
  assert.equal(call.value, 0n);
  assert.equal(call.data, encodeERC20Approve(allowanceHolder, 997_500n));
});

test('buildERC20ShieldRecipients dedupes token addresses by case', () => {
  const recipients = buildERC20ShieldRecipients([usdc, usdt, usdc.toLowerCase()], railgunAddress);
  assert.equal(recipients.length, 2);
  assert.deepEqual(
    recipients.map((recipient) => recipient.tokenAddress),
    [usdc, usdt]
  );
  assert.equal(recipients[0].recipientAddress, railgunAddress);
});

test('buildERC721ShieldRecipients dedupes by token address and tokenSubID', () => {
  const recipients = buildERC721ShieldRecipients(
    [
      { tokenAddress: nft, tokenSubID: 1n },
      { tokenAddress: nft.toLowerCase(), tokenSubID: 1n },
      { tokenAddress: nft, tokenSubID: 2n }
    ],
    railgunAddress
  );

  assert.equal(recipients.length, 2);
  assert.deepEqual(
    recipients.map((recipient) => recipient.tokenSubID),
    [1n, 2n]
  );
  assert.equal(recipients[0].recipientAddress, railgunAddress);
});

test('fetchAdapterJson never leaks the upstream error body', async () => {
  await assert.rejects(
    () =>
      fetchAdapterJson('https://example.test/quote', {
        errorPrefix: 'quote request failed',
        fetch: async () => ({
          ok: false,
          status: 429,
          async text() {
            return 'sensitive upstream payload';
          },
          async json() {
            return {};
          }
        })
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'quote request failed (429)' &&
      !error.message.includes('sensitive upstream payload')
  );
});
