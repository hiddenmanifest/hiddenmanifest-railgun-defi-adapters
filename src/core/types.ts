export type HexString = `0x${string}`;

export type EVMAddress = HexString;

export type ERC20Token = {
  address: EVMAddress;
  decimals: number;
  symbol?: string;
};

export type CrossContractCall = {
  to: EVMAddress;
  data: HexString;
  value: bigint;
};

export type RelayAdaptUnshieldERC20Amount = {
  tokenAddress: EVMAddress;
  amount: bigint;
};

export type RelayAdaptShieldERC20Recipient = {
  tokenAddress: EVMAddress;
  recipientAddress: string;
};

export type PrivateDefiCallPlan<Metadata = unknown> = {
  adapter: string;
  chainId: number;
  relayAdaptContract: EVMAddress;
  unshieldERC20Amounts: RelayAdaptUnshieldERC20Amount[];
  shieldERC20Recipients: RelayAdaptShieldERC20Recipient[];
  crossContractCalls: CrossContractCall[];
  minGasLimit: bigint;
  metadata: Metadata;
};

export type PrivateSwapPlanMetadata = {
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  sellAmount: bigint;
  swapSellAmount: bigint;
  buyAmount: bigint;
  minBuyAmount: bigint;
  spender: EVMAddress;
  quoteId?: string;
  route?: unknown;
};

export type PrivateSwapCallPlan = PrivateDefiCallPlan<PrivateSwapPlanMetadata>;

export type AdapterFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  }
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
