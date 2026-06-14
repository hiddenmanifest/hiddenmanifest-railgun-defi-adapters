/** A 0x-prefixed hex string. Runtime helpers narrow this further where needed. */
export type HexString = `0x${string}`;

/** EVM address strings are represented as hex strings and validated at runtime. */
export type EVMAddress = HexString;

/** ERC20 token descriptor used by adapter params and metadata. */
export type ERC20Token = {
  /** Token contract address on the target chain. */
  address: EVMAddress;
  /** Display/accounting decimals from the token contract. */
  decimals: number;
  /** Optional display symbol for metadata and logs. */
  symbol?: string;
};

/** Ordered external call executed by RelayAdapt during a cross-contract transaction. */
export type CrossContractCall = {
  /** Target contract called by RelayAdapt. */
  to: EVMAddress;
  /** ABI-encoded calldata for the target contract. */
  data: HexString;
  /** Native token value sent with the call. */
  value: bigint;
};

/** ERC20 amount to unshield into RelayAdapt before adapter calls execute. */
export type RelayAdaptUnshieldERC20Amount = {
  tokenAddress: EVMAddress;
  amount: bigint;
};

/** ERC721 token to unshield into RelayAdapt before adapter calls execute. */
export type RelayAdaptUnshieldERC721Amount = {
  tokenAddress: EVMAddress;
  tokenSubID: bigint;
};

/** ERC20 token address to shield back to the target RAILGUN recipient. */
export type RelayAdaptShieldERC20Recipient = {
  tokenAddress: EVMAddress;
  recipientAddress: string;
};

/** ERC721 token to shield back to the target RAILGUN recipient. */
export type RelayAdaptShieldERC721Recipient = {
  tokenAddress: EVMAddress;
  tokenSubID: bigint;
  recipientAddress: string;
};

/**
 * Protocol-neutral output every adapter returns. Consumers pass these fields to
 * the RAILGUN Wallet SDK proof/populate cross-contract functions. Empty arrays
 * are intentional for asset classes an adapter does not touch.
 */
export type PrivateDefiCallPlan<Metadata = unknown> = {
  /** Stable adapter identifier for logging, analytics, and downstream policy checks. */
  adapter: string;
  /** EVM chain ID the plan was built for. */
  chainId: number;
  /** Current RelayAdapt contract address from the installed RAILGUN SDK config. */
  relayAdaptContract: EVMAddress;
  /** ERC20 amounts to unshield into RelayAdapt before calls execute. */
  unshieldERC20Amounts: RelayAdaptUnshieldERC20Amount[];
  /** ERC721 tokens to unshield into RelayAdapt before calls execute. */
  unshieldERC721Amounts: RelayAdaptUnshieldERC721Amount[];
  /** Complete ERC20 token list to shield back after calls, including dust tokens. */
  shieldERC20Recipients: RelayAdaptShieldERC20Recipient[];
  /** Complete ERC721 token list to shield back after calls. */
  shieldERC721Recipients: RelayAdaptShieldERC721Recipient[];
  /** Ordered external calls executed by RelayAdapt between unshield and shield. */
  crossContractCalls: CrossContractCall[];
  /** Adapter-provided floor for gas estimation/proof generation. */
  minGasLimit: bigint;
  /** Adapter-specific quote, route, or accounting data for callers to inspect. */
  metadata: Metadata;
};

/**
 * RAILGUN-common inputs every adapter plan builder accepts. Protocol-specific
 * params types should extend this so all adapters share one validated surface
 * for the cross-contract flow.
 */
export type BasePrivatePlanParams = {
  /** EVM chain ID used for upstream quotes and downstream policy checks. */
  chainId: number;
  /** RelayAdapt address from the current RAILGUN network config. */
  relayAdaptContract: EVMAddress;
  /** RAILGUN recipient that receives shielded outputs after adapter calls. */
  railgunAddress: string;
  /** Optional host-provided validator from the installed RAILGUN SDK. */
  validateRailgunAddress?: (railgunAddress: string) => boolean;
  /** RAILGUN unshield fee applied before protocol calls can spend funds. */
  unshieldFeeBasisPoints: number;
  /** Optional fetch injection for tests, custom transports, or host runtimes. */
  fetch?: AdapterFetch;
  /** Adapter-specific gas floor passed through to proof/populate calls. */
  minGasLimit?: bigint;
  /** Optional allowlist for externally returned transaction targets. */
  trustedTransactionTargets?: EVMAddress[];
};

/** Metadata fields any adapter may surface from an upstream quote. */
export type BasePlanMetadata = {
  quoteId?: string;
  route?: unknown;
};

/**
 * The contract every adapter's entry function must satisfy: take a params type
 * extending {@link BasePrivatePlanParams} and resolve to a neutral call plan.
 */
export type PrivateDefiPlanBuilder<
  Params extends BasePrivatePlanParams,
  Metadata
> = (params: Params) => Promise<PrivateDefiCallPlan<Metadata>>;

/** Common metadata shape for token-swap adapters. */
export type PrivateSwapPlanMetadata = BasePlanMetadata & {
  sellToken: ERC20Token;
  buyToken: ERC20Token;
  sellAmount: bigint;
  swapSellAmount: bigint;
  buyAmount: bigint;
  minBuyAmount: bigint;
  spender: EVMAddress;
};

/** Convenience alias for adapters whose action is an ERC20-to-ERC20 swap. */
export type PrivateSwapCallPlan = PrivateDefiCallPlan<PrivateSwapPlanMetadata>;

/** Minimal fetch-compatible function shape used for tests and host injection. */
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
