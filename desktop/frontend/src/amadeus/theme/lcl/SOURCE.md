# Vendored from Forsion-LCL — DO NOT hand-edit the token/theme parts here

These files are the **shared design-language layer**, copied verbatim from Forsion-LCL.
LCL is the **single source of truth**. If you change the design language, change it in LCL
first, then re-copy here. (When Tangu Desktop also adopts this, we extract a real shared
package + workspace; until then, vendoring keeps Amadeus standalone-buildable.)

| here | ← source in Forsion-LCL |
|---|---|
| `tangu.css` | `src/tangu/tangu.css` — `.tangu-lovable` token layer + skins (lovable/echo/qbird/custom) |
| `tanguSoft.css` | `src/tanguSoft/tanguSoft.css` — `.tangu-soft` token layer + themes (soft/qbird/custom) |
| `recipes.css` | `src/amadeus/amadeus.css` — the shared `.am-*` recipes (per-base). **Amadeus extends this** with shell recipes (`recipes.ext.css`), NOT by editing this file. |
| `lovableData.ts` | `src/tangu/tanguData.ts` — `SKINS` + `customSkinVars(seed,dark)` |
| `softData.ts` | `src/tanguSoft/tanguSoftData.ts` — `THEMES` + `customVars(seed,dark)` |

Re-sync command (from repo root):
```
LCL=Forsion-LCL/src; DEST=apps/Amadeus/src/renderer/theme/lcl
cp $LCL/tangu/tangu.css $DEST/tangu.css
cp $LCL/tanguSoft/tanguSoft.css $DEST/tanguSoft.css
cp $LCL/amadeus/amadeus.css $DEST/recipes.css
cp $LCL/tangu/tanguData.ts $DEST/lovableData.ts
cp $LCL/tanguSoft/tanguSoftData.ts $DEST/softData.ts
```
