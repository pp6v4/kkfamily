import { clearSession, ensureSession } from './session';
import { ApiError, rawRequest } from './transport';

export interface RecipeCategory { id: string; name: string; sortOrder: number }
export interface RecipeIngredient { ingredientId: string; quantity: string | number | null; unit: string; optional: boolean; ingredient: { id: string; name: string } }
export interface Recipe { id: string; name: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; category?: RecipeCategory | null; ingredients: RecipeIngredient[]; seasonings: Array<{ id: string; name: string }>; steps: string[] }
export interface MealItem { id: string; addedById: string; recipeId: string; recipe: Recipe }
export interface Meal { id: string; scheduledAt: string; mealType: string; status: 'DRAFT' | 'CONFIRMED' | 'COOKING' | 'COMPLETED' | 'CANCELLED'; items: MealItem[] }
export interface IngredientComparison { ingredientId: string; name: string; unit: string; required: number | null; onHand: number | null; shortage: number | null; status: 'UNKNOWN' | 'SUFFICIENT' | 'SHORTAGE' }
export interface ShoppingItem { id: string; name: string; quantity: string | number | null; unit: string | null; status: 'WISHLIST' | 'NEXT_TRIP' | 'REPLENISH' | 'PURCHASED'; sourceType: string; sourceId: string | null }
export interface ShoppingList { id: string; name: string; items: ShoppingItem[] }
export interface InventoryItem { id: string; quantity: string | number; unit: string; location: string | null; ingredient: { id: string; name: string } }
export interface CalendarEvent { id: string; type: 'ANNIVERSARY' | 'MEAL' | 'TRIP' | 'TASK'; title: string; startsAt: string; endsAt: string | null; sourceType: string | null; sourceId: string | null }
export interface Trip { id: string; title: string; status: 'PLANNING' | 'PENDING' | 'DEPARTING' | 'COMPLETED' | 'CANCELLED'; startsAt: string; endsAt: string | null; destination: string | null; members: Array<{ membershipId: string; canEdit: boolean }> }

async function request<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: unknown): Promise<T> {
  const session = await ensureSession();
  try {
    return await rawRequest<T>(path, method, data, { Authorization: `Bearer ${session.accessToken}`, 'X-Household-Id': session.householdId });
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) clearSession();
    throw error;
  }
}

export function listRecipeCategories() { return request<RecipeCategory[]>('/recipes/categories'); }
export function listRecipes() { return request<Recipe[]>('/recipes'); }
export function createRecipe(input: { name: string; categoryId?: string; ingredients: Array<{ name: string; quantity?: number; unit: string; optional?: boolean }>; seasonings: string[]; steps: string[] }) { return request<Recipe>('/recipes', 'POST', input); }
export function updateRecipeStatus(recipeId: string, status: Recipe['status']) { return request<Recipe>(`/recipes/${recipeId}/status`, 'PATCH', { status }); }
export function listMeals(from: string, to: string) { return request<Meal[]>(`/meals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
export function createMeal(input: { scheduledAt: string; mealType: string }) { return request<Meal>('/meals', 'POST', input); }
export function addMealRecipe(mealId: string, recipeId: string) { return request<MealItem>(`/meals/${mealId}/items`, 'POST', { recipeId }); }
export function removeMealRecipe(mealId: string, recipeId: string) { return request<{ removed: boolean }>(`/meals/${mealId}/items/${recipeId}`, 'DELETE'); }
export function recalculateMeal(mealId: string) { return request<IngredientComparison[]>(`/meals/${mealId}/recalculate`, 'POST'); }
export function completeMeal(mealId: string, deductInventory: boolean) { return request<Meal>(`/meals/${mealId}/complete`, 'POST', { deductInventory }); }
export function listShoppingLists() { return request<ShoppingList[]>('/shopping-lists'); }
export function addShoppingItem(input: { name: string; quantity?: number; unit?: string }) { return request<ShoppingItem>('/shopping-lists/next-trip/items', 'POST', input); }
export function updateShoppingItem(itemId: string, status: ShoppingItem['status']) { return request<ShoppingItem>(`/shopping-lists/items/${itemId}`, 'PATCH', { status }); }
export function importMealShortages(mealId: string, items: Array<{ ingredientId: string; quantity: number; unit: string }>) { return request<{ list: ShoppingList; items: ShoppingItem[] }>('/shopping-lists/next-trip/import-shortages', 'POST', { mealId, items }); }
export function listInventory() { return request<InventoryItem[]>('/inventory'); }
export function setInventoryItem(input: { name: string; quantity: number; unit: string; location?: string }) { return request<InventoryItem>('/inventory', 'POST', input); }
export function listCalendarEvents(from: string, to: string) { return request<CalendarEvent[]>(`/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
export function createCalendarEvent(input: { type: CalendarEvent['type']; title: string; startsAt: string; endsAt?: string; sourceType?: string; sourceId?: string }) { return request<CalendarEvent>('/calendar/events', 'POST', input); }
export function listTrips() { return request<Trip[]>('/trips'); }
export function createTrip(input: { title: string; startsAt: string; endsAt?: string; destination?: string }) { return request<Trip>('/trips', 'POST', input); }
