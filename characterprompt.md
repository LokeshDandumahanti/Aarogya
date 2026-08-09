# AAROGYA — Cartoon Character Avatar Prompts

Use these prompts to generate **cartoon avatar images** for the app. The app
loads each character's avatar from `Assets/<CharacterName>.png` (it already
falls back to an initial-letter gradient when the image is missing).

**Save each image as:** `Assets/<CharacterName>.png` — in **both** `V5` and `V6`
(the app reads them at runtime; keep them in sync).

---

## How to generate (all tools)

- **Aspect:** square, **1:1** — avatars are circular crops, so keep the face
  **centered** and the composition head-and-shoulders.
- **Resolution:** generate at **1024×1024** (512×512 is fine). The app displays
  avatars as 34–48px circles, so a 1024 image stays crisp on any screen.
- **Background:** soft, plain, warm — matches the character's colour so the
  circular crop blends with the app.
- **Style:** the shared style anchor below, applied to every character so the
  set looks like one family.

### Shared style anchor (paste at the start of every prompt)
> Flat vector-style cartoon illustration, clean bold outlines, soft warm
> shading, warm full colour, gentle friendly mood, head-and-shoulders portrait,
> face centered, square 1:1 composition, plain soft warm background — the kind
> of avatar for a friendly medical-training app.

---

## Primary patients

### 1. Sunita — The Refusing Mother → `Assets/Sunita.png`
> *(style anchor)* — an exhausted but dignified young Indian woman, 22 years
> old, mother of a newborn, dark circles under her tired eyes, hair pulled back
> loosely, wearing a simple cotton saree and a thin dupatta over her head,
> expression wary and guarded but not hostile — lips pressed, holding herself
> together. Plain soft terracotta background (warm burnt orange, #e07a5f).

### 2. Arun — Itchy Rash → `Assets/Arun.png`
> *(style anchor)* — a shy young Indian man, 19 years old, a hostel college
> student, short slightly messy hair, plain casual t-shirt, one hand scratching
> his wrist and looking a little embarrassed about it, small reddish marks on
> his forearm. Plain soft warm golden background (#e9c46a).

### 3. Shambu — I am feeling breathlessness, please help me → `Assets/Shambu.png`
> *(style anchor)* — a dignified elderly Indian man, 72 years old, a retired
> schoolteacher, thin, white short hair and a neat white moustache, round
> reading glasses on a cord, wearing a plain kurta, expression uncertain and
> slightly worried, reaching out as if asking for help. Plain soft umber-brown
> background (#b36b3f).

---

## Supporting characters

### 4. Sharada — mother-in-law → `Assets/Sharada.png`
> *(style anchor)* — a strong elderly Indian woman, late 60s, weathered and
> proud, grey hair in a tight bun, gold bangles and a traditional saree,
> expression stern and sceptical with a hidden softness behind her eyes. Plain
> soft golden-ochre background (#e9c46a).

### 5. Rohit — hostel roommate → `Assets/Rohit.png`
> *(style anchor)* — a cheerful young Indian man, 19, hostel roommate, casual
> hoodie, warm open smile, easygoing. Plain soft coral background (#e76f51).

### 6. Priya — granddaughter → `Assets/Priya.png`
> *(style anchor)* — a caring young Indian woman in her early 20s, modern but
> respectful, salwar-kameez, gentle concerned expression, phone in one hand
> (she set up the consult). Plain soft green background (#7a9b5a).

### 7. Sister Aagya — nurse & data analyst → `Assets/Sister Aagya.png`
> *(style anchor)* — a professional, kind Indian nurse in her 30s, light-blue
> nurse sari with a stethoscope, holding a clipboard, competent and reassuring
> expression. Plain soft blue background (#4488ff). *She appears in every case,
> so keep her design identical across all three.*
>
> **Note:** the filename must match the app exactly — the space is part of it:
> `Assets/Sister Aagya.png`.

---

## Optional Midjourney parameters
Append for Midjourney: `--ar 1:1 --style raw --v 6`

## Consistency tip
If the tool supports it, lock the style by generating the first character, then
use it as a style reference for the others (image-prompt / reference mode) so
Sunita, Arun and Shambu all look like they live in the same illustrated world.
