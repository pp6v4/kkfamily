export interface RecipeDraft {
  id: string;
  name: string;
  category: string;
  ingredients: Array<{ name: string; quantity: string; unit: string }>;
  seasonings: string[];
  steps: string[];
  status: 'PUBLISHED' | 'DRAFT';
}

const key = 'kkfamily:recipe-drafts';
const defaults: RecipeDraft[] = [
  { id: 'tomato-beef', name: '番茄牛腩', category: '炖菜', ingredients: [{ name: '牛腩', quantity: '500', unit: 'g' }, { name: '番茄', quantity: '3', unit: '个' }, { name: '土豆', quantity: '2', unit: '个' }], seasonings: ['盐', '生抽'], steps: ['焯水', '炖煮'], status: 'PUBLISHED' },
  { id: 'broccoli', name: '蒜蓉西兰花', category: '炒菜', ingredients: [{ name: '西兰花', quantity: '1', unit: '颗' }, { name: '蒜', quantity: '3', unit: '瓣' }], seasonings: ['蚝油'], steps: ['焯水', '翻炒'], status: 'PUBLISHED' },
  { id: 'seafood-congee', name: '海鲜粥', category: '主食', ingredients: [{ name: '大米', quantity: '150', unit: 'g' }, { name: '虾', quantity: '8', unit: '只' }], seasonings: ['盐', '姜丝'], steps: ['熬粥', '加入海鲜'], status: 'PUBLISHED' },
];

export function getRecipes(): RecipeDraft[] {
  const saved = uni.getStorageSync(key) as RecipeDraft[] | '';
  return Array.isArray(saved) && saved.length ? saved : defaults;
}

export function saveRecipe(recipe: RecipeDraft) {
  uni.setStorageSync(key, [recipe, ...getRecipes()]);
}

export function publishRecipe(recipeId: string) {
  uni.setStorageSync(key, getRecipes().map((recipe) => recipe.id === recipeId ? { ...recipe, status: 'PUBLISHED' } : recipe));
}
