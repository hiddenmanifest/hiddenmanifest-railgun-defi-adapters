import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildZeroXAllowanceHolderQuoteUrl,
  fetchZeroXAllowanceHolderQuote,
  buildZeroXPrivateSwapPlan
} from '../dist/adapters/zero-x/index.js';
import { calculatePostUnshieldAmount, encodeERC20Approve } from '../dist/core/encoding.js';

const relayAdapt = '0xF82d00fC51F730F42A00F85E74895a2849ffF2Dd';
const railgunAddress =
  '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts';
const usdc = { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, symbol: 'USDC' };
const usdt = { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, symbol: 'USDT' };

test('calculates post-unshield amount', () => {
  assert.equal(calculatePostUnshieldAmount(1_000_000n, 25), 997_500n);
});

test('encodes exact ERC20 approval', () => {
  assert.equal(
    encodeERC20Approve('0x0000000000001fF3684f28c67538d4D072C22734', 997_500n),
    '0x095ea7b30000000000000000000000000000000000001ff3684f28c67538d4d072c2273400000000000000000000000000000000000000000000000000000000000f387c'
  );
});

test('rejects invalid approval spender input', () => {
  assert.throws(
    () => encodeERC20Approve('0xnot-an-address', 997_500n),
    /spender must be a valid EVM address/
  );
});

test('quote url uses RelayAdapt as taker and explicit recipient without txOrigin by default', () => {
  const url = buildZeroXAllowanceHolderQuoteUrl({
    chainId: 137,
    sellToken: usdc,
    buyToken: usdt,
    sellAmount: 997_500n,
    relayAdaptContract: relayAdapt,
    slippageBps: 100
  });

  assert.equal(url.searchParams.get('taker'), relayAdapt);
  assert.equal(url.searchParams.get('recipient'), relayAdapt);
  assert.equal(url.searchParams.has('txOrigin'), false);
});

test('builds direct Railgun cross-contract call plan from a 0x quote', async () => {
  const fetchCalls = [];
  const plan = await buildZeroXPrivateSwapPlan({
    chainId: 137,
    relayAdaptContract: relayAdapt,
    railgunAddress,
    sellToken: usdc,
    buyToken: usdt,
    sellAmount: 1_000_000n,
    slippageBps: 100,
    zeroXApiKey: 'test-key',
    unshieldFeeBasisPoints: 25,
    fetch: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        async text() {
          return '';
        },
        async json() {
          return {
            liquidityAvailable: true,
            sellToken: usdc.address,
            buyToken: usdt.address,
            sellAmount: '997500',
            buyAmount: '993789',
            minBuyAmount: '980000',
            allowanceTarget: '0x0000000000001fF3684f28c67538d4D072C22734',
            transaction: {
              to: '0x0000000000001fF3684f28c67538d4D072C22734',
              data: '0x2213bc0b',
              value: '0',
              gas: '500000'
            },
            issues: {
              allowance: {
                actual: '0',
                spender: '0x0000000000001fF3684f28c67538d4D072C22734'
              },
              invalidSourcesPassed: []
            },
            zid: 'quote-id'
          };
        }
      };
    }
  });

  assert.equal(fetchCalls.length, 1);
  assert.equal(plan.unshieldERC20Amounts[0].amount, 1_000_000n);
  assert.deepEqual(plan.unshieldERC721Amounts, []);
  assert.equal(plan.metadata.swapSellAmount, 997_500n);
  assert.deepEqual(
    plan.shieldERC20Recipients.map((recipient) => recipient.tokenAddress),
    [usdc.address, usdt.address]
  );
  assert.equal(plan.shieldERC20Recipients[0].recipientAddress, railgunAddress);
  assert.equal(plan.shieldERC20Recipients[1].recipientAddress, railgunAddress);
  assert.deepEqual(plan.shieldERC721Recipients, []);
  assert.equal(plan.crossContractCalls[0].to, usdc.address);
  assert.equal(plan.crossContractCalls[0].value, 0n);
  assert.equal(plan.crossContractCalls[1].data, '0x2213bc0b');
});

test('rejects same-token swaps before requesting a quote', async () => {
  let fetchCalled = false;

  await assert.rejects(
    () =>
      buildZeroXPrivateSwapPlan({
        chainId: 137,
        relayAdaptContract: relayAdapt,
        railgunAddress,
        sellToken: usdc,
        buyToken: usdc,
        sellAmount: 1_000_000n,
        slippageBps: 100,
        zeroXApiKey: 'test-key',
        unshieldFeeBasisPoints: 25,
        fetch: async () => {
          fetchCalled = true;
          throw new Error('unexpected quote request');
        }
      }),
    /sellToken and buyToken must be different/
  );

  assert.equal(fetchCalled, false);
});

test('rejects a blank RAILGUN shield recipient before requesting a quote', async () => {
  let fetchCalled = false;

  await assert.rejects(
    () =>
      buildZeroXPrivateSwapPlan({
        chainId: 137,
        relayAdaptContract: relayAdapt,
        railgunAddress: ' ',
        sellToken: usdc,
        buyToken: usdt,
        sellAmount: 1_000_000n,
        slippageBps: 100,
        zeroXApiKey: 'test-key',
        unshieldFeeBasisPoints: 25,
        fetch: async () => {
          fetchCalled = true;
          throw new Error('unexpected quote request');
        }
      }),
    /railgunAddress is required/
  );

  assert.equal(fetchCalled, false);
});

test('rejects a RAILGUN shield recipient that fails caller validation', async () => {
  let fetchCalled = false;

  await assert.rejects(
    () =>
      buildZeroXPrivateSwapPlan({
        chainId: 137,
        relayAdaptContract: relayAdapt,
        railgunAddress,
        validateRailgunAddress: () => false,
        sellToken: usdc,
        buyToken: usdt,
        sellAmount: 1_000_000n,
        slippageBps: 100,
        zeroXApiKey: 'test-key',
        unshieldFeeBasisPoints: 25,
        fetch: async () => {
          fetchCalled = true;
          throw new Error('unexpected quote request');
        }
      }),
    /railgunAddress failed validation/
  );

  assert.equal(fetchCalled, false);
});

test('rejects untrusted 0x transaction targets when an allowlist is provided', async () => {
  await assert.rejects(
    () =>
      buildZeroXPrivateSwapPlan({
        chainId: 137,
        relayAdaptContract: relayAdapt,
        railgunAddress,
        sellToken: usdc,
        buyToken: usdt,
        sellAmount: 1_000_000n,
        slippageBps: 100,
        zeroXApiKey: 'test-key',
        unshieldFeeBasisPoints: 25,
        trustedTransactionTargets: ['0x1111111111111111111111111111111111111111'],
        fetch: async () => ({
          ok: true,
          status: 200,
          async text() {
            return '';
          },
          async json() {
            return {
              liquidityAvailable: true,
              sellToken: usdc.address,
              buyToken: usdt.address,
              sellAmount: '997500',
              buyAmount: '993789',
              minBuyAmount: '980000',
              allowanceTarget: '0x0000000000001fF3684f28c67538d4D072C22734',
              transaction: {
                to: '0x0000000000001fF3684f28c67538d4D072C22734',
                data: '0x2213bc0b',
                value: '0'
              },
              issues: {
                invalidSourcesPassed: []
              }
            };
          }
        })
      }),
    /0x transaction.to is not in trustedTransactionTargets/
  );
});

test('rejects untrusted 0x allowance spenders when an allowlist is provided', async () => {
  await assert.rejects(
    () =>
      buildZeroXPrivateSwapPlan({
        chainId: 137,
        relayAdaptContract: relayAdapt,
        railgunAddress,
        sellToken: usdc,
        buyToken: usdt,
        sellAmount: 1_000_000n,
        slippageBps: 100,
        zeroXApiKey: 'test-key',
        unshieldFeeBasisPoints: 25,
        trustedAllowanceSpenders: ['0x1111111111111111111111111111111111111111'],
        fetch: async () => ({
          ok: true,
          status: 200,
          async text() {
            return '';
          },
          async json() {
            return {
              liquidityAvailable: true,
              sellToken: usdc.address,
              buyToken: usdt.address,
              sellAmount: '997500',
              buyAmount: '993789',
              minBuyAmount: '980000',
              allowanceTarget: '0x0000000000001fF3684f28c67538d4D072C22734',
              transaction: {
                to: '0x0000000000001fF3684f28c67538d4D072C22734',
                data: '0x2213bc0b',
                value: '0'
              },
              issues: {
                allowance: {
                  actual: '0',
                  spender: '0x0000000000001fF3684f28c67538d4D072C22734'
                },
                invalidSourcesPassed: []
              }
            };
          }
        })
      }),
    /0x allowance spender is not in trustedAllowanceSpenders/
  );
});

test('does not expose raw 0x error bodies in thrown request errors', async () => {
  await assert.rejects(
    () =>
      fetchZeroXAllowanceHolderQuote(new URL('https://api.0x.org/swap/allowance-holder/quote'), 'test-key', async () => ({
        ok: false,
        status: 400,
        async text() {
          return 'sensitive quote payload';
        },
        async json() {
          return {};
        }
      })),
    (error) =>
      error instanceof Error &&
      error.message === '0x quote request failed (400)' &&
      !error.message.includes('sensitive quote payload')
  );
});
