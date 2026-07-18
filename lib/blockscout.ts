const BLOCKSCOUT_URL =
  process.env.NEXT_PUBLIC_BLOCKSCOUT_API_URL ??
  "https://base.blockscout.com/api/v2";

function getHeaders() {
  const apiKey = process.env.NEXT_PUBLIC_BLOCKSCOUT_API_KEY;

  return {
    Accept: "application/json",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

async function request<T>(url: string): Promise<T | null> {
  try {
    console.log("[Blockscout] Request:", url);

    const response = await fetch(url, {
      headers: getHeaders(),
      cache: "no-store",
    });

    console.log("[Blockscout] Status:", response.status);

    if (!response.ok) {
      console.error(
        "[Blockscout] Error:",
        response.status,
        await response.text()
      );
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error("[Blockscout] Request failed:", error);
    return null;
  }
}

export type ExplorerTransaction = {
  hash: string;
  timestamp?: string;
  status?: string;
  value?: string;
};

export type ExplorerToken = {
  token?: {
    address?: string;
    name?: string;
    symbol?: string;
    decimals?: number;
  };
  value?: string;
};

export type ExplorerNFT = {
  token_id?: string;
  metadata?: unknown;
  token?: {
    name?: string;
  };
};

export async function getTokenBalances(address: string) {
  return request<{
    items?: ExplorerToken[];
  }>(
    ${BLOCKSCOUT_URL}/addresses/${address}/token-balances
  );
}

export async function getTransactions(address: string) {
  return request<{
    items?: ExplorerTransaction[];
  }>(
    ${BLOCKSCOUT_URL}/addresses/${address}/transactions
  );
}

export async function getNFTs(address: string) {
  return request<{
    items?: ExplorerNFT[];
  }>(
    ${BLOCKSCOUT_URL}/addresses/${address}/nft
  );
}

export async function getCounters(address: string) {
  return request<{
    transactions_count?: string;
  }>(
    ${BLOCKSCOUT_URL}/addresses/${address}/counters
  );
}