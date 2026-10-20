# loRan Shopper — native mobile app, API and admin operations portal

The customer and shopper application is built with Expo / React Native / Expo Router for Android and iPhone. It is not a website wrapped in a mobile browser. A separate React/Vite operations portal is for administrators only, with no admin link in the mobile homepage. An Express/TypeScript API manages MongoDB, email and Paystack.

## What is implemented

**Customers:** descriptive home, four scrolling illustrative market scenes, available approved shopper directory, profile images/covered markets/shopping fees, selected-market shopping list with quantities and optional estimated unit prices, name/email/WhatsApp/address, private order tracking ID, persistent recent IDs, quote item pricing/transport/shopping total, accept/reject with reason, Paystack checkout in a secure browser, server payment checks, timeline, delivery confirmation, and a complaint ticket form with a visible 24-hour deadline. Customer email was added because the requested quote notifications need an email address.

**Shoppers:** registration with all requested fields, the 36 states plus optional FCT, identity and profile uploads, optional business and transport details, password login/recovery, pending approval status, availability toggle, assigned orders with customer details/WhatsApp contact, quote/requote/cancel, controlled paid→shopping→delivered progression, aggregate earnings and settlement status, bank/account-name lookup through Paystack, email-code-protected fee/photo/bank settings, announcements and logout.

**Admins:** separate sign-in, application review with private identification download, approve/reject/suspend, all orders with assigned shopper names, payments, complaints/customer contact details/resolution, flat platform fee, announcements, super-admin-only creation of additional admins, verified bank details and manual settlement recording with transfer reference. Changes and private document access are audited.

## Important implementation choices

- All money sent to the API is **integer kobo**. The mobile app/portal display naira and convert input. Customer estimates are not the payable amount; only a shopper quote sets that amount.
- Platform fee is a **flat fee per quote, deducted from the shopper settlement**. It is visible to shoppers/admins, excluded from public/customer responses, and snapshotted so later fee changes do not alter accepted quotes. Customers see item costs + transport + shopping fee, with a complete total.
- The private order ID has 128 bits of randomness. It is emailed and stored locally for recent-order access. Possession of the ID unlocks that order without a customer account; treat it as a private access code. There is no public order list or short sequential ID.
- The API, not the app, initializes and verifies payments. Success requires matching reference, amount, currency and customer email. Webhook signatures are validated over the raw request body. Repeat verification does not duplicate the paid timeline entry.
- Identity documents are AES-256-GCM encrypted in MongoDB and restricted to authenticated admins. Images/documents are limited to 5 MB. Unclaimed uploads expire after 24 hours; claimed files remain. Public profile photos require a claimed photo asset and never expose identity files.
- Settings email codes expire after 10 minutes, allow five attempts, apply only the proposed server-side changes, and cannot be replayed. Password reset revokes existing sessions. Suspension also revokes sessions and removes availability.
- Complaints are accepted within 24 hours after the **shopper marks delivered**, and the exact deadline appears to the customer. The customer can confirm receipt separately.
- Final settlement recording is blocked before that 24-hour window ends and while a complaint is open. `Shopper paid in full` records a bank transfer you have **already made**, with an exact amount and a unique reference. It does not initiate a Paystack transfer. A quote’s shopper settlement is item costs + transport + shopping fee − platform fee, not just shopper profit.
- Shoppers need working funds to purchase under this settlement model. Up-front advances/staged settlements are not implemented. Establish that operating arrangement before onboarding shoppers.
- Email is sent from a durable MongoDB outbox. The running API processes it every 30 seconds, retries failures up to five attempts, and uses leases so multiple instances do not intentionally send the same message concurrently. SMTP must be configured. Suspension does not erase ongoing customer orders; operations staff can still review them.

## Project layout

| Directory | Purpose                                                              |
| --------- | -------------------------------------------------------------------- |
| `mobile`  | Expo native customer/shopper app                                     |
| `api`     | Express API, MongoDB models, payment/email services and admin script |
| `admin`   | Separate browser operations portal                                   |

The folders have their own package.json and lockfiles. Mobile routes are in `mobile/src/app/`; `src/AppState.tsx` holds the shared form/order draft state so it survives native navigation, and `src/ui.tsx` holds the visual components. Extract the ZIP into a new `loran-shopper` project folder. Do not put it inside SJACM/BSRverifier.

## 1. Install prerequisites

Use Node.js 22 or 24 LTS, Git, VS Code, and a phone with Expo Go compatible with the project’s Expo SDK. Android is a practical first testing target. iPhone can use a compatible Expo Go/development build; native iOS builds require Apple’s signing setup.

The supplied mobile scaffold uses the Expo SDK selected by the current create-expo-app template and SDK-compatible native modules. See `mobile/package.json` for exact versions; use `npm.cmd ci` to preserve them.

Use `npm.cmd` and `npx.cmd` in PowerShell to avoid the npm.ps1 execution-policy issue you encountered previously.

## 2. Start the API locally

Open a terminal in `loran-shopper/api`:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Edit `api/.env` with your actual Atlas URI, using a separate database such as `loran_shopper`. You can reuse your Atlas cluster; the app uses `loran_*` collection names.

Generate two separate random 32-byte hex values:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice. Use one output as `SESSION_SECRET` and the other as `FILE_ENCRYPTION_KEY`. The encryption key must be exactly 64 hex characters. Keep it backed up privately: changing/losing it prevents decrypting existing ID documents. Do not reuse another project’s session secret.

Configure:

```dotenv
PORT=4000
MONGODB_URI=your-atlas-uri
SESSION_SECRET=your-random-session-secret
FILE_ENCRYPTION_KEY=your-separate-64-character-hex-key
ADMIN_ORIGIN=http://localhost:5173
PAYSTACK_SECRET_KEY=your-paystack-test-secret-key
PAYMENT_RETURN_URL=http://localhost:4000/payment-return
SMTP_HOST=your-smtp-host
SMTP_PORT=465
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
SMTP_FROM=loRan Shopper <your-approved-sender@example.com>
SUPER_ADMIN_EMAIL=your-admin-email@example.com
SUPER_ADMIN_PASSWORD=your-strong-admin-password
SUPER_ADMIN_NAME=Platform Administrator
TRUST_PROXY_HOPS=0
```

Atlas must allow your laptop IP and the database user must have read/write access. Do not share real secrets in chat or commit `.env` files.

Create your first admin, then start the API:

```powershell
npm.cmd run create-admin
npm.cmd run dev
```

After successful creation, remove `SUPER_ADMIN_PASSWORD` from `.env`. Additional admins are created in the portal by the super admin. The script refuses to overwrite an existing account.

Check http://localhost:4000/health. It should return `{"ok":true}`.

The long-running API is required for uploads, MongoDB and email-outbox processing; it is not deployed as a static website.

## 3. Start the admin portal

Open a second terminal in `loran-shopper/admin`:

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run dev
```

Its `.env` contains:

```dotenv
VITE_API_URL=http://localhost:4000
```

Open http://localhost:5173 and sign in using the account created by the script. Administrator tokens are held in browser memory only; refreshing the portal requires signing in again.

First set a sensible flat platform fee, then review shopper applications. The interface asks for reasons when approving/rejecting/suspending. Newly approved shoppers must sign in again because approval revokes prior sessions.

## 4. Run the native app on your phone

Open a third terminal in `loran-shopper/mobile`:

```powershell
npm.cmd ci
Copy-Item .env.example .env
```

Find your computer’s Wi-Fi IPv4 address:

```powershell
ipconfig
```

Set `mobile/.env` using that address, for example:

```dotenv
EXPO_PUBLIC_API_URL=http://192.168.1.100:4000
```

Do **not** use localhost on a physical phone: it refers to the phone, not your computer. Keep phone and computer on the same reachable Wi-Fi, allow the API/Metro ports through Windows Firewall if prompted, and avoid guest Wi-Fi that isolates devices.

Start Expo:

```powershell
npx.cmd expo start
```

Scan the QR code using Expo Go on Android or the camera/Expo Go on iPhone as supported. If Expo Go’s installed SDK does not match, update it or use an Expo development build. Restart Metro after changing the API URL.

Only the API’s public origin belongs in `EXPO_PUBLIC_API_URL`. Paystack secret keys, SMTP credentials, MongoDB URI and encryption/session keys must **never** be added to the mobile app or portal public environment variables.

## 5. Test the shopping flow

1. In the phone app, select **Apply as a shopper**, complete the form and upload a profile photo and a synthetic/test identity document. Use your WhatsApp number in international format.
2. In the admin portal, review and approve the application.
3. Sign in to the shopper dashboard and turn availability on.
4. From the mobile homepage, find the shopper, select a covered market and submit a test list with a valid customer email/address/phone.
5. Copy the generated private order ID. A receipt email is queued; actual email delivery depends on SMTP.
6. The shopper opens Orders, costs every item per unit, adds transport/shopping fees and sends the quote.
7. The customer tracks with their ID, accepts or rejects. Rejection needs a reason; the shopper can requote or cancel an unaccepted order.
8. After acceptance, use Paystack **test mode** checkout. Return to the app and tap **Check payment** if needed. The API verifies it before allowing shopping.
9. The shopper marks shopping, then delivered. The customer sees the same timeline and a complaint deadline and may confirm receipt.
10. Test a complaint. Admins receive its order/customer details and can record a resolution, which queues a customer email.
11. Configure and verify shopper bank details using the email confirmation code. Paystack bank-name/account-resolution access depends on your account and mode.
12. After the 24-hour delivery window and resolution of open complaints, actually transfer the exact settlement to the verified bank account, then record its reference and amount in **Pay / settlements → Shopper paid in full**.

Do not accelerate the production complaint clock to test payouts. The automated tests safely simulate elapsed time in a temporary database.

## 6. Paystack and email configuration

Use test keys first. Configure your public API webhook URL in the Paystack dashboard:

```text
https://YOUR_API_DOMAIN/webhooks/paystack
```

The deployed return URL should be:

```text
https://YOUR_API_DOMAIN/payment-return
```

For local webhook testing, a permitted tunnel can expose the API, or use a staged HTTPS deployment. Mobile checkout returns through a small API-hosted message page; close it and check payment in the native app. The user’s return from checkout alone never establishes successful payment.

Configure a verified SMTP sender. Gmail SMTP commonly requires an app password and suitable account settings; do not use a normal password where the provider requires an app password. The worker runs while the API process is alive. Hosting that sleeps can delay queued email. For consistent operations, use an always-on service or a separately managed queue worker.

Bank names are fetched from Paystack with cursor pagination. Account-name resolution returns the account holder name, rather than merely trusting the bank/account number entered. A resolved name establishes a bank lookup match, not independent ownership identity verification by loRan.

Payment initialization failures or mismatched verified fields require operational review. The admin Payments page shows pending/success/failed/review entries. Before retrying any uncertain real payment, reconcile the Paystack reference to avoid charging a customer twice.

Refunds, partial refunds, chargeback/dispute webhooks, automatic money transfers and staged advances are **not automated in this version**. Handle a justified refund in the Paystack dashboard/your documented process, preserve evidence and transfer references, and reconcile the ledger before any shopper settlement. Ticket resolution by itself does not issue a refund. This collection/manual-settlement flow should not be described as regulated escrow.

## 7. Automated checks

In `api`:

```powershell
npm.cmd run build
npm.cmd test
```

The integration suite launches temporary MongoDB and mocks Paystack network responses. Its first run may download a MongoDB binary. It never uses your real Atlas or Paystack account.

In `admin`:

```powershell
npm.cmd run build
```

In `mobile`:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npx.cmd expo export --platform android --platform ios
```

These exports validate native JavaScript/assets, not a signed APK/IPA or a physical-device run.

Completed checks: API TypeScript build, admin production build, mobile lint/TypeScript checks, Expo Doctor (21/21), Android and iOS bundle exports, and the database-backed suite with **57 HTTP assertions** plus stored-state checks. It checks application approval/session revocation, availability/privacy, encrypted/private identity access, quote revisions, duplicate payment verification, webhook signatures, allowed order progression, complaint-gated settlement, OTP/replay protection, password reset, order ownership and suspension.

API/admin production dependency audits reported zero known vulnerabilities. The current Expo toolchain audit reports advisories in transitive build/tooling dependencies (braces, node-forge and uuid, with downstream packages). Do not run `npm audit fix --force` blindly: its proposed Expo downgrade breaks the supplied SDK. Review compatible upstream fixes before a production release. The advisories are recorded here; they were not silently removed by an unsupported dependency override.

Real Paystack transactions, SMTP delivery, device visual/permission/network behavior, signed native builds and app-store submission have **not** been tested or completed here.

## 8. GitHub

Create an empty private repository named `loran-shopper`. From the root folder containing `api`, `mobile` and `admin`:

```powershell
git init
git add .
git status
```

Verify no actual `.env` files or secrets are staged. Then:

```powershell
git commit -m "Build loRan Shopper native app and backend"
git branch -M main
git remote add origin https://github.com/dani4god/loran-shopper.git
git push -u origin main
```

Use your actual repository URL if different. Configure your name/email if Git requests them.

## 9. Deploy the API and admin portal

For an initial deployment, Render supports the long-running Express API and Vercel can host the separate admin portal.

**API (Render web service or equivalent):**

| Setting        | Value                     |
| -------------- | ------------------------- |
| Root directory | `api`                     |
| Runtime        | Node.js 22/24             |
| Build command  | `npm ci && npm run build` |
| Start command  | `npm start`               |
| Health path    | `/health`                 |

Add the server environment variables from step 2. Use production/staging Atlas credentials as appropriate and configure network access for the host. Set `PAYMENT_RETURN_URL` to your public API `/payment-return`, update Paystack’s webhook, and set `ADMIN_ORIGIN` to the admin portal’s exact origin. `PORT` is normally supplied by the host. Configure `TRUST_PROXY_HOPS` only to the exact reverse-proxy topology (for example one trusted hop where appropriate); it controls real-client-IP rate limiting. Do not blindly trust arbitrary forwarded headers.

**Admin (Vercel):** import the same repository, choose root `admin`, framework **Vite**, build `npm run build`, output `dist`, and set:

```dotenv
VITE_API_URL=https://YOUR_API_DOMAIN
```

Redeploy after changing that public API URL. The portal needs the API’s configured ADMIN_ORIGIN to match its domain. MongoDB, Paystack and SMTP secrets go only on the API host.

## 10. Build an installable Android APK

The ZIP is source code, not an APK. From `mobile`:

```powershell
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build:configure
```

This links the app to your Expo account. Keep the supplied `eas.json` preview APK profile. Change `com.loran.shopper` in `app.json` if your chosen application identifier needs to differ; store identifiers must belong to your app.

Set the reachable HTTPS API origin in the EAS **preview** environment, either in the Expo dashboard or with:

```powershell
npx.cmd eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value https://YOUR_API_DOMAIN --environment preview --visibility plaintext
```

Build the APK:

```powershell
npx.cmd eas-cli@latest build --platform android --profile preview
```

Follow signing prompts and let EAS finish. Its resulting APK link can be used for internal Android testing. Test installs, photo/ID permissions, login, background/foreground behavior, checkout returns and slow networks on actual phones.

For a Play Store build, configure the production environment URL and use the production profile (AAB by default):

```powershell
npx.cmd eas-cli@latest build --platform android --profile production
```

For iPhone:

```powershell
npx.cmd eas-cli@latest build --platform ios --profile production
```

iOS signing/TestFlight/App Store distribution needs the relevant Apple account setup. App-store publishing also needs your listings, privacy disclosures, screenshots and review process. None of these accounts, signing credentials, payments or submissions were created here.

## 11. Operational boundaries and next releases

The requested core workflow is implemented as an MVP. Before real transactions, complete live provider/device tests, finalize the actual business terms and support contacts, agree on inventory funding/settlement rules, and establish backups/monitoring and identity-document retention. The included Terms text is a functional draft to adapt to the real operator and dispute policy.

Not included: automatic refunds/transfers, push notifications, live maps/GPS routing, in-app chat, ratings, offline synchronization, customer account recovery via email, identity-provider KYC checks, shopper reassignment after payment or a tax/accounting reconciliation system. Order IDs are emailed so customers can recover them from their inbox. Admin password recovery/MFA is an operational process to add before broad use; shopper password recovery is implemented.

## Artwork

`mobile/assets/market-1.png` through `market-4.png` are original generated illustrative Nigerian market scenes for produce, textiles, grains, and fruit/household goods. They are not claimed photos of named markets. Generated with built-in ImageGen from the brief “photograph-style illustrative Nigerian open-air market, warm daylight, authentic everyday commerce, no text/logos, no named location”. Replace with licensed actual market photography if desired. The app labels them illustrative.

## Official references

- https://docs.expo.dev/build-reference/apk/
- https://docs.expo.dev/eas/environment-variables/manage/
- https://docs.expo.dev/versions/latest/sdk/securestore/
- https://paystack.com/docs/payments/verify-payments/
- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/api/miscellaneous/
- https://render.com/docs/deploy-node-express-app

The supplied Expo launcher/splash icons remain the scaffold defaults. Replace those assets with your final loRan branding before store submission.
