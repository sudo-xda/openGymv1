/* Canonical servings, as the USDA FoodData Central (SR Legacy / Foundation) medians have them.
 *
 * One table, two readers: the meal prompt quotes it so the model anchors to the same numbers
 * every time (a model asked for "an egg" without an anchor answers 60 kcal one day and 90 the
 * next), and the app's quick-add list (frontend/src/lib/nutrition.js) logs these without any
 * model at all. Grams of protein, carbohydrate and fat per one serving; `g` is the serving's
 * edible weight. Kept to common foods on purpose — this is an anchor, not a database.
 */
export const FOODS = Object.freeze([
  { id: 'egg', name: 'Egg, large', serving: '1 large (50 g)', g: 50, cal: 72, p: 6.3, c: 0.4, f: 4.8 },
  { id: 'bread-white', name: 'White bread', serving: '1 slice (30 g)', g: 30, cal: 79, p: 2.7, c: 14.8, f: 1.0 },
  { id: 'bread-whole', name: 'Whole-wheat bread', serving: '1 slice (32 g)', g: 32, cal: 81, p: 4.0, c: 13.8, f: 1.1 },
  { id: 'butter', name: 'Butter', serving: '1 tbsp (14 g)', g: 14, cal: 102, p: 0.1, c: 0.0, f: 11.5 },
  { id: 'olive-oil', name: 'Olive oil', serving: '1 tbsp (14 g)', g: 14, cal: 119, p: 0.0, c: 0.0, f: 13.5 },
  { id: 'chicken-breast', name: 'Chicken breast, cooked', serving: '100 g', g: 100, cal: 165, p: 31.0, c: 0.0, f: 3.6 },
  { id: 'chicken-thigh', name: 'Chicken thigh, cooked', serving: '100 g', g: 100, cal: 209, p: 26.0, c: 0.0, f: 10.9 },
  { id: 'beef-lean', name: 'Beef, lean, cooked', serving: '100 g', g: 100, cal: 250, p: 26.0, c: 0.0, f: 15.0 },
  { id: 'salmon', name: 'Salmon, cooked', serving: '100 g', g: 100, cal: 208, p: 20.0, c: 0.0, f: 13.0 },
  { id: 'tuna-can', name: 'Tuna, canned in water', serving: '100 g', g: 100, cal: 116, p: 25.5, c: 0.0, f: 1.0 },
  { id: 'rice-white', name: 'White rice, cooked', serving: '1 cup (158 g)', g: 158, cal: 206, p: 4.3, c: 44.5, f: 0.4 },
  { id: 'rice-brown', name: 'Brown rice, cooked', serving: '1 cup (195 g)', g: 195, cal: 216, p: 5.0, c: 44.8, f: 1.8 },
  { id: 'pasta', name: 'Pasta, cooked', serving: '1 cup (140 g)', g: 140, cal: 220, p: 8.1, c: 43.2, f: 1.3 },
  { id: 'potato', name: 'Potato, boiled', serving: '1 medium (150 g)', g: 150, cal: 130, p: 2.6, c: 30.0, f: 0.2 },
  { id: 'oats', name: 'Oatmeal, cooked', serving: '1 cup (234 g)', g: 234, cal: 166, p: 6.0, c: 28.0, f: 3.6 },
  { id: 'oats-dry', name: 'Oats, dry', serving: '40 g', g: 40, cal: 152, p: 5.3, c: 27.0, f: 2.6 },
  { id: 'banana', name: 'Banana', serving: '1 medium (118 g)', g: 118, cal: 105, p: 1.3, c: 25.0, f: 0.4 },
  { id: 'apple', name: 'Apple', serving: '1 medium (182 g)', g: 182, cal: 95, p: 0.5, c: 23.0, f: 0.3 },
  { id: 'orange', name: 'Orange', serving: '1 medium (131 g)', g: 131, cal: 62, p: 1.2, c: 14.0, f: 0.2 },
  { id: 'berries', name: 'Mixed berries', serving: '1 cup (150 g)', g: 150, cal: 70, p: 1.0, c: 15.5, f: 0.5 },
  { id: 'milk-whole', name: 'Milk, whole', serving: '1 cup (244 ml)', g: 244, cal: 149, p: 8.0, c: 12.0, f: 8.0 },
  { id: 'milk-skim', name: 'Milk, skim', serving: '1 cup (245 ml)', g: 245, cal: 83, p: 8.3, c: 12.2, f: 0.2 },
  { id: 'yogurt-greek', name: 'Greek yogurt, plain, nonfat', serving: '170 g', g: 170, cal: 100, p: 17.0, c: 6.0, f: 0.7 },
  { id: 'cheese-cheddar', name: 'Cheddar cheese', serving: '30 g', g: 30, cal: 121, p: 6.9, c: 0.9, f: 10.0 },
  { id: 'cottage', name: 'Cottage cheese, 2%', serving: '1 cup (226 g)', g: 226, cal: 183, p: 24.0, c: 10.8, f: 5.0 },
  { id: 'whey', name: 'Whey protein', serving: '1 scoop (30 g)', g: 30, cal: 120, p: 24.0, c: 3.0, f: 1.5 },
  { id: 'peanut-butter', name: 'Peanut butter', serving: '1 tbsp (16 g)', g: 16, cal: 94, p: 4.0, c: 3.5, f: 7.5 },
  { id: 'almonds', name: 'Almonds', serving: '30 g', g: 30, cal: 174, p: 6.4, c: 6.5, f: 15.0 },
  { id: 'avocado', name: 'Avocado', serving: '1/2 medium (68 g)', g: 68, cal: 114, p: 1.3, c: 6.0, f: 9.5 },
  { id: 'beans-black', name: 'Black beans, cooked', serving: '1 cup (172 g)', g: 172, cal: 227, p: 15.2, c: 40.8, f: 0.9 },
  { id: 'lentils', name: 'Lentils, cooked', serving: '1 cup (198 g)', g: 198, cal: 230, p: 17.9, c: 39.9, f: 0.8 },
  { id: 'tofu', name: 'Tofu, firm', serving: '100 g', g: 100, cal: 144, p: 17.3, c: 2.8, f: 7.0 },
  { id: 'broccoli', name: 'Broccoli, cooked', serving: '1 cup (156 g)', g: 156, cal: 55, p: 3.7, c: 9.0, f: 0.6 },
  { id: 'salad', name: 'Mixed salad greens', serving: '2 cups (85 g)', g: 85, cal: 15, p: 1.4, c: 2.0, f: 0.2 },
  { id: 'sweet-potato', name: 'Sweet potato, baked', serving: '1 medium (114 g)', g: 114, cal: 103, p: 2.3, c: 23.6, f: 0.2 },
  { id: 'tortilla', name: 'Flour tortilla', serving: '1 medium (45 g)', g: 45, cal: 140, p: 3.7, c: 23.0, f: 3.5 },
  { id: 'coffee-latte', name: 'Latte, whole milk', serving: '12 oz (355 ml)', g: 355, cal: 170, p: 9.0, c: 14.0, f: 9.0 },
  { id: 'chocolate', name: 'Milk chocolate', serving: '30 g', g: 30, cal: 160, p: 2.3, c: 17.6, f: 9.0 },
]);

/** The table as the lines the meal prompt quotes. */
export const foodAnchorLines = () => FOODS.map(x => `- ${x.name}, ${x.serving}: ${x.cal} kcal, ${x.p} g P, ${x.c} g C, ${x.f} g F`).join('\n');

/* The thermodynamic check every estimate has to pass: calories are what the macros add up to.
 * Four per gram of protein and carbohydrate, nine per gram of fat; a reported figure more than
 * this far off is replaced by the arithmetic. Fibre (counted at less than four) and rounding make
 * a few percent of honest slack, so the line is eight: the prompt asks for five, and the
 * produce in the table carries net carbohydrate so it passes its own check. */
export const CAL_PER = Object.freeze({ p: 4, c: 4, f: 9 });
export const CROSS_CHECK_TOLERANCE = 0.08;
export const caloriesOf = (p, c, f) => Math.round((Number(p) || 0) * CAL_PER.p + (Number(c) || 0) * CAL_PER.c + (Number(f) || 0) * CAL_PER.f);
/** `{ cal, adjusted }`: the reported calories if they agree with the macros, else the arithmetic. */
export function crossCheck(cal, p, c, f) {
  const computed = caloriesOf(p, c, f);
  const reported = Number(cal);
  if (computed <= 0) return { cal: Number.isFinite(reported) && reported >= 0 ? Math.round(reported) : 0, adjusted: false };
  if (!Number.isFinite(reported) || Math.abs(reported - computed) / computed > CROSS_CHECK_TOLERANCE) return { cal: computed, adjusted: true };
  return { cal: Math.round(reported), adjusted: false };
}
