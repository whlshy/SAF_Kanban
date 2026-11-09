# Icons

The site icon is a card being dragged between two columns. Colors follow the browser's light/dark setting (CSS inside the SVG): dark gray lines and a blue card on light tabs, light gray lines and a lighter blue card on dark tabs.

| File | Use |
| --- | --- |
| `kanban-drag-frame-soft.svg` | **In use** as `public/favicon.svg`: rounded-square outline at half opacity |
| `kanban-drag-frame.svg` | Alternative: outline in the same color as the columns |
| `kanban-drag.svg` | Alternative: no outline, drawing fills the canvas |
| `favicon-fallback.svg` | Source of `public/favicon-32.png` for browsers without SVG icons; one mid-gray palette that reads on light and dark tabs |
| `apple-touch-icon.svg` | Source of `public/apple-touch-icon.png` (180 × 180) for the iOS home screen, which fills transparency with black, so it has its own dark background |

To change the icon, edit the SVG here, copy it to `public/favicon.svg`, and re-render the PNGs at 32 × 32 and 180 × 180 (any SVG renderer, e.g. a browser screenshot).
