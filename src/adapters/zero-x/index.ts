import {
  assertActionTransaction,
  assertBasisPoints,
  assertChainId,
  assertEVMAddress,
  assertRailgunRecipient,
  assertTrustedAddress,
  buildApproveCall,
  buildERC20ShieldRecipients,
  calculatePostUnshieldAmount,
  fetchAdapterJson,
  sameAddress
} from '../../core/encoding.js';
import type {
  AdapterFetch,
  BasePrivatePlanParams,
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

export type BuildZeroXPrivateSwapPlanParams = BasePrivatePlanParams & {
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  sellAmount: bigint;
  slippageBps: number;
  zeroXApiKey: string;
  txOrigin?: EVMAddress;
  excludedSources?: string;
  affiliateFee?: ZeroXAffiliateFee;
  trustedAllowanceSpenders?: EVMAddress[];
};

export function buildZeroXAllowanceHolderQuoteUrl(params: BuildZeroXQuoteUrlParams): URL {
  assertEVMAddress(params.relayAdaptContract, 'relayAdaptContract');
  assertEVMAddress(params.sellToken.address, 'sellToken.address');
  assertEVMAddress(params.buyToken.address, 'buyToken.address');

  assertChainId(params.chainId);
  assertBasisPoints(params.slippageBps, 'slippageBps');
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
    assertBasisPoints(params.affiliateFee.bps, 'affiliateFee.bps', 1_000);
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

  return fetchAdapterJson<ZeroXQuoteResponse>(url, {
    fetch: fetchImpl,
    headers: {
      '0x-api-key': apiKey,
      '0x-version': ZEROX_API_VERSION,
      'Content-Type': 'application/json'
    },
    errorPrefix: '0x quote request failed'
  });
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
  assertRailgunRecipient(params.railgunAddress, params.validateRailgunAddress);

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

  const approveCall = buildApproveCall(params.sellToken.address, spender, swapSellAmount);
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
    unshieldERC721Amounts: [],
    shieldERC20Recipients: buildERC20ShieldRecipients(
      [params.sellToken.address, params.buyToken.address],
      params.railgunAddress
    ),
    shieldERC721Recipients: [],
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

  assertActionTransaction(
    {
      to: quote.transaction.to,
      data: quote.transaction.data,
      value: BigInt(quote.transaction.value || '0')
    },
    {
      label: '0x transaction',
      requireZeroValue: true,
      zeroValueErrorMessage: '0x transaction.value must be zero for ERC20-to-ERC20 private swaps'
    }
  );
  assertTrustedAddress(
    quote.transaction.to,
    trustedTransactionTargets,
    '0x transaction.to is not in trustedTransactionTargets'
  );

  const spender =
    quote.issues?.allowance?.spender ?? quote.allowanceTarget ?? ZEROX_ALLOWANCE_HOLDER_ADDRESS;
  assertEVMAddress(spender, '0x allowance spender');
  assertTrustedAddress(
    spender,
    trustedAllowanceSpenders,
    '0x allowance spender is not in trustedAllowanceSpenders'
  );
  return spender;
}
