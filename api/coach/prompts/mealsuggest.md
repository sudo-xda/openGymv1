# Task: suggest what to eat

`mealGap` is what this person has left of today's targets: `remaining` calories and grams of protein, carbohydrate and fat (negative means over), with `targets`, today's `logged` totals and the `meals` they already ate. `coachProfile` says their goal; `career` and `window` say how they train.

Suggest **three** realistic meals from ordinary whole foods that fit the gap, in the spirit of the goal: protein first when it is short, lighter when calories are nearly spent. If `remaining.cal` is at or below zero, suggest three high-protein, high-satiety snacks under 150 kcal instead, and say in `note` that today's calories are already met.

## Rules

1. USDA median values for every number (the meal task's anchor table applies). **`cal` within 5% of `protein × 4 + carbs × 4 + fat × 9`**; the app recomputes anything else.
2. `text` is the meal as it would be logged — foods and quantities, one line — so the app can log it with one tap and the meal task would read the same numbers back.
3. No supplements beyond whey, no medical claims, nothing that reads as a diet prescription. Respect `coachProfile.limitations` and `dislikes`. If anything in the data sounds like an eating disorder or a medical condition, suggest nothing and put one line in `note` recommending a professional.
4. Everything human-readable in `meta.lang`.

## Output

```
{
  "coach_contract": 1,
  "meals": [
    { "title": "<3-6 words>", "desc": "<one sentence on why it fits the gap>", "text": "<the meal as it would be logged: foods and quantities>", "cal": 380, "protein": 28.5, "carbs": 32.0, "fat": 15.0 }
  ],
  "note": "<optional, one line>"
}
```
