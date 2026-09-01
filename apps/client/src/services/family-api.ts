import { clearSession, ensureSession } from './session';
import { ApiError, rawBinaryRequest, rawRequest } from './transport';
import { API_BASE_URL } from './config';

export interface RecipeCategory { id: string; name: string; sortOrder: number }
export interface RecipeIngredient { ingredientId: string; quantity: string | number | null; unit: string; optional: boolean; ingredient: { id: string; name: string } }
export interface Recipe { id: string; version: number; name: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; coverAssetId?: string | null; category?: RecipeCategory | null; ingredients: RecipeIngredient[]; seasonings: Array<{ id: string; name: string }>; steps: string[] }
export interface MealItem { id: string; addedById: string; recipeId: string; recipe: Recipe }
export interface MealDish { recipeId: string; recipe: Recipe; cookMultiplier: string; wantedBy: Array<{ membershipId: string; nickname: string | null }> }
export interface Meal { id: string; version: number; snapshotVersion: number; localDate: string; slotKey: string; legacyWithoutSnapshot: boolean; scheduledAt: string; mealType: string; status: 'DRAFT' | 'CONFIRMED' | 'COOKING' | 'COMPLETED' | 'CANCELLED'; items: MealItem[]; menu: MealDish[] }
export interface IngredientComparison { key: string; kind: 'FOOD' | 'SEASONING'; ingredientId: string | null; name: string; unit: string; required: string | null; onHand: string | null; shortage: string | null; status: 'UNKNOWN' | 'SUFFICIENT' | 'SHORTAGE' | 'PRESENT' | 'ABSENT' | 'NEEDS_CHECK'; reason: string; batches: Array<{ id: string; version: number; quantity: string | null; location: string | null; availability: string; expiresAt: string | null }> }
export interface ShoppingItem { id: string; version: number; name: string; quantity: string | number | null; unit: string | null; status: 'WISHLIST' | 'NEXT_TRIP' | 'REPLENISH' | 'PURCHASED'; sourceType: string; sourceId: string | null; sourceVersion: number | null; purchasedAt: string | null; previousItemId: string | null }
export interface ShoppingList { id: string; name: string; items: ShoppingItem[] }
export interface InventoryItem { id: string; version: number; quantity: string | number | null; unit: string; location: string | null; expiresAt: string | null; availability: 'PRESENT' | 'ABSENT' | 'UNKNOWN'; ingredient: { id: string; name: string; kind: 'FOOD' | 'SEASONING' } }
export interface CalendarEvent { id: string; type: 'ANNIVERSARY' | 'MEAL' | 'TRIP' | 'TASK'; title: string; startsAt: string; endsAt: string | null; sourceType: string | null; sourceId: string | null }
export interface TripMember { membershipId: string; canEdit: boolean; membership: { id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } } }
export interface Trip { id: string; title: string; status: 'PLANNING' | 'PENDING' | 'DEPARTING' | 'COMPLETED' | 'CANCELLED'; startsAt: string; endsAt: string | null; destination: string | null; members: TripMember[]; _count?: { packingItems: number } }
export interface PackingTemplateItem { id: string; name: string; defaultQuantity: string | number | null; unit: string | null; note: string | null; sortOrder: number }
export interface PackingTemplate { id: string; createdById: string; name: string; description: string | null; archived: boolean; items: PackingTemplateItem[] }
export interface TripPackingItem { id: string; name: string; quantity: string | number | null; unit: string | null; note: string | null; status: 'PENDING' | 'PACKED'; responsibleMembershipId: string | null; sourceTemplate: { id: string; name: string } | null; responsibleMembership: { id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } } | null }

async function request<T>(path: string, method: UniApp.RequestOptions['method'] = 'GET', data?: unknown): Promise<T> {
  const session = await ensureSession();
  try {
    return await rawRequest<T>(path, method, data, { Authorization: `Bearer ${session.accessToken}`, 'X-Household-Id': session.householdId });
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 401) clearSession();
    throw error;
  }
}
async function binaryRequest<T>(path:string,data:ArrayBuffer,mimeType:string){const session=await ensureSession();try{return await rawBinaryRequest<T>(path,'PUT',data,mimeType,{Authorization:`Bearer ${session.accessToken}`,'X-Household-Id':session.householdId});}catch(error){if(error instanceof ApiError&&error.statusCode===401)clearSession();throw error;}}

export function listRecipeCategories() { return request<RecipeCategory[]>('/recipes/categories'); }
export function listRecipes() { return request<Recipe[]>('/recipes'); }
export function getRecipe(recipeId: string) { return request<Recipe>(`/recipes/${recipeId}`); }
export function createRecipe(input: { name: string; categoryId?: string; ingredients: Array<{ name: string; quantity?: number; unit: string; optional?: boolean }>; seasonings: string[]; steps: string[] }) { return request<Recipe>('/recipes', 'POST', input); }
export function updateRecipe(recipeId: string, input: { expectedVersion: number; name: string; categoryId?: string; ingredients: Array<{ name: string; quantity?: number; unit: string; optional?: boolean }>; seasonings: string[]; steps: string[] }) { return request<Recipe>(`/recipes/${recipeId}`, 'PATCH', input); }
export function updateRecipeStatus(recipe: Recipe, status: Recipe['status']) { return request<Recipe>(`/recipes/${recipe.id}/status`, 'PATCH', { status, expectedVersion: recipe.version }); }
export interface MediaAsset { id:string; mimeType:string; byteSize:number; checksumSha256:string }
export function createMediaUploadIntent(input:{ownerType:'RECIPE';ownerId:string;expectedOwnerVersion:number;mimeType:'image/jpeg'|'image/png'|'image/webp';byteSize:number}){return request<{id:string;uploadPath:string;mimeType:string;byteSize:number;expiresAt:string}>('/media/upload-intents','POST',input);}
export function uploadMediaContent(uploadPath:string,data:ArrayBuffer,mimeType:string){return binaryRequest<{intentId:string;checksumSha256:string;byteSize:number}>(uploadPath,data,mimeType);}
export function confirmMediaAsset(intentId:string,checksumSha256:string){return request<{asset:MediaAsset;ownerVersion:number}>('/media/assets/confirm','POST',{intentId,checksumSha256});}
export function getMediaReadUrl(assetId:string){return request<{path:string;expiresAt:string}>(`/media/assets/${assetId}/url`);}
export function publicMediaUrl(path:string){return `${API_BASE_URL}${path}`;}
export function listMeals(from: string, to: string) { return request<Meal[]>(`/meals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
export const mealTypeCodes: Record<string, string> = { 早餐: 'BREAKFAST', 午餐: 'LUNCH', 晚餐: 'DINNER', 加餐: 'OTHER' };
export function mealTypeLabel(code: string) { return Object.keys(mealTypeCodes).find(k => mealTypeCodes[k] === code) ?? code; }
export function createMeal(input: { scheduledAt: string; mealType: string; slotKey?: string }) { return request<Meal>('/meals', 'POST', input); }
export function addMealRecipe(mealId: string, recipeId: string) { return request<MealItem>(`/meals/${mealId}/items`, 'POST', { recipeId }); }
export function removeMealRecipe(mealId: string, recipeId: string) { return request<{ removed: boolean }>(`/meals/${mealId}/items/${recipeId}`, 'DELETE'); }
export function recalculateMeal(mealId: string) { return request<IngredientComparison[]>(`/meals/${mealId}/recalculate`, 'POST'); }
export function completeMeal(meal: Meal) { return request<Meal>(`/meals/${meal.id}/complete`, 'POST', { expectedVersion: meal.version }); }
export function transitionMeal(meal: Meal, action: 'confirm' | 'reopen' | 'start' | 'cancel', reason?: string) { return request<Meal>(`/meals/${meal.id}/${action}`, 'POST', { expectedVersion: meal.version, reason }); }
export function updateMealDish(meal: Meal, recipeId: string, cookMultiplier: number) { return request<Meal>(`/meals/${meal.id}/dishes/${recipeId}`, 'PATCH', { expectedVersion: meal.version, cookMultiplier }); }
export function listMealSnapshots(mealId: string) { return request<Array<{ version: number; createdAt: string; data: { dishes: MealDish[] } }>>(`/meals/${mealId}/snapshots`); }
export function listShoppingLists() { return request<ShoppingList[]>('/shopping-lists'); }
export function addShoppingItem(input: { name: string; quantity?: number; unit?: string; status?: 'WISHLIST' | 'NEXT_TRIP' | 'REPLENISH' }) { return request<ShoppingItem>('/shopping-lists/next-trip/items', 'POST', input); }
export function updateShoppingItem(item: ShoppingItem, status: ShoppingItem['status']) { return request<ShoppingItem>(`/shopping-lists/items/${item.id}`, 'PATCH', { status, expectedVersion: item.version }); }
export function repeatShoppingItem(itemId: string, requestId: string) { return request<ShoppingItem>(`/shopping-lists/items/${itemId}/repeat`, 'POST', { requestId }); }
export function importMealShortages(meal: Meal, selectedRequirementIds: string[]) { return request<{ list: ShoppingList; items: ShoppingItem[] }>('/shopping-lists/next-trip/import-shortages', 'POST', { mealId: meal.id, snapshotVersion: meal.snapshotVersion, selectedRequirementIds }); }
export function listInventory() { return request<InventoryItem[]>('/inventory'); }
export interface SetInventoryInput { name: string; quantity?: number; unit?: string; location?: string; kind?: 'FOOD' | 'SEASONING'; availability?: 'PRESENT' | 'ABSENT' | 'UNKNOWN'; id?: string; expectedVersion?: number; expiresAt?: string }
export function setInventoryItem(input: SetInventoryInput) { return request<InventoryItem>('/inventory', 'POST', input); }
export function listCalendarEvents(from: string, to: string) { return request<CalendarEvent[]>(`/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); }
export function createCalendarEvent(input: { type: CalendarEvent['type']; title: string; startsAt: string; endsAt?: string; sourceType?: string; sourceId?: string }) { return request<CalendarEvent>('/calendar/events', 'POST', input); }
export function listTrips() { return request<Trip[]>('/trips'); }
export function createTrip(input: { title: string; startsAt: string; endsAt?: string; destination?: string }) { return request<Trip>('/trips', 'POST', input); }
export function listPackingTemplates() { return request<PackingTemplate[]>('/packing-templates'); }
export function createPackingTemplate(input: { name: string; description?: string; items: Array<{ name: string; quantity?: number; unit?: string; note?: string; sortOrder?: number }> }) { return request<PackingTemplate>('/packing-templates', 'POST', input); }
export function updatePackingTemplate(templateId: string, input: { name?: string; description?: string; archived?: boolean; items?: Array<{ id?: string; name: string; quantity?: number; unit?: string; note?: string; sortOrder?: number }> }) { return request<PackingTemplate>(`/packing-templates/${templateId}`, 'PATCH', input); }
export function listTripPackingItems(tripId: string) { return request<TripPackingItem[]>(`/trips/${tripId}/packing-items`); }
export function applyPackingTemplate(tripId: string, templateId: string) { return request<{ templateId: string; addedCount: number; skippedCount: number; items: TripPackingItem[] }>(`/trips/${tripId}/packing-items/apply-template`, 'POST', { templateId }); }
export function createTripPackingItem(tripId: string, input: { name: string; quantity?: number; unit?: string; note?: string; responsibleMembershipId?: string }) { return request<TripPackingItem>(`/trips/${tripId}/packing-items`, 'POST', input); }
export function updateTripPackingItem(tripId: string, itemId: string, input: { name?: string; quantity?: number; unit?: string; note?: string; status?: TripPackingItem['status']; responsibleMembershipId?: string }) { return request<TripPackingItem>(`/trips/${tripId}/packing-items/${itemId}`, 'PATCH', input); }
export function removeTripPackingItem(tripId: string, itemId: string) { return request<{ removed: boolean }>(`/trips/${tripId}/packing-items/${itemId}`, 'DELETE'); }
