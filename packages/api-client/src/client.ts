import createClient from "openapi-fetch";
import type { paths } from "./generated/schema";

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
}

export function createApiClient({ baseUrl, getAccessToken }: ApiClientOptions) {
  const client = createClient<paths>({ baseUrl, credentials: "include" });

  client.use({
    onRequest({ request }) {
      const token = getAccessToken?.();
      if (token) {
        request.headers.set("Authorization", `Bearer ${token}`);
      }
      return request;
    },
  });

  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;
