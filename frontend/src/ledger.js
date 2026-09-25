import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from "@ledgerhq/device-management-kit";

import {
  webHidTransportFactory,
} from "@ledgerhq/device-transport-kit-web-hid";

import {
  DefaultDescriptorTemplate,
  DefaultWallet,
  SignerBtcBuilder,
} from "@ledgerhq/device-signer-kit-bitcoin";

import { Buffer } from "buffer";

const DERIVATION_PATH = "86'/1'/0'";

let dmk = null;
let discoverySubscription = null;
let sessionId = null;
let signer = null;

export function getDmk() {
  if (!dmk) {
    dmk = new DeviceManagementKitBuilder()
      .addTransport(webHidTransportFactory)
      .build();
  }

  return dmk;
}

export function connectLedger(onStatus) {
  return new Promise((resolve, reject) => {
    try {
      const sdk = getDmk();

      discoverySubscription?.unsubscribe();

      onStatus?.(
        "Opening Ledger device picker..."
      );

      discoverySubscription =
        sdk
          .startDiscovering({})
          .subscribe({
            next: async (device) => {
              discoverySubscription?.unsubscribe();
              discoverySubscription = null;

              try {
                onStatus?.(
                  "Ledger detected. Connecting..."
                );

                const connectedSessionId =
                  await sdk.connect({
                    device,
                  });

                sessionId =
                  connectedSessionId;

                const connectedDevice =
                  sdk.getConnectedDevice({
                    sessionId,
                  });

                signer =
                  new SignerBtcBuilder({
                    dmk: sdk,
                    sessionId,
                  }).build();

                onStatus?.(
                  "Ledger connected."
                );

                resolve({
                  sessionId,
                  connectedDevice,
                });
              } catch (error) {
                reject(error);
              }
            },

            error: (error) => {
              discoverySubscription = null;
              reject(error);
            },
          });
    } catch (error) {
      reject(error);
    }
  });
}

export function signCoinLensPsbt(
  psbtBase64,
  onStatus
) {
  if (!signer || !sessionId) {
    return Promise.reject(
      new Error(
        "Connect a Ledger device first."
      )
    );
  }

  if (
    !psbtBase64 ||
    typeof psbtBase64 !== "string"
  ) {
    return Promise.reject(
      new Error("Invalid PSBT.")
    );
  }

  const wallet = new DefaultWallet(
    DERIVATION_PATH,
    DefaultDescriptorTemplate.TAPROOT
  );

  onStatus?.(
    "Preparing transaction for Ledger..."
  );

  const {
    observable,
    cancel,
  } = signer.signPsbt(
    wallet,
    psbtBase64
  );

  return new Promise(
    (resolve, reject) => {
      let finished = false;

      const subscription =
        observable.subscribe({
          next: (state) => {
            if (
              state.status ===
              DeviceActionStatus.Pending
            ) {
              const step =
                state.intermediateValue
                  ?.step;

              const interaction =
                state.intermediateValue
                  ?.requiredUserInteraction;

              switch (step) {
                case "signer.btc.steps.openApp":
                  onStatus?.(
                    "Opening the Bitcoin app on Ledger..."
                  );
                  break;

                case "signer.btc.steps.prepareWalletPolicy":
                  onStatus?.(
                    "Preparing the CoinLens wallet policy..."
                  );
                  break;

                case "signer.btc.steps.buildPsbt":
                  onStatus?.(
                    "Preparing transaction..."
                  );
                  break;

                case "signer.btc.steps.signPsbt":
                  onStatus?.(
                    "Review and approve the transaction on your Ledger."
                  );
                  break;

                default:
                  onStatus?.(
                    interaction ||
                      "Waiting for Ledger..."
                  );
              }
            }

            if (
              state.status ===
              DeviceActionStatus.Completed
            ) {
              if (finished) return;

              finished = true;
              subscription.unsubscribe();

              onStatus?.(
                "Ledger returned the transaction signatures."
              );

              resolve(state.output);
              return;
            }

            if (
              state.status ===
              DeviceActionStatus.Error
            ) {
              if (finished) return;

              finished = true;
              subscription.unsubscribe();

              reject(state.error);
              return;
            }

            if (
              state.status ===
              DeviceActionStatus.Stopped
            ) {
              if (finished) return;

              finished = true;
              subscription.unsubscribe();

              reject(
                new Error(
                  "Ledger signing was cancelled."
                )
              );
            }
          },

          error: (error) => {
            if (finished) return;

            finished = true;
            reject(error);
          },
        });

      void cancel;
    }
  );
}

/*
 * Converts Ledger's returned signatures into the
 * original CoinLens PSBT.
 *
 * bitcoinjs-lib is loaded lazily here so that the
 * browser Buffer polyfill is installed first.
 */
export async function applyLedgerSignatures(
  psbtBase64,
  signatures
) {
  if (
    !Array.isArray(signatures) ||
    signatures.length === 0
  ) {
    throw new Error(
      "Ledger returned no signatures."
    );
  }

  /*
   * Make Buffer available globally before
   * bitcoinjs-lib is evaluated in the browser.
   */


  const {
    Psbt,
  } = await import(
    "bitcoinjs-lib"
  );

  const psbt =
    Psbt.fromBase64(
      psbtBase64
    );

  let appliedCount = 0;

  for (const signature of signatures) {
    if (
      typeof signature?.inputIndex !==
        "number" ||
      !signature?.signature
    ) {
      continue;
    }

    /*
     * CoinLens constructs Taproot key-path
     * transactions.
     */
    if (
      signature.tapleafHash == null
    ) {
      psbt.updateInput(
        signature.inputIndex,
        {
          tapKeySig:
            Buffer.from(
              signature.signature
            ),
        }
      );

      appliedCount += 1;
    }
  }

  if (appliedCount === 0) {
    throw new Error(
      "Ledger signatures could not be applied to the CoinLens PSBT."
    );
  }

  return psbt.toBase64();
}

export function isLedgerConnected() {
  return Boolean(
    sessionId && signer
  );
}

export async function disconnectLedger() {
  discoverySubscription?.unsubscribe();
  discoverySubscription = null;

  if (dmk && sessionId) {
    try {
      await dmk.disconnect({
        sessionId,
      });
    } catch {
      // Cleanup only.
    }
  }

  sessionId = null;
  signer = null;
}

export function getLedgerSessionId() {
  return sessionId;
}