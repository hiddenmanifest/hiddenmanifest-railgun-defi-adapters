# Hidden Manifest RAILGUN DeFi Adapters

Auditable DeFi adapter call planners for RAILGUN cross-contract private
transactions.

This package constructs call plans only. It does not hold private keys, derive
wallet material, generate RAILGUN proofs, submit transactions, or recover funds.

The package is intended to host focused adapters for DeFi protocols and
aggregators, such as swaps, lending, staking, bridging, or liquidity operations.
Each adapter should expose a small, reviewable call planner that can be passed
into the RAILGUN Wallet SDK proof/populate flow by the consuming app.

Shared core exports include `PrivateDefiCallPlan` for protocol-neutral
cross-contract plans. Protocol modules can specialize that base type with their
own metadata, as the 0x swap module does with `PrivateSwapCallPlan`.

## Adapters

### 0x AllowanceHolder Swap

The 0x adapter builds the direct, non-Cookbook call plan described by the
RAILGUN cross-contract call flow:

1. Unshield the exact sell-token amount into RelayAdapt.
2. Approve the exact post-unshield-fee amount to the 0x allowance spender.
3. Execute the 0x quote transaction.
4. Shield the buy token and sell-token dust back to the target RAILGUN address.

The caller must pass the current RelayAdapt contract from the installed RAILGUN
SDK, for example `NETWORK_CONFIG[networkName].relayAdaptContract`. Do not pass a
hardcoded historical RelayAdapt address.

```ts
import { buildZeroXPrivateSwapPlan } from '@hiddenmanifest/railgun-defi-adapters/zero-x';

const plan = await buildZeroXPrivateSwapPlan({
  chainId: 137,
  relayAdaptContract,
  railgunAddress,
  validateRailgunAddress: (address) => railgunSdkCanReceiveOnNetwork(address, 137),
  sellToken: { address: usdc, decimals: 6, symbol: 'USDC' },
  buyToken: { address: usdt, decimals: 6, symbol: 'USDT' },
  sellAmount: 1_000_000n,
  slippageBps: 100,
  zeroXApiKey: process.env.ZEROX_API_KEY,
  unshieldFeeBasisPoints: 25,
  trustedTransactionTargets: [zeroXAllowanceHolderOrSettler],
  trustedAllowanceSpenders: [zeroXAllowanceHolder]
});
```

Pass `plan.unshieldERC20Amounts`, `plan.shieldERC20Recipients`,
`plan.crossContractCalls`, and `plan.minGasLimit` into the RAILGUN Wallet SDK
cross-contract proof/populate functions.

`validateRailgunAddress` is optional, but production callers should wire it to
the installed RAILGUN SDK or local address parser before building a funds-flow
plan. `trustedTransactionTargets` and `trustedAllowanceSpenders` are also
optional because 0x targets can vary by chain and API version; pass them when the
app maintains chain-specific 0x target and spender allowlists.

## References

- RAILGUN cross-contract calls: https://docs.railgun.org/developer-guide/wallet/transactions/cross-contract-calls
- 0x AllowanceHolder quote API: https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote
- 0x contract addresses: https://docs.0x.org/docs/core-concepts/contracts
