# Public release of n8n-nodes-waapi

Version 0.1.3 is published on [npm](https://www.npmjs.com/package/n8n-nodes-waapi/v/0.1.3), with npm provenance, and passed n8n's published-package security scanner. It adds AI Agent tool support. A real n8n 2.43.7 rehearsal passed contact upsert, a simulated WhatsApp reply, and an AI Agent calling WAAPI Tool to find the fictional customer.

The initial 0.1.2 submission on 17 October 2026 passed automated review. Ownership was verified using info@digital-shift.us, and the Creator Portal displays the official WAAPI logo. A continuous 3 minute 12 second demo of version 0.1.3 was uploaded and submitted on 17 October; the portal now shows **Manual Review: Under Review**. The video demonstrates npm installation, a new workflow, the masked demo credential and a successful connection test, contact upsert, a simulated WhatsApp reply, and a real AI Agent calling WAAPI Tool.

The portal still tracks the locked 0.1.2 submission and rejects resubmission with "Package is already submitted for verification". A request was sent from info@digital-shift.us to nodes@n8n.io on 17 October asking the node-review team to retarget it to published version 0.1.3. That version update and n8n approval remain pending. Verified node-picker discovery and n8n Cloud availability begin only after approval.

## Public source repository

The public source repository is [alsaifiltd/n8n-nodes-waapi](https://github.com/alsaifiltd/n8n-nodes-waapi). The WAAPI platform repository is private. Publish only the standalone community-node source, never the platform repository.

From the WAAPI repository, run:

```sh
node scripts/generate-n8n-catalog.mjs --check
node scripts/export-n8n-package.mjs
```

The export is `out/n8n-nodes-waapi-source.tar.gz`. The export script uses an explicit file allowlist and rejects environment files, credential-shaped values, private keys, and symbolic links. It includes the node code, generated catalog, tests, example workflows, license, build configuration, and the manual publishing workflow. It excludes platform source, local credentials, dependency installations, and Git history.

Extract that archive and synchronize those files to the public repository's `main` branch. Keep the author and repository metadata consistent with the publishing npm account. If the repository name changes, update package.json, package-lock.json, and this guide before release.

## Validate the source

Use Node.js 24:

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run lint
npm run typecheck
npm test
npm pack --ignore-scripts
```

Use the official n8n CLI's `npm run dev` to inspect the fields and execute sandbox workflows. Confirm the account dropdown, dynamic template values, binary file input/output, workflow activation, test webhook cleanup, and reactivation. Test only synthetic records with sandbox credentials until live provider testing is explicitly arranged.

## Publish from GitHub Actions

[Current n8n verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/) require GitHub Actions publishing with npm provenance. A local `npm publish` is not the release path.

1. Use the public GitHub repository above and a GitHub environment named `npm`, with any desired approval protection.
2. For the first publication, provision a short-lived npm granular publish token and store it as the repository/environment secret `NPM_TOKEN`. A new unscoped package requires permission to create packages; npm cannot restrict the token to a package that does not exist yet. Use no organization permissions, the shortest practical expiry, and the permissions required by the account's 2FA settings. Never place the token in the source, workflow YAML, or chat. Revoke the bootstrap token after the first release and trusted-publisher setup.
3. Open **Actions → Publish WAAPI community node → Run workflow** on `main`, entering `0.1.3`. The workflow checks that the requested version matches package.json, installs dependencies with installation scripts disabled, lints, typechecks, builds, tests, uploads the npm tarball, and publishes with `--provenance --access public`.
4. Once the package exists, configure npm Trusted Publishing for owner `alsaifiltd`, repository `n8n-nodes-waapi`, workflow filename `publish.yml`, environment `npm`. With supported npm/GitHub OIDC, this removes the need for a long-lived `NPM_TOKEN`; remove the token secret after verifying trusted publishing.
5. Verify the npm page shows the public repository, expected maintainer, MIT license, correct README, files, and provenance. Install the exact published version in a separate self-hosted n8n test instance.

Both the standalone publish workflow and the private repository's validation workflow are **workflow_dispatch only**. They do not enable automatic CI, tag-based releases, platform deployment, or publication on push.

## n8n verification

After npm publication:

1. Run `npx @n8n/scan-community-package n8n-nodes-waapi` against the published package and resolve findings.
2. Confirm the public repository is accessible and matches the npm provenance and metadata.
3. Confirm sandbox workflows cover incoming messages, status events, contact lookup/upsert, approved templates, draft/launch gates, and binary files.
4. Submit `n8n-nodes-waapi` in the [n8n Creator Portal](https://creators.n8n.io/nodes).
5. Record an uncut video of at most five minutes showing installation of the submitted npm version, credential creation and a successful test, common actions, and an AI Agent using the node as a tool. Keep credentials masked and use fictional sandbox records. Upload the video or its accessible URL in the Creator Portal and submit for manual review.
6. Keep all public availability copy honest. Self-hosted community installation begins after npm publication. Verified discovery and n8n Cloud installation begin only after n8n approves the package.

For later releases, update package.json, package-lock.json, CHANGELOG.md, and the README status, repeat validation, push the public source, and dispatch the same manual workflow with the new version.
