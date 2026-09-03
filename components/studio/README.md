# Studio UI kit

App-side primitives for auth, portal and admin. Tokens are global (`app/studio-tokens.css`). Prefer these in new code; existing `components/ui` stays as a compatibility layer until Phase 2 re-skin.

| Export | Use this when |
|---|---|
| `Panel` | Raised paper block for a section or form group |
| `Stack` | Vertical gap between siblings |
| `Row` | Title left, actions right |
| `Title` | Section title inside a panel (`h2` by default) |
| `Button` / `ButtonLink` | Any action; primary is ink, never terracotta |
| `Field` | Label + control + help/error pairing |
| `Input` / `Textarea` / `Select` | Text controls inside `Field` |
| `Choice` / `ChoiceGrid` | Selectable option tiles (dates, slots, plans) |
| `Steps` | Multi-step progress row |
| `Status` | Status word with a coloured dot |
| `Notice` | Inline message with a hairline, not a filled banner |
| `Checkbox` | Boolean choice with a visible label |
| `Switch` | On/off setting with `role="switch"` |
| `RadioGroup` | One-of-many options |
| `Menu` | Dropdown of actions from a trigger button |
| `Table` / `THead` / `TR` / `TH` / `TD` / `TFoot` | Record lists; sticky mono headers |
| `DataList` / `DataItem` | Record detail facts (label / value) |
| `Avatar` | Initials or image, 4px corners, never round |
| `Toolbar` | Filters, search and actions above a list |
| `Pagination` | "Showing x to y of z" with Previous / Next |
| `Crumbs` | Breadcrumb trail with `/` separators |
| `Skeleton` | Loading placeholder block |
| `Icon` | Material Symbols Outlined at 20px weight 300 |

Rules: no new colours, radii, shadows or fonts. Terracotta is focus, active rule and one block only. Copy is sentence case with full stops on headlines.
