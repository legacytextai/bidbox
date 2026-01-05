# design-guidelines.md

## Emotional Thesis  
Feels like a contractor's war room — sharp, no-frills, deadline-driven. Every UI decision should scream: *"Don't screw this up on bid day."*

## Typography

- **H1** – Project titles: `Inter, Bold, 28px`, 1.5 line-height  
- **H2** – Section headers: `Inter, Semibold, 22px`  
- **H3** – Labels: `Inter, Medium, 16px`  
- **Body** – General text: `Inter, Regular, 14px`, 1.6 line-height  
- **Caption** – Metadata or timestamps: `Inter, Light, 12px`  
- System font fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

> Tone: confident, no-nonsense, readable on jobsite iPads and office monitors alike.

## Color System

| Purpose              | Hex       | RGB             | Usage |  
|----------------------|-----------|------------------|-------|  
| **Primary** (black)  | `#121212` | `18, 18, 18`     | Text, backgrounds |  
| **BidBox Blue**      | `#1D4ED8` | `29, 78, 216`    | **PRIMARY BRAND COLOR** - CTA buttons, links, accents, icons, sidebar logo |  
| **Accent Orange**    | `#D92D20` | `217, 45, 32`    | Urgent badges only |  
| **Soft Gray**        | `#F4F4F5` | `244, 244, 245`  | Backgrounds |  
| **Outline**          | `#E4E4E7` | `228, 228, 231`  | Borders |  
| **Success Green**    | `#12B76A` | `18, 183, 106`   | Success states, Active license badges |
| **Job Walk Gray**    | `#6B7280` | `107, 114, 128`  | Job walk event badges (calendar) |

- Contrast: WCAG AA+ minimum 4.5:1  
- Light & dark mode: use Tailwind's `dark:` variant support  
- Mood: urgent but not chaotic

## Layout & Spacing

- **Grid**: 8pt system  
- **Container Widths**:  
  - GC dashboard: `max-width: 1200px`, centered  
  - Public bid page: `max-width: 800px`, centered  
- **Padding**:  
  - Form fields: `px-4 py-3`  
  - File cards: `px-6 py-5`  
- **Breakpoint Logic**:  
  - `sm`: stack elements vertically  
  - `md`: two-column layout  
  - `lg+`: maintain centered max-width

## Motion & Interaction

- **File upload success**: 250ms fade-in with checkmark  
- **Copy link**: 200ms glow on hover, ease-in-out  
- **Countdown timer**: ticks in real-time using smooth JS transitions (no jank)  
  - **CRITICAL**: Countdown digits remain **black**, not blue  
- **Button behavior**:  
  - Hover = soft background fill  
  - Tap = compress 1px + subtle shadow

> Follow "Kindness in Design" → motion should confirm, never distract.

## Header & Branding

- **Landing Page Header**: White background with blue accents  
- **Authenticated Pages Header**: White background  
- **Sidebar Logo**: "BB" in vibrant blue (#1D4ED8)  
- **Logo Strategy**: Use "BB" mark only — avoid duplicate "BidBox" text in desktop views  
- **Profile Button**: Blue circular avatar with white text

## Voice & Tone

- Personality: Direct, helpful, focused  
- Avoid humor, over-friendly nudges, or techy jargon  
- **Examples**:  
  - Onboarding: "Start a new project to generate your bid room."  
  - Success: "Bid uploaded. You'll get a confirmation email shortly."  
  - Error: "Something went wrong — try again or contact support."

## System Consistency

- Use `shadcn/ui` component patterns  
- Buttons = same radius, padding, font size  
- File upload = consistent drag-drop zone across GC and public views  
- Form styling = shared components (`<Label>`, `<Input>`, `<TextArea>`)
- Status badges: Use "active" (green) consistently for both Private Pool and Network Pool
- Calendar events: Header/badge first ("Bid Due" or "Job Walk"), project name second, datetime third

## Print Design Patterns

### Iframe-Based Printing (Recommended for complex layouts)

When CSS-only print solutions prove unreliable across browsers, use the iframe approach:

1. Generate self-contained HTML with inline styles
2. Create hidden iframe and inject content
3. Set document title for PDF filename (browsers use title for Save-as-PDF name)
4. Trigger `print()` from iframe context
5. Clean up iframe after printing

**Implementation Reference**: `src/lib/calendarPrint.ts`

**Print Styling Requirements**:
- `@page { size: letter landscape; margin: 0.4in; }`
- `-webkit-print-color-adjust: exact` for color preservation
- Use explicit dimensions (no `auto` heights)
- Calculate row heights based on available space

## Accessibility

- All form fields = labeled  
- Buttons = `aria-pressed` and focus indicators  
- Countdown timer = `aria-live="polite"` for screen readers  
- File lists = screen-reader readable, role `list` with `listitem`

## Emotional Audit Checklist

✅ Does this layout evoke clarity under time pressure?    
✅ Does motion confirm user action without distraction?    
✅ Would a 55-year-old estimator feel confident and supported?

## Technical QA Checklist

- Typography adheres to 8pt grid  
- Color contrast ≥ AA+  
- Interactive states visually distinct  
- All motion durations: 150–300ms

## Adaptive System Memory

- GC company name autofills on public confirmation  
- Timezone-adjusted timestamps for bid submissions  
- Store last used agency and location in localStorage for fast reuse

## Design Snapshot

### 🎨 Color Palette  
```txt  
Primary (Black): #121212  
BidBox Blue (PRIMARY BRAND): #1D4ED8 ← Use for CTAs, links, accents, icons  
Accent Orange: #D92D20 (urgent badges only)  
Soft Gray: #F4F4F5  
Outline: #E4E4E7  
Success Green: #12B76A
```

### 🔤 Typographic Scale  
| Element | Size | Weight |
|---------|------|--------|
| H1 | 28px | Bold |
| H2 | 22px | Semibold |
| H3 / Labels | 16px | Medium |
| Body | 14px | Regular |
| Caption | 12px | Light |

### 📐 Spacing System

- 8pt grid baseline
- Buttons: px-4 py-2
- Cards: px-6 py-5
- Inputs: px-4 py-3

### 🧠 Emotional Thesis

Feels like a contractor's war room — sharp, no-frills, deadline-driven.

## Design Integrity Review

BidBox strikes the right tone for high-stakes bid workflows. Visuals are clear, form fields are scannable, and the experience reduces decision fatigue. Every button serves a clear purpose. The vibrant blue (#1D4ED8) provides strong brand identity across CTAs and key UI elements while maintaining professional credibility.