# Mac beta distribution and signing

Pawprint currently ships an **ad-hoc signed, unnotarized** Apple silicon beta. This is not an Apple identity certificate. It seals the app bundle so macOS no longer reports that the bundle's resources are damaged, but Gatekeeper still cannot verify its developer.

For a browser download, check the zip against the release's SHA-256 file. Move `Pawprint.app` to Applications and try opening it once. If macOS says it cannot verify the developer, choose **Done**, then use **System Settings → Privacy & Security → Open Anyway** for Pawprint and confirm. A right-click → Open may also expose the per-app choice. Do not turn Gatekeeper off globally. If macOS says **damaged**, stop: the release is invalid and should be reported.

This behavior was tested on a quarantined temporary copy on macOS 26.6.2: `codesign --verify --deep --strict` passed, the system showed the “Apple cannot verify” alert, and Privacy & Security exposed “Open Anyway.” We did not approve the test copy. Other macOS versions or security policies may behave differently.

The tag workflow refuses to publish if the full bundle signature does not verify. The older unsigned builds were moved to draft because Gatekeeper rejected them as damaged.

A future frictionless release requires a personal Apple Developer Program membership, a **Developer ID Application** certificate, and notarization. Configure these GitHub Actions secrets on `huangbinjie/pawprint` when available: `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_API_KEY_P8_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_TEAM_ID`. The workflow then uses Developer ID signing and validates Apple's notarization ticket. Keep private keys and passwords out of the repository and chat.
