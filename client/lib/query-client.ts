import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Gets the base URL for the Express API server (e.g., "http://localhost:3000")
 * @returns {string} The API base URL
 */
export function getApiUrl(): string {
  let host = process.env.EXPO_PUBLIC_DOMAIN;

  // On web, always prefer the current page hostname for the API server.
  // This avoids stale build-time EXPO_PUBLIC_DOMAIN values (e.g. localhost or an old LAN IP)
  // causing the app to call the wrong API and appear "disconnected" even when the server has tokens.
  if (typeof window !== "undefined" && window.location?.hostname) {
    const currentHost = window.location.hostname; // e.g. "192.168.0.21"
    const inferred = `${currentHost}:3000`;
    const hostNameOnly = typeof host === "string" && host.includes(":") ? host.split(":")[0] : host;
    const looksWrong =
      !host ||
      host.includes("localhost") ||
      host.includes("127.0.0.1") ||
      (typeof hostNameOnly === "string" && hostNameOnly && hostNameOnly !== currentHost);
    if (looksWrong) {
      host = inferred;
    }
  }

  // Provide fallback values to prevent crashes
  if (!host) {
    // Try to detect the API server from current location
    if (typeof window !== 'undefined' && window.location) {
      const currentHost = window.location.host; // e.g., "192.168.0.21:8081"
      const parts = currentHost.split(':');
      if (parts.length >= 1) {
        // Replace port 8081 with 3000 for API server
        const ip = parts[0];
        host = `${ip}:3000`;
        console.warn(`⚠️  EXPO_PUBLIC_DOMAIN not set, using fallback: ${host}`);
        console.warn(`💡 To fix this permanently, add EXPO_PUBLIC_DOMAIN=${host} to your .env file`);
      } else {
        host = 'localhost:3000';
        console.warn(`⚠️  EXPO_PUBLIC_DOMAIN not set, using default fallback: ${host}`);
      }
    } else {
      host = 'localhost:3000';
      console.warn(`⚠️  EXPO_PUBLIC_DOMAIN not set and no window available, using default: ${host}`);
    }
  }

  // For local IPs, always use http. For remote hosts, use same protocol as current window (for web) or http for native
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || /^\d+\.\d+\.\d+\.\d+/.test(host.split(':')[0]);
  const protocol = isLocalhost ? 'http:' : (typeof window !== 'undefined' ? window.location.protocol : 'http:');
  let url = new URL(`${protocol}//${host}`);

  return url.href.replace(/\/$/, "");
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const res = await fetch(url, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
