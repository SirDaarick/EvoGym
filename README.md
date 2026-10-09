# EvoGym operational prototype

A local, Spanish-language demo for validating gym workflows. It does not process real payments, authenticate users, or synchronize Excel and the mandatory physical notebook.

## Run locally

Use a current Node.js LTS version supported by Vite, then:

```sh
npm install
npm run dev
```

Open the URL printed by Vite at `/`. Choose **Admin** or **Recepción** without credentials. Admin uses the internal OWNER view; Reception opens **Inicio**. Existing deep links and **Rol de demostración** remain available. **Restablecer demo** restores sample records without changing the current view. All state lives in memory and resets on page reload.

## Owner discussion walkthrough

1. Select Reception, choose product cards and quantities, then review and confirm a demo cash/card purchase. Only complete success clears the cart. A transfer remains pending without confirmed income or stock reduction; settlement is not implemented.
2. Use header search to open **Demo Activa**, register entry, expand the demo clock, advance 30 minutes and register exit. Try the provisional expiry-day/repeat-visit switches on the relevant examples.
3. Enter again and simulate **22:00** closure: attendance remains but departure and duration are unknown. The orange calendar indicates frequency, not elapsed time; initial visits are fictitious examples.
4. Open **Turno** and try bill/coin quantities or the manual total. Review expected, counted and difference before confirming.

Expandable questions stay beside their workflows. Expiry-day access and repeat visits are provisional; denomination catalog, product imagery, payment/renewal rules and timezone still need owner confirmation. Original sample membership dates do not prove eligibility. The proposed Mexico City demo clock is controlled, not the real clock; no background closure runs while the app is closed.

The unfinished cart is local to Home and is discarded on navigation/profile change. Recorded operations stay in memory until reset/reload. This prototype has no authentication, backend, real payment processing or persistence; it never replaces notebook/Excel reconciliation.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Typecheck, component acceptance tests, and the production bundle are separate checks. Browser layout, zoom, keyboard, and workflow validation remain necessary; passing these commands is not an accessibility certification.

## Implementation map

| Location | Responsibility |
|---|---|
| `src/app` | Routing, role-view navigation, application shell |
| `src/shared/ui.tsx` | Shared semantic controls and task surfaces |
| `src/styles.css` | Tailwind v4 theme tokens and responsive shared styles |
| `src/domain` | Typed business records, role names, integer monetary values |
| `src/demo` | Sample state and local adapter/provider, separate from presentation |
| `src/features/catalog` | In-browser component state reference at `/components` |

Operational routes demonstrate local workflows, not production permission enforcement. Provisional rules and sample records are not approved business policy or real access authorization.

## Design and boundaries

Read `Design.md` for the screen map, shared component contract, and unresolved business rules. No original logo asset exists in the repository yet; the shell uses plain product-name text, not a replacement mark. Supply the original approved asset before branded production use.

Transfer confirmation, grace, credit application/refund, cancellation, exceptional permissions, and ambiguous renewal dates remain unresolved. The notebook remains mandatory; Excel remains the current master. No automatic reconciliation or synchronization is implemented.

The foundation uses React, TypeScript, React Router, Vite and the [official Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite). No dialog library is added until a workflow actually needs a dialog.
