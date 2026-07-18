"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { createPublicClient, formatEther, formatUnits, http, type Address } from "viem";
import { base } from "viem/chains";

type DashboardView = "dashboard" | "portfolio" | "nfts" | "transactions" | "quests" | "airdrop" | "settings";

const navigationItems: Array<{ label: string; icon: string; href: string; view: DashboardView }> = [
  { label: "Dashboard", icon: "◉", href: "/dashboard", view: "dashboard" },
  { label: "Portfolio", icon: "◌", href: "/portfolio", view: "portfolio" },
  { label: "NFTs", icon: "◍", href: "/nfts", view: "nfts" },
  { label: "Transactions", icon: "↺", href: "/transactions", view: "transactions" },
  { label: "Quests", icon: "✦", href: "/quests", view: "quests" },
  { label: "Airdrop Checker", icon: "✧", href: "/airdrop-checker", view: "airdrop" },
  { label: "Settings", icon: "⚙", href: "/settings", view: "settings" },
];

const questItems = [
  { title: "Daily Check-in", points: 25, done: true },
  { title: "Connect Wallet", points: 50, done: true },
  { title: "Bridge Assets", points: 100, done: false },
  { title: "Complete Swap", points: 75, done: false },
  { title: "Share on X", points: 40, done: false },
];

type TokenItem = {
  contractAddress: string;
  name: string;
  symbol: string;
  balance: string;
  usdValue: string;
  logoUrl?: string;
};

type NftItem = {
  tokenId: string;
  name: string;
  collectionName: string;
  imageUrl?: string;
  quantity: number;
};

type TransactionItem = {
  hash: string;
  amount: string;
  status: string;
  timestamp: string;
};

function formatAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[1.25rem] border border-white/10 bg-white/5 ${className}`} />;
}

function getExplorerApiHeaders() {
  const apiKey = process.env.NEXT_PUBLIC_BLOCKSCOUT_API_KEY;
  return {
    Accept: "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  } as HeadersInit;
}

async function fetchJson<T>(url: string, signal?: AbortSignal, label = "Explorer request") {
  console.log(`[OGX Base Hub] ${label} ->`, url);
  const response = await fetch(url, {
    signal,
    headers: getExplorerApiHeaders(),
  });

  console.log(`[OGX Base Hub] ${label} status ->`, response.status);

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    console.error(`[OGX Base Hub] ${label} failed ->`, errorText || response.statusText);
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = await response.text();
  try {
    const parsed = JSON.parse(payload) as T;
    console.log(`[OGX Base Hub] ${label} payload ->`, parsed);
    return parsed;
  } catch (error) {
    console.error(`[OGX Base Hub] ${label} parse error ->`, error);
    return [] as T;
  }
}

function getFriendlyErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    const message = error.message;
    if (message.includes("status 400") || message.includes("status 401") || message.includes("status 403")) {
      return `${fallback}. The Base explorer request was rejected. Add NEXT_PUBLIC_BLOCKSCOUT_API_KEY to your .env.local file if your explorer instance requires an API key.`;
    }
    return message;
  }

  return fallback;
}

function getItemsFromPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload && typeof payload === "object") {
    const candidate = payload as { items?: unknown };
    if (Array.isArray(candidate.items)) {
      return candidate.items as T[];
    }
  }

  return [];
}

function safeFormatTokenValue(rawValue: string | number | undefined, decimals: number) {
  try {
    const normalizedValue = String(rawValue ?? "0");
    return Number(formatUnits(BigInt(normalizedValue), decimals));
  } catch {
    return 0;
  }
}

function safeFormatEtherValue(rawValue: string | number | undefined) {
  try {
    const normalizedValue = String(rawValue ?? "0");
    return Number(formatEther(BigInt(normalizedValue))).toFixed(3);
  } catch {
    return "0.000";
  }
}

export default function Home({ initialView }: { initialView?: DashboardView }) {
  const pathname = usePathname();
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, error, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, error: switchError, isPending: isSwitchPending } = useSwitchChain();
  const [isMounted, setIsMounted] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [tokens, setTokens] = useState<TokenItem[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [nfts, setNfts] = useState<NftItem[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [nftsError, setNftsError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [gasPrice, setGasPrice] = useState<string>("Loading...");
  const [gasError, setGasError] = useState<string | null>(null);
  const [walletAge, setWalletAge] = useState<string>("Loading...");
  const [txCount, setTxCount] = useState<string>("Loading...");
  const [interactionCount, setInteractionCount] = useState<string>("Loading...");
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  const [nativeBalance, setNativeBalance] = useState<string>("0.0000 ETH");
  const [balanceLoading, setBalanceLoading] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const currentView = useMemo(() => {
    if (initialView) {
      return initialView;
    }

    if (pathname === "/dashboard" || pathname === "/") return "dashboard";
    if (pathname === "/portfolio") return "portfolio";
    if (pathname === "/nfts") return "nfts";
    if (pathname === "/transactions") return "transactions";
    if (pathname === "/quests") return "quests";
    if (pathname === "/airdrop-checker") return "airdrop";
    if (pathname === "/settings") return "settings";

    return "dashboard";
  }, [initialView, pathname]);

  const shouldRenderWalletContent = isMounted;

  const publicClient = useMemo(() => {
    const rpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL ?? "https://mainnet.base.org";
    return createPublicClient({
      chain: base,
      transport: http(rpcUrl),
    });
  }, []);

  const metaMaskConnector = useMemo(
    () =>
      connectors.find(
        (connector) =>
          connector.id === "metaMaskSDK" ||
          connector.id === "metaMask" ||
          connector.type === "metaMask"
      ),
    [connectors]
  );

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    if (!address || !isConnected) {
      setTokens([]);
      setNfts([]);
      setTransactions([]);
      setNativeBalance("0.0000 ETH");
      setBalanceLoading(false);
      setGasPrice("—");
      setWalletAge("—");
      setTxCount("—");
      setInteractionCount("—");
      setTokensError(null);
      setNftsError(null);
      setTransactionsError(null);
      setGasError(null);
      setAnalyticsError(null);
      return;
    }

    const controller = new AbortController();
    const normalizedAddress = address.toLowerCase();
    console.log("[OGX Base Hub] connected wallet address ->", normalizedAddress);
    console.log("[OGX Base Hub] chain ID ->", chainId ?? "unknown");

    const loadData = async () => {
      try {
        setTokensLoading(true);
        setNftsLoading(true);
        setTransactionsLoading(true);
        setBalanceLoading(true);
        setTokensError(null);
        setNftsError(null);
        setTransactionsError(null);
        setGasError(null);
        setAnalyticsError(null);

        const balanceResult = await publicClient.getBalance({ address: address as Address });
        console.log("[OGX Base Hub] balance response ->", balanceResult);

        const formattedBalance = Number(formatEther(balanceResult)).toFixed(4);
        const hasNativeBalance = Number(formattedBalance) > 0;
        setNativeBalance(`${formattedBalance} ETH`);

        const assetsList = hasNativeBalance
          ? [
              {
                contractAddress: "native",
                name: "Ether",
                symbol: "ETH",
                balance: formattedBalance,
                usdValue: "$0.00",
              } satisfies TokenItem,
            ]
          : [];

        setTokens(assetsList);

        const gasPriceValue = await publicClient.getGasPrice();
        setGasPrice(`${Number(formatUnits(gasPriceValue, 9)).toFixed(2)} gwei`);
        setWalletAge("N/A");
        setTxCount("0");
        setInteractionCount("0");
        setNfts([]);
        setTransactions([]);
      } catch (error) {
        console.error("[OGX Base Hub] balance loading error ->", error);
        setTokens([]);
        setNfts([]);
        setTransactions([]);
        setNativeBalance("0.0000 ETH");
        setTokensError("Unable to load wallet assets.");
        setNftsError(null);
        setTransactionsError(null);
        setAnalyticsError(null);
        setGasError(null);
      } finally {
        setTokensLoading(false);
        setNftsLoading(false);
        setTransactionsLoading(false);
        setBalanceLoading(false);
      }
    };

    loadData();
    return () => controller.abort();
  }, [address, chainId, isConnected, isMounted, publicClient]);

  const isOnBase = chainId === base.id;

  const walletAddressLabel = !isMounted
    ? "Loading wallet..."
    : isConnected && address
      ? formatAddress(address)
      : "No wallet";

  const networkLabel = !isMounted
    ? "Loading network..."
    : isOnBase
      ? "Base Mainnet"
      : chainId
        ? `Chain ${chainId}`
        : "Not connected";

  const walletHeadline = !isMounted
    ? "Preparing wallet view"
    : isConnected
      ? "Wallet connected"
      : "Connect your wallet";

  const walletStatusLabel = !isMounted
    ? "Loading..."
    : isConnected
      ? "Connected"
      : "Disconnected";

  const balanceLabel = !isMounted
    ? "Loading..."
    : balanceLoading
      ? "Loading..."
      : nativeBalance;

  const showTokensEmptyState = !tokensLoading && !tokensError && Boolean(address) && tokens.length === 0;
  const showNftsEmptyState = !nftsLoading && !nftsError && Boolean(address) && nfts.length === 0;
  const showTransactionsEmptyState = !transactionsLoading && !transactionsError && Boolean(address) && transactions.length === 0;

  const renderContent = () => {
    if (!shouldRenderWalletContent) {
      return (
        <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Loading</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Preparing your dashboard</h3>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-14" />
            ))}
          </div>
        </section>
      );
    }

    switch (currentView) {
      case "portfolio":
        return (
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Portfolio</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">ERC-20 balances on Base</h3>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {tokensLoading ? (
                  Array.from({ length: 3 }).map((_, index) => <SkeletonBlock key={index} className="h-18" />)
                ) : tokens.length > 0 ? (
                  tokens.map((token) => (
                    <div key={token.contractAddress} className="flex items-center justify-between rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 text-sm font-semibold text-cyan-200">
                          {token.logoUrl ? <img src={token.logoUrl} alt={token.symbol} className="h-8 w-8 rounded-full" /> : token.symbol.slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{token.symbol}</p>
                          <p className="text-xs text-slate-400">{token.name}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-white">{token.balance}</p>
                        <p className="text-xs text-slate-400">{token.usdValue}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No portfolio data available for this wallet yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Wallet Snapshot</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Live account details</h3>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet Address</p>
                  <p className="mt-2 font-mono text-sm text-white">{walletAddressLabel}</p>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Current Network</p>
                  <p className="mt-2 text-lg font-semibold text-white">{networkLabel}</p>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">ETH Balance</p>
                  <p className="mt-2 text-lg font-semibold text-white">{balanceLabel}</p>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet Status</p>
                  <p className={`mt-2 text-lg font-semibold ${isConnected ? "text-emerald-300" : "text-slate-200"}`}>{walletStatusLabel}</p>
                </div>
              </div>
            </div>
          </section>
        );
      case "nfts":
        return (
          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">NFTs</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Owned on Base</h3>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {nftsLoading ? (
                Array.from({ length: 3 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)
              ) : nfts.length > 0 ? (
                nfts.map((item) => (
                  <div key={`${item.collectionName}-${item.tokenId}`} className="rounded-[1.25rem] border border-white/10 bg-gradient-to-br from-cyan-500/10 to-white/5 p-4">
                    <div className="flex h-24 items-center justify-center rounded-[1rem] bg-gradient-to-br from-cyan-500/20 to-slate-800">
                      {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full rounded-[1rem] object-cover" /> : <span className="text-lg text-cyan-200">NFT</span>}
                    </div>
                    <p className="mt-4 text-sm font-semibold text-white">{item.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{item.collectionName}</p>
                    <p className="mt-1 text-xs text-cyan-200">Qty {item.quantity}</p>
                  </div>
                ))
              ) : (
                <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400 md:col-span-3">No NFTs found for this wallet yet.</p>
              )}
            </div>
          </section>
        );
      case "transactions":
        return (
          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Transactions</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Latest 10 transactions</h3>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {transactionsLoading ? (
                Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-14" />)
              ) : transactions.length > 0 ? (
                transactions.map((tx) => (
                  <div key={tx.hash} className="flex flex-col gap-2 rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-mono text-sm text-white">{tx.hash.slice(0, 16)}...</p>
                      <p className="text-sm text-slate-400">{tx.timestamp}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-cyan-200">{tx.amount}</span>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tx.status === "Success" ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>
                        {tx.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No transactions found for this wallet yet.</p>
              )}
            </div>
          </section>
        );
      case "quests":
        return (
          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Quests</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Earn reward points</h3>
              </div>
              <div className="rounded-[1rem] border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100">
                250 pts
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {questItems.map((quest) => (
                <div key={quest.title} className="flex items-center justify-between rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{quest.title}</p>
                    <p className="mt-1 text-sm text-slate-400">{quest.points} pts</p>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-semibold ${quest.done ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>
                    {quest.done ? "Done" : "Pending"}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      case "airdrop":
        return (
          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Airdrop Checker</p>
                <h3 className="mt-2 text-xl font-semibold text-white">Eligibility snapshot</h3>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>Wallet age</span>
                  <span className="font-semibold text-white">{walletAge}</span>
                </div>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>Total Base transactions</span>
                  <span className="font-semibold text-white">{txCount}</span>
                </div>
              </div>
              <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between text-sm text-slate-300">
                  <span>Smart contract interactions</span>
                  <span className="font-semibold text-white">{interactionCount}</span>
                </div>
              </div>
              <div className="rounded-[1.25rem] border border-cyan-400/20 bg-cyan-500/10 p-4">
                <div className="flex items-center justify-between text-sm text-cyan-100">
                  <span>Gas price</span>
                  <span className="font-semibold">{gasPrice}</span>
                </div>
              </div>
            </div>
            {(!gasPrice || gasPrice === "Loading...") && !isConnected ? (
              <p className="mt-3 text-sm text-slate-400">Analytics will appear once a wallet is connected.</p>
            ) : null}
          </section>
        );
      case "settings":
        return (
          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Settings</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Dashboard preferences</h3>
            </div>
            <div className="mt-5 rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              Base network, RPC, and explorer settings are ready. Add your preferred explorer API key in the environment file to enrich on-chain results.
            </div>
          </section>
        );
      default:
        return (
          <>
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Portfolio</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">ERC-20 balances on Base</h3>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {tokensLoading ? (
                    Array.from({ length: 3 }).map((_, index) => <SkeletonBlock key={index} className="h-18" />)
                  ) : tokens.length > 0 ? (
                    tokens.map((token) => (
                      <div key={token.contractAddress} className="flex items-center justify-between rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10 text-sm font-semibold text-cyan-200">
                            {token.logoUrl ? <img src={token.logoUrl} alt={token.symbol} className="h-8 w-8 rounded-full" /> : token.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">{token.symbol}</p>
                            <p className="text-xs text-slate-400">{token.name}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-white">{token.balance}</p>
                          <p className="text-xs text-slate-400">{token.usdValue}</p>
                        </div>
                      </div>
                    ))
                  ) : showTokensEmptyState ? (
                    <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No portfolio data available for this wallet yet.</p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Wallet Snapshot</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">Live account details</h3>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet Address</p>
                    <p className="mt-2 font-mono text-sm text-white">{walletAddressLabel}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Current Network</p>
                    <p className="mt-2 text-lg font-semibold text-white">{networkLabel}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">ETH Balance</p>
                    <p className="mt-2 text-lg font-semibold text-white">{balanceLabel}</p>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Wallet Status</p>
                    <p className={`mt-2 text-lg font-semibold ${isConnected ? "text-emerald-300" : "text-slate-200"}`}>{walletStatusLabel}</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">NFTs</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Owned on Base</h3>
                </div>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {nftsLoading ? (
                  Array.from({ length: 3 }).map((_, index) => <SkeletonBlock key={index} className="h-40" />)
                ) : nfts.length > 0 ? (
                  nfts.map((item) => (
                    <div key={`${item.collectionName}-${item.tokenId}`} className="rounded-[1.25rem] border border-white/10 bg-gradient-to-br from-cyan-500/10 to-white/5 p-4">
                      <div className="flex h-24 items-center justify-center rounded-[1rem] bg-gradient-to-br from-cyan-500/20 to-slate-800">
                        {item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full rounded-[1rem] object-cover" /> : <span className="text-lg text-cyan-200">NFT</span>}
                      </div>
                      <p className="mt-4 text-sm font-semibold text-white">{item.name}</p>
                      <p className="mt-1 text-sm text-slate-400">{item.collectionName}</p>
                      <p className="mt-1 text-xs text-cyan-200">Qty {item.quantity}</p>
                    </div>
                  ))
                ) : showNftsEmptyState ? (
                  <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400 md:col-span-3">No NFTs found for this wallet yet.</p>
                ) : null}
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Quests</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">Earn reward points</h3>
                  </div>
                  <div className="rounded-[1rem] border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-100">
                    250 pts
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {questItems.map((quest) => (
                    <div key={quest.title} className="flex items-center justify-between rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{quest.title}</p>
                        <p className="mt-1 text-sm text-slate-400">{quest.points} pts</p>
                      </div>
                      <div className={`rounded-full px-3 py-1 text-xs font-semibold ${quest.done ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>
                        {quest.done ? "Done" : "Pending"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Airdrop Checker</p>
                    <h3 className="mt-2 text-xl font-semibold text-white">Eligibility snapshot</h3>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Wallet age</span>
                      <span className="font-semibold text-white">{walletAge}</span>
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Total Base transactions</span>
                      <span className="font-semibold text-white">{txCount}</span>
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-sm text-slate-300">
                      <span>Smart contract interactions</span>
                      <span className="font-semibold text-white">{interactionCount}</span>
                    </div>
                  </div>
                  <div className="rounded-[1.25rem] border border-cyan-400/20 bg-cyan-500/10 p-4">
                    <div className="flex items-center justify-between text-sm text-cyan-100">
                      <span>Gas price</span>
                      <span className="font-semibold">{gasPrice}</span>
                    </div>
                  </div>
                </div>
                {(!gasPrice || gasPrice === "Loading...") && !isConnected ? (
                  <p className="mt-3 text-sm text-slate-400">Analytics will appear once a wallet is connected.</p>
                ) : null}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">Transactions</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Latest 10 transactions</h3>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {transactionsLoading ? (
                  Array.from({ length: 4 }).map((_, index) => <SkeletonBlock key={index} className="h-14" />)
                ) : transactions.length > 0 ? (
                  transactions.map((tx) => (
                    <div key={tx.hash} className="flex flex-col gap-2 rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-mono text-sm text-white">{tx.hash.slice(0, 16)}...</p>
                        <p className="text-sm text-slate-400">{tx.timestamp}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-cyan-200">{tx.amount}</span>
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tx.status === "Success" ? "bg-emerald-500/15 text-emerald-300" : "bg-cyan-500/15 text-cyan-200"}`}>
                          {tx.status}
                        </span>
                      </div>
                    </div>
                  ))
                ) : showTransactionsEmptyState ? (
                  <p className="rounded-[1.25rem] border border-white/10 bg-white/5 p-4 text-sm text-slate-400">No transactions found for this wallet yet.</p>
                ) : null}
              </div>
            </section>
          </>
        );
    }
  };

  const handleConnect = () => {
    setConnectError(null);

    if (!metaMaskConnector) {
      setConnectError("MetaMask connector is not available in this browser.");
      return;
    }

    connect({ connector: metaMaskConnector, chainId: base.id });
  };

  const handleSwitchToBase = () => {
    switchChain({ chainId: base.id });
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#0f172a_60%,_#111827_100%)] px-3 py-4 sm:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 backdrop-blur-xl lg:w-72 lg:p-5">
          <div className="flex items-center gap-3 rounded-[1.25rem] border border-cyan-400/20 bg-cyan-500/10 px-3 py-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-cyan-500/20 text-xl text-cyan-300">
              ○
            </div>
            <div>
              <p className="text-sm font-semibold text-white">OGX Base Hub</p>
              <p className="text-xs text-cyan-200">Web3 dashboard</p>
            </div>
          </div>

          <nav className="mt-6 space-y-2">
            {navigationItems.map((item) => {
              const isActive = currentView === item.view;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-sm font-medium transition ${
                    isActive
                      ? "bg-cyan-500/15 text-cyan-200 shadow-inner shadow-cyan-500/10"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 space-y-4">
          <header className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-[0_25px_80px_-35px_rgba(34,211,238,0.6)] backdrop-blur-xl sm:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.35em] text-cyan-300">
                  Connected to Base
                </p>
                <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">
                  Welcome back to OGX Base Hub
                </h1>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-[1rem] border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
                  {walletAddressLabel}
                </div>
                <div className="rounded-[1rem] border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                  {networkLabel === "Not connected" ? "Switch network" : networkLabel}
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-[1rem] border border-white/10 bg-white/5 text-lg text-slate-200">
                  🔔
                </div>
              </div>
            </div>
          </header>

          <section className="rounded-[2rem] border border-white/10 bg-slate-900/70 p-4 shadow-2xl shadow-slate-950/40 backdrop-blur-xl sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-[0.3em] text-slate-400">
                  Wallet control
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  {walletHeadline}
                </h2>
              </div>

              <button
                type="button"
                onClick={isConnected ? () => disconnect() : handleConnect}
                className="rounded-full bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-80"
                disabled={isPending}
              >
                {isPending
                  ? "Connecting..."
                  : !isMounted
                    ? "Loading..."
                    : isConnected
                      ? "Disconnect"
                      : "Connect MetaMask"}
              </button>
            </div>

            {(error || connectError || switchError) ? (
              <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {connectError ?? switchError?.message ?? error?.message}
              </p>
            ) : null}
          </section>

          {renderContent()}
        </main>
      </div>
    </div>
  );
}
