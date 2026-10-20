import { randomBytes } from "node:crypto";

// These addresses belong to services inside each attempt's machine.
export function icuEnvironment(
  mapped: Record<string, string>,
): Record<string, string> {
  return {
    ...mapped,
    DATABASE_URL: "postgres://root:mysecretpassword@127.0.0.1:5435/local",
    TEST_DATABASE_URL:
      "postgres://root:mysecretpassword@127.0.0.1:5435/icu_test",
    OAUTH_TOKEN_TEST_DATABASE_URL:
      "postgres://root:mysecretpassword@127.0.0.1:5435/icu_test",
    ORIGIN: "http://localhost:5173",
    BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "test",
    AWS_SECRET_ACCESS_KEY: "test",
    AWS_SESSION_TOKEN: "",
    AWS_ENDPOINT_URL: "http://127.0.0.1:4566",
    AWS_ENDPOINT_URL_S3: "http://127.0.0.1:4566",
    ICU_CHAT_ATTACHMENTS_BUCKET: "icu-chat-attachments-local",
  };
}

export const containerDefaults = {
  ip: "127.0.0.1",
  "default-network-opts": {
    bridge: {
      "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1",
    },
  },
};
