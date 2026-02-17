import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { requirePlaidEnv } from "./env";

export function getPlaidClient(): PlaidApi {
  const env = requirePlaidEnv();

  const configuration = new Configuration({
    basePath: PlaidEnvironments[env.PLAID_ENV],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": env.PLAID_CLIENT_ID,
        "PLAID-SECRET": env.PLAID_SECRET,
      },
    },
  });

  return new PlaidApi(configuration);
}
