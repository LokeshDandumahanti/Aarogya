# AAROGYA — Case Study Situation Image Prompts

One hero **scene image** per case study, in the **same cartoon style** as the
character avatars (`characterprompt.md`) so the app looks like one world.

**Aspect:** **16:9 landscape** (a scene reads best wide). If your layout needs
square, say `square 1:1` in place of the landscape note.

**Resolution:** generate at **1920×1080** (≥1280×720 acceptable). The scenes
aren't wired into the app UI yet — generate wide for a hero/banner, or square
if they end up as card thumbnails.

**Save each as:** `assets/case_<case>.png` — in **both** `V5` and `V6`.

| Case | Suggested file |
|---|---|
| Sunita — The Refusing Mother | `assets/case_sunita.png` |
| Arun — Itchy Rash | `assets/case_arun.png` |
| Shambu — I am feeling breathlessness | `assets/case_shambu.png` |

---

## Shared style anchor (paste at the start of every prompt)
> Flat vector-style cartoon illustration, clean bold outlines, soft warm
> shading, warm full colour, gentle friendly mood — the visual language of a
> friendly medical-training app. Landscape 16:9 composition.

---

## 1. Sunita — The Refusing Mother → `assets/case_sunita.png`
> *(style anchor)* — the interior of a small, simple Indian rural home at dusk.
> A young mother, 22, sits on the edge of a charpai bed cradling her newborn
> infant wrapped in a blanket, her face drawn with exhaustion and quiet fear,
> dark circles under her eyes. An older woman in a traditional saree stands
> beside her, arms crossed, sceptical but not cruel. On a wooden table: the
> baby's health card and a district-hospital referral form beside a small warm
> lamp. The mood is the weight of a decision. Warm terracotta and amber
> palette, dim golden light.

## 2. Arun — Itchy Rash → `assets/case_arun.png`
> *(style anchor)* — a small Indian hostel room with a metal bunk bed, a ceiling
> fan, a desk with books and a water bottle. A young man, 19, sits on the lower
> bunk pulling up his sleeve to scratch his forearm, embarrassed, with an itchy
> red rash visible between his fingers. A roommate at the desk glances over.
> Bright daylight through a small window. Warm golden and coral palette.

## 3. Shambu — I am feeling breathlessness → `assets/case_shambu.png`
> *(style anchor)* — an elderly man, 72, at home in a cushioned armchair by a
> window, sitting slightly forward with a hand on his chest, breathless but
> composed, round reading glasses on a cord. On the side table: two paper lab
> reports (a glucose report and an HbA1c report) and a tablet showing a
> video-consult screen with a doctor. A young woman, his granddaughter, stands
> nearby watching him with concern. Warm umber and soft green palette, calm
> afternoon light.

---

## Optional Midjourney parameters
Append for Midjourney: `--ar 16:9 --style raw --v 6`

## Consistency tip
Generate the three scenes after the character avatars and use one of them (or
the character set) as a style reference, so the people in the scenes look like
the avatars in the chat.
