# EvoGym operational prototype

A local, Spanish-language demo for validating gym workflows. It does not process real payments, authenticate users, or synchronize Excel and the mandatory physical notebook.

## Run locally

Use a current Node.js LTS version supported by Vite, then:

```sh
npm install
npm run dev
```

Open the URL printed by Vite. The app starts in OWNER view. Use **Rol de demostración** to simulate RECEPTION. **Restablecer demo** restores sample records without changing the current view. All demo state lives in memory and also resets on page reload.

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

Operational routes are placeholders until their task is implemented. Do not treat visible navigation as a completed capability or an authorization boundary. There is no production permission enforcement in this prototype.

## Design and boundaries

Read `Design.md` for the screen map, shared component contract, and unresolved business rules. No original logo asset exists in the repository yet; the shell uses plain product-name text, not a replacement mark. Supply the original approved asset before branded production use.

Transfer confirmation, grace, credit application/refund, cancellation, exceptional permissions, and ambiguous renewal dates remain unresolved. The notebook remains mandatory; Excel remains the current master. No automatic reconciliation or synchronization is implemented.

The foundation uses React, TypeScript, React Router, Vite and the [official Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite). No dialog library is added until a workflow actually needs a dialog.
