import { createRequire } from "node:module";
const require = createRequire(import.meta.url),
  { sign } = require("@electron/osx-sign");
export default async function signMac(options) {
  const identity = process.env.CALLWISE_SIGN_IDENTITY || "-";
  if (process.env.CALLWISE_RELEASE === "1" && identity === "-")
    throw new Error(
      "Release builds require the persistent signing certificate. Configure CALLWISE_SIGNING_P12 and CALLWISE_SIGNING_PASSWORD in Actions secrets.",
    );
  await sign({
    ...options,
    identity,
    identityValidation: false,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: () => ({
      entitlements: "build/entitlements.mac.plist",
      hardenedRuntime: true,
    }),
    ...(process.env.CALLWISE_SIGN_KEYCHAIN
      ? { keychain: process.env.CALLWISE_SIGN_KEYCHAIN }
      : {}),
  });
  console.log(
    identity === "-"
      ? "Development signature only; this build is not a stable-identity release."
      : "Signed with the persistent Callwise identity.",
  );
}
