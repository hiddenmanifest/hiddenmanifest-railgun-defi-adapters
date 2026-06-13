import {
  assertEVMAddress,
  assertHexString,
  calculatePostUnshieldAmount,
  encodeERC20Approve,
  sameAddress
} from '../../core/encoding.js';
import type {
  AdapterFetch,
  CrossContractCall,
  ERC20Token,
  EVMAddress,
  HexString,
  PrivateSwapCallPlan
} from '../../core/types.js';

const ZEROX_API_BASE = 'https://api.0x.org';
const ZEROX_API_VERSION = 'v2';
const ZEROX_ALLOWANCE_HOLDER_ADDRESS = '0x0000000000001fF3684f28c67538d4D072C22734';
const DEFAULT_MIN_GAS_LIMIT = 2_500_000n;
const DEFAULT_EXCLUDED_SOURCES = '0x_RFQ,Uniswap_V3';

export type ZeroXAffiliateFee = {
  recipient: EVMAddress;
  bps: number;
  token: 'sellToken' | 'buyToken';
};

export type BuildZeroXQuoteUrlParams = {
  chainId: number;
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  sellAmount: bigint;
  relayAdaptContract: EVMAddress;
  slippageBps: number;
  recipient?: EVMAddress;
  txOrigin?: EVMAddress;
  excludedSources?: string;
  affiliateFee?: ZeroXAffiliateFee;
};

export type ZeroXQuoteResponse = {
  buyAmount: string;
  buyToken: string;
  sellAmount: string;
  sellToken: string;
  minBuyAmount: string;
  allowanceTarget?: string;
  liquidityAvailable: boolean;
  zid?: string;
  transaction: {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
  };
  issues?: {
    allowance?: {
      actual: string;
      spender: string;
    } | null;
    balance?: {
      token: string;
      actual: string;
      expected: string;
    } | null;
    simulationIncomplete?: boolean;
    invalidSourcesPassed?: string[];
  };
  route?: unknown;
};

export type BuildZeroXPrivateSwapPlanParams = {
  chainId: number;
  relayAdaptContract: EVMAddress;
  railgunAddress: string;
  validateRailgunAddress?: (railgunAddress: string) => boolean;
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  sellAmount: bigint;
  slippageBps: number;
  zeroXApiKey: string;
  unshieldFeeBasisPoints: number;
  fetch?: AdapterFetch;
  txOrigin?: EVMAddress;
  excludedSources?: string;
  affiliateFee?: ZeroXAffiliateFee;
  minGasLimit?: bigint;
  trustedTransactionTargets?: EVMAddress[];
  trustedAllowanceSpenders?: EVMAddress[];
};

export function buildZeroXAllowanceHolderQuoteUrl(params: BuildZeroXQuoteUrlParams): URL {
  assertEVMAddress(params.relayAdaptContract, 'relayAdaptContract');
  assertEVMAddress(params.sellToken.address, 'sellToken.address');
  assertEVMAddress(params.buyToken.address, 'buyToken.address');

  if (!Number.isInteger(params.chainId) || params.chainId <= 0) {
    throw new Error('chainId must be a positive integer');
  }
  if (!Number.isInteger(params.slippageBps) || params.slippageBps < 0 || params.slippageBps > 10_000) {
    throw new Error('slippageBps must be an integer from 0 to 10000');
  }
  if (params.sellAmount <= 0n) {
    throw new Error('quote sellAmount must be greater than zero');
  }

  const url = new URL('/swap/allowance-holder/quote', ZEROX_API_BASE);
  url.searchParams.set('chainId', params.chainId.toString());
  url.searchParams.set('sellToken', params.sellToken.address);
  url.searchParams.set('buyToken', params.buyToken.address);
  url.searchParams.set('sellAmount', params.sellAmount.toString());
  url.searchParams.set('taker', params.relayAdaptContract);
  url.searchParams.set('recipient', params.recipient ?? params.relayAdaptContract);
  url.searchParams.set('slippageBps', params.slippageBps.toString());
  url.searchParams.set('excludedSources', params.excludedSources ?? DEFAULT_EXCLUDED_SOURCES);

  if (params.txOrigin) {
    assertEVMAddress(params.txOrigin, 'txOrigin');
    url.searchParams.set('txOrigin', params.txOrigin);
  }

  if (params.affiliateFee) {
    assertEVMAddress(params.affiliateFee.recipient, 'affiliateFee.recipient');
    if (
      !Number.isInteger(params.affiliateFee.bps) ||
      params.affiliateFee.bps < 0 ||
      params.affiliateFee.bps > 1_000
    ) {
      throw new Error('affiliateFee.bps must be an integer from 0 to 1000');
    }
    url.searchParams.set('swapFeeRecipient', params.affiliateFee.recipient);
    url.searchParams.set('swapFeeBps', params.affiliateFee.bps.toString());
    url.searchParams.set(
      'swapFeeToken',
      params.affiliateFee.token === 'buyToken' ? params.buyToken.address : params.sellToken.address
    );
  }

  return url;
}

export async function fetchZeroXAllowanceHolderQuote(
  url: URL,
  apiKey: string,
  fetchImpl: AdapterFetch = globalThis.fetch as AdapterFetch
): Promise<ZeroXQuoteResponse> {
  if (!apiKey) {
    throw new Error('zeroXApiKey is required');
  }
  if (!fetchImpl) {
    throw new Error('fetch implementation is required');
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      '0x-api-key': apiKey,
      '0x-version': ZEROX_API_VERSION,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    await response.text().catch(() => '');
    throw new Error(`0x quote request failed (${response.status})`);
  }

  return (await response.json()) as ZeroXQuoteResponse;
}

export async function buildZeroXPrivateSwapPlan(
  params: BuildZeroXPrivateSwapPlanParams
): Promise<PrivateSwapCallPlan> {
  assertEVMAddress(params.relayAdaptContract, 'relayAdaptContract');
  assertEVMAddress(params.sellToken.address, 'sellToken.address');
  assertEVMAddress(params.buyToken.address, 'buyToken.address');
  if (sameAddress(params.sellToken.address, params.buyToken.address)) {
    throw new Error('sellToken and buyToken must be different');
  }
  if (!params.railgunAddress.trim()) {
    throw new Error('railgunAddress is required');
  }
  if (
    params.validateRailgunAddress &&
    !params.validateRailgunAddress(params.railgunAddress)
  ) {
    throw new Error('railgunAddress failed validation');
  }

  const swapSellAmount = calculatePostUnshieldAmount(
    params.sellAmount,
    params.unshieldFeeBasisPoints
  );
  const quoteUrlParams: BuildZeroXQuoteUrlParams = {
    chainId: params.chainId,
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: swapSellAmount,
    relayAdaptContract: params.relayAdaptContract,
    recipient: params.relayAdaptContract,
    slippageBps: params.slippageBps
  };
  if (params.txOrigin) quoteUrlParams.txOrigin = params.txOrigin;
  if (params.excludedSources) quoteUrlParams.excludedSources = params.excludedSources;
  if (params.affiliateFee) quoteUrlParams.affiliateFee = params.affiliateFee;

  const quoteUrl = buildZeroXAllowanceHolderQuoteUrl(quoteUrlParams);
  const quote = await fetchZeroXAllowanceHolderQuote(
    quoteUrl,
    params.zeroXApiKey,
    params.fetch
  );

  const quoteValidationParams: Parameters<typeof validateZeroXQuote>[0] = {
    quote,
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    swapSellAmount
  };
  if (params.trustedTransactionTargets) {
    quoteValidationParams.trustedTransactionTargets = params.trustedTransactionTargets;
  }
  if (params.trustedAllowanceSpenders) {
    quoteValidationParams.trustedAllowanceSpenders = params.trustedAllowanceSpenders;
  }
  const spender = validateZeroXQuote(quoteValidationParams);

  const approveCall: CrossContractCall = {
    to: params.sellToken.address,
    data: encodeERC20Approve(spender, swapSellAmount),
    value: 0n
  };
  const swapCall: CrossContractCall = {
    to: quote.transaction.to as EVMAddress,
    data: quote.transaction.data as HexString,
    value: BigInt(quote.transaction.value || '0')
  };

  const metadata: PrivateSwapCallPlan['metadata'] = {
    sellToken: params.sellToken,
    buyToken: params.buyToken,
    sellAmount: params.sellAmount,
    swapSellAmount,
    buyAmount: BigInt(quote.buyAmount),
    minBuyAmount: BigInt(quote.minBuyAmount),
    spender
  };
  if (quote.zid) metadata.quoteId = quote.zid;
  if (quote.route !== undefined) metadata.route = quote.route;

  return {
    adapter: '0x-allowance-holder',
    chainId: params.chainId,
    relayAdaptContract: params.relayAdaptContract,
    unshieldERC20Amounts: [
      {
        tokenAddress: params.sellToken.address,
        amount: params.sellAmount
      }
    ],
    shieldERC20Recipients: [
      {
        tokenAddress: params.sellToken.address,
        recipientAddress: params.railgunAddress
      },
      {
        tokenAddress: params.buyToken.address,
        recipientAddress: params.railgunAddress
      }
    ],
    crossContractCalls: [approveCall, swapCall],
    minGasLimit: params.minGasLimit ?? DEFAULT_MIN_GAS_LIMIT,
    metadata
  };
}

function validateZeroXQuote(params: {
  quote: ZeroXQuoteResponse;
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  swapSellAmount: bigint;
  trustedTransactionTargets?: EVMAddress[];
  trustedAllowanceSpenders?: EVMAddress[];
}): EVMAddress {
  const {
    quote,
    sellToken,
    buyToken,
    swapSellAmount,
    trustedTransactionTargets,
    trustedAllowanceSpenders
  } = params;
  if (!quote.liquidityAvailable) {
    throw new Error('0x quote has no available liquidity');
  }
  if (!sameAddress(quote.sellToken, sellToken.address)) {
    throw new Error('0x quote sellToken does not match request');
  }
  if (!sameAddress(quote.buyToken, buyToken.address)) {
    throw new Error('0x quote buyToken does not match request');
  }
  if (BigInt(quote.sellAmount) !== swapSellAmount) {
    throw new Error('0x quote sellAmount does not match post-unshield amount');
  }
  if (BigInt(quote.buyAmount) <= 0n || BigInt(quote.minBuyAmount) <= 0n) {
    throw new Error('0x quote buy amounts must be greater than zero');
  }
  if ((quote.issues?.invalidSourcesPassed?.length ?? 0) > 0) {
    throw new Error(`0x quote contains invalid excluded sources: ${quote.issues?.invalidSourcesPassed?.join(', ')}`);
  }

  assertEVMAddress(quote.transaction.to, '0x transaction.to');
  if (
    trustedTransactionTargets &&
    !trustedTransactionTargets.some((target) => sameAddress(target, quote.transaction.to))
  ) {
    throw new Error('0x transaction.to is not in trustedTransactionTargets');
  }
  assertHexString(quote.transaction.data, '0x transaction.data');
  if (quote.transaction.data === '0x') {
    throw new Error('0x transaction.data cannot be empty');
  }
  if (BigInt(quote.transaction.value || '0') !== 0n) {
    throw new Error('0x transaction.value must be zero for ERC20-to-ERC20 private swaps');
  }

  const spender =
    quote.issues?.allowance?.spender ?? quote.allowanceTarget ?? ZEROX_ALLOWANCE_HOLDER_ADDRESS;
  assertEVMAddress(spender, '0x allowance spender');
  if (
    trustedAllowanceSpenders &&
    !trustedAllowanceSpenders.some((trustedSpender) => sameAddress(trustedSpender, spender))
  ) {
    throw new Error('0x allowance spender is not in trustedAllowanceSpenders');
  }
  return spender;
}
