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

Pass `plan.unshieldERC20Amounts`, `plan.unshieldERC721Amounts`,
`plan.shieldERC20Recipients`, `plan.shieldERC721Recipients`,
`plan.crossContractCalls`, and `plan.minGasLimit` into the RAILGUN Wallet SDK
cross-contract proof/populate functions.

`validateRailgunAddress` is optional, but production callers should wire it to
the installed RAILGUN SDK or local address parser before building a funds-flow
plan. `trustedTransactionTargets` and `trustedAllowanceSpenders` are also
optional because 0x targets can vary by chain and API version; pass them when the
app maintains chain-specific 0x target and spender allowlists.

## Writing an adapter

Every adapter is a pure call planner that returns a `PrivateDefiCallPlan`. The
0x module is the reference implementation; new adapters follow the same shape so
they stay small and auditable.

**Module layout** — one adapter per directory: `src/adapters/<name>/index.ts`.
Re-export it from `src/index.ts` and add a `./<name>` subpath to the
`package.json` `exports` map.

**Required exports**

- A params type that extends `BasePrivatePlanParams` (`core/types.ts`) with the
  protocol-specific fields. This gives every adapter the same validated RAILGUN
  surface: `chainId`, `relayAdaptContract`, `railgunAddress`,
  `validateRailgunAddress?`, `unshieldFeeBasisPoints`, `fetch?`, `minGasLimit?`,
  `trustedTransactionTargets?`. Protocol-specific trust inputs, such as 0x
  allowance spender allowlists, belong on the adapter params type rather than the
  base params.
- An async entry function satisfying
  `PrivateDefiPlanBuilder<Params, Metadata>` — i.e. `(params) => Promise<PrivateDefiCallPlan<Metadata>>`.
  Specialize the plan's `metadata` by extending `BasePlanMetadata`
  (`{ quoteId?, route? }`), as `PrivateSwapPlanMetadata` does.
- The URL builder and the fetch helper as separate exported functions so tests
  can inject a mock `fetch` and assert request shape independently.

**Shared core helpers** (`core/encoding.ts`) — reuse these rather than
re-implementing per adapter:

- `assertChainId`, `assertBasisPoints` — input range checks.
- `assertRailgunRecipient` — non-blank railgun address + optional validator.
- `calculatePostUnshieldAmount` — apply the unshield fee before quoting/approving.
- `assertActionTransaction` — structural check of an upstream call (`to`/`data`/
  optional zero `value`).
- `assertTrustedAddress` — optional allowlist membership with a caller-supplied
  message.
- `buildApproveCall` — construct an exact ERC20 approval `CrossContractCall`.
- `buildERC20ShieldRecipients`, `buildERC721ShieldRecipients` — construct
  deduped shield-back recipient lists for the plan's asset legs.
- `fetchAdapterJson` — GET + JSON with the upstream error body redacted (only the
  status is surfaced).

**The canonical lifecycle**: build request URL → `fetchAdapterJson` → validate
the response (token/amount match, `assertActionTransaction`, allowlists) →
assemble ERC20/ERC721 unshield amounts, any approval calls, the action calls,
and complete ERC20/ERC721 shield recipient lists into a `PrivateDefiCallPlan`.

**Tests** — add `test/<name>.test.mjs` running against `dist` with an injected
`fetch` fixture, mirroring `test/zero-x.test.mjs`.

## References

- RAILGUN cross-contract calls: https://docs.railgun.org/developer-guide/wallet/transactions/cross-contract-calls
- 0x AllowanceHolder quote API: https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getquote
- 0x contract addresses: https://docs.0x.org/docs/core-concepts/contracts
