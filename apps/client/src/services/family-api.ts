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
export interface TripMember { membershipId: string; canEdit: boolean; tripRole: 'OWNER' | 'MEMBER'; status: 'ACTIVE' | 'HISTORY' | 'REVOKED'; version: number; membership: { id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } } }
export interface TripPreparationGroup { id: string; name: string; version: number; members: Array<{ membershipId: string }> }
export interface TripStop { id: string; version: number; title: string; stopType: 'MEETING' | 'WAYPOINT' | 'CAMPSITE' | 'ATTRACTION' | 'HOTEL' | 'RETURN'; latitude: string | number; longitude: string | number; coordSystem: 'GCJ02'; arriveAt: string | null; leaveAt: string | null; sortOrder: number; note: string | null }
export interface TripLeg { id: string; version: number; fromStopId: string; toStopId: string; mode: 'DRIVING' | 'RAIL' | 'FLIGHT' | 'WALKING' | 'OTHER'; routeKind: 'PLANNED' | 'SCHEMATIC'; geometryJson: number[][] | null; provider: string | null; distanceMeters: number | null; durationSeconds: number | null; staleAt: string | null; fromStop: TripStop; toStop: TripStop }
export interface Accommodation { id: string; version: number; stopId: string | null; name: string; address: string | null; checkInDate: string; checkOutDate: string; contact: string | null; reservationNote: string | null; stop: TripStop | null }
export interface TripItinerary { tripVersion: number; stops: TripStop[]; legs: TripLeg[]; accommodations: Accommodation[] }
export interface Trip { id: string; version: number; title: string; status: 'PLANNING' | 'PENDING' | 'DEPARTING' | 'COMPLETED' | 'CANCELLED'; startsAt: string; endsAt: string | null; destination: string | null; members: TripMember[]; preparationGroups: TripPreparationGroup[]; stops?: TripStop[]; legs?: TripLeg[]; _count?: { packingItems: number } }
export interface PackingTemplateItem { id: string; name: string; defaultQuantity: string | number | null; unit: string | null; note: string | null; sortOrder: number }
export interface PackingTemplate { id: string; createdById: string; name: string; description: string | null; archived: boolean; items: PackingTemplateItem[] }
export interface TripPackingItem { id: string; version: number; name: string; quantity: string | number | null; unit: string | null; note: string | null; status: 'PENDING' | 'PACKED'; responsibleMembershipId: string | null; groupId: string | null; sourceTemplateNameSnapshot: string | null; sourceItemNameSnapshot: string | null; sourceTemplate: { id: string; name: string } | null; group: { id: string; name: string } | null; responsibleMembership: { id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } } | null }
export interface TaskPerson { id:string; user:{id:string;nickname:string|null;avatarUrl:string|null} }
export interface TaskHistory { id:string; fromStatus:Task['status']|null; toStatus:Task['status']|null; comment:string|null; createdAt:string; actor:TaskPerson }
export interface Task { id:string; version:number; type:'TODO'|'REQUEST'; title:string; description:string|null; assigneeMembershipId:string|null; dueAt:string|null; reminderAt:string|null; priority:'LOW'|'NORMAL'|'HIGH'; status:'PENDING'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'; completedAt:string|null; assignee:TaskPerson|null; createdBy:TaskPerson; completedBy:TaskPerson|null; history?:TaskHistory[] }
export interface FavoriteConversion { id:string; targetType:'RECIPE'|'TASK'; targetId:string; createdAt:string }
export interface Favorite { id:string; version:number; type:'TEXT'|'IMAGE'|'LINK'; title:string; text:string|null; sourceUrl:string|null; assetIds:string[]; tags:string[]; visibility:'PRIVATE'|'HOUSEHOLD'; createdById:string; createdBy:TaskPerson; conversions:FavoriteConversion[]; createdAt:string; updatedAt:string }

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
export interface TripPhoto { id:string; mimeType:string; byteSize:number; createdAt:string; createdBy:{id:string;nickname:string|null;avatarUrl:string|null} }
export function createMediaUploadIntent(input:{ownerType:'RECIPE'|'TRIP'|'FAVORITE';ownerId:string;expectedOwnerVersion:number;mimeType:'image/jpeg'|'image/png'|'image/webp';byteSize:number}){return request<{id:string;uploadPath:string;mimeType:string;byteSize:number;expiresAt:string}>('/media/upload-intents','POST',input);}
export function uploadMediaContent(uploadPath:string,data:ArrayBuffer,mimeType:string){return binaryRequest<{intentId:string;checksumSha256:string;byteSize:number}>(uploadPath,data,mimeType);}
export function confirmMediaAsset(intentId:string,checksumSha256:string){return request<{asset:MediaAsset;ownerVersion:number}>('/media/assets/confirm','POST',{intentId,checksumSha256});}
export function getMediaReadUrl(assetId:string){return request<{path:string;expiresAt:string}>(`/media/assets/${assetId}/url`);}
export function listTripPhotos(tripId:string){return request<TripPhoto[]>(`/trips/${tripId}/photos`);}
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
export function getTrip(tripId: string) { return request<Trip>(`/trips/${tripId}`); }
export function updateTripStatus(trip: Trip, status: Trip['status']) { return request<Trip>(`/trips/${trip.id}/status`, 'PATCH', { expectedVersion: trip.version, status }); }
export function listTripCandidates(tripId: string) { return request<Array<{ id: string; user: { id: string; nickname: string | null; avatarUrl: string | null } }>>(`/trips/${tripId}/candidates`); }
export function addTripMember(tripId: string, membershipId: string, canEdit = true) { return request<Trip>(`/trips/${tripId}/members`, 'POST', { membershipId, canEdit }); }
export function updateTripMember(tripId: string, member: TripMember, input: { canEdit?: boolean; tripRole?: TripMember['tripRole']; status?: 'ACTIVE' | 'REVOKED'; clearResponsibilities?: boolean }) { return request<Trip>(`/trips/${tripId}/members/${member.membershipId}`, 'PATCH', { expectedVersion: member.version, ...input }); }
export function createTripPreparationGroup(tripId: string, name: string, membershipIds: string[]) { return request<TripPreparationGroup>(`/trips/${tripId}/preparation-groups`, 'POST', { name, membershipIds }); }
export function getTripItinerary(tripId: string) { return request<TripItinerary>(`/trips/${tripId}/itinerary`); }
export function createTripStop(trip: Trip, input: { title: string; stopType: TripStop['stopType']; latitude: number; longitude: number; arriveAt?: string; leaveAt?: string; note?: string }) { return request<{ tripVersion: number; stop: TripStop }>(`/trips/${trip.id}/stops`, 'POST', { expectedTripVersion: trip.version, ...input }); }
export function updateTripStop(trip: Trip, stop: TripStop, input: Partial<Pick<TripStop, 'title' | 'stopType'>> & { latitude?: number; longitude?: number; arriveAt?: string | null; leaveAt?: string | null; note?: string }) { return request<{ tripVersion: number; stop: TripStop }>(`/trips/${trip.id}/stops/${stop.id}`, 'PATCH', { expectedTripVersion: trip.version, expectedVersion: stop.version, ...input }); }
export function reorderTripStops(trip: Trip, stopIds: string[]) { return request<{ tripVersion: number; stops: TripStop[] }>(`/trips/${trip.id}/stops/reorder`, 'POST', { expectedTripVersion: trip.version, stopIds }); }
export function getTripStopDeleteImpact(tripId: string, stopId: string) { return request<{ stopId: string; legs: Array<{ id: string }>; accommodations: Array<{ id: string; name: string }> }>(`/trips/${tripId}/stops/${stopId}/delete-impact`); }
export function removeTripStop(trip: Trip, stop: TripStop, confirm: boolean) { return request<{ removed: boolean; tripVersion: number; affected: { legCount: number; accommodationCount: number } }>(`/trips/${trip.id}/stops/${stop.id}?expectedVersion=${stop.version}&expectedTripVersion=${trip.version}&confirm=${confirm}`, 'DELETE'); }
export function createTripLeg(trip: Trip, input: { fromStopId: string; toStopId: string; mode: TripLeg['mode']; routeKind?: TripLeg['routeKind']; geometry?: number[][]; provider?: string; distanceMeters?: number; durationSeconds?: number }) { return request<{ tripVersion: number; leg: TripLeg }>(`/trips/${trip.id}/legs`, 'POST', { expectedTripVersion: trip.version, ...input }); }
export function updateTripLeg(trip: Trip, leg: TripLeg, input: Partial<Pick<TripLeg, 'fromStopId' | 'toStopId' | 'mode' | 'routeKind' | 'distanceMeters' | 'durationSeconds'>> & { geometry?: number[][]; provider?: string }) { return request<{ tripVersion: number; leg: TripLeg }>(`/trips/${trip.id}/legs/${leg.id}`, 'PATCH', { expectedTripVersion: trip.version, expectedVersion: leg.version, ...input }); }
export function removeTripLeg(trip: Trip, leg: TripLeg) { return request<{ removed: boolean; tripVersion: number }>(`/trips/${trip.id}/legs/${leg.id}?expectedVersion=${leg.version}&expectedTripVersion=${trip.version}`, 'DELETE'); }
export function createAccommodation(trip: Trip, input: { stopId?: string; name: string; address?: string; checkInDate: string; checkOutDate: string; contact?: string; reservationNote?: string }) { return request<{ tripVersion: number; accommodation: Accommodation }>(`/trips/${trip.id}/accommodations`, 'POST', { expectedTripVersion: trip.version, ...input }); }
export function updateAccommodation(trip: Trip, accommodation: Accommodation, input: Partial<Omit<Pick<Accommodation, 'stopId' | 'name' | 'address' | 'checkInDate' | 'checkOutDate' | 'contact' | 'reservationNote'>, 'stopId'>> & { stopId?: string | null }) { return request<{ tripVersion: number; accommodation: Accommodation }>(`/trips/${trip.id}/accommodations/${accommodation.id}`, 'PATCH', { expectedTripVersion: trip.version, expectedVersion: accommodation.version, ...input }); }
export function removeAccommodation(trip: Trip, accommodation: Accommodation) { return request<{ removed: boolean; tripVersion: number }>(`/trips/${trip.id}/accommodations/${accommodation.id}?expectedVersion=${accommodation.version}&expectedTripVersion=${trip.version}`, 'DELETE'); }
export function listPackingTemplates() { return request<PackingTemplate[]>('/packing-templates'); }
export function createPackingTemplate(input: { name: string; description?: string; items: Array<{ name: string; quantity?: number; unit?: string; note?: string; sortOrder?: number }> }) { return request<PackingTemplate>('/packing-templates', 'POST', input); }
export function updatePackingTemplate(templateId: string, input: { name?: string; description?: string; archived?: boolean; items?: Array<{ id?: string; name: string; quantity?: number; unit?: string; note?: string; sortOrder?: number }> }) { return request<PackingTemplate>(`/packing-templates/${templateId}`, 'PATCH', input); }
export function listTripPackingItems(tripId: string) { return request<TripPackingItem[]>(`/trips/${tripId}/packing-items`); }
export function applyPackingTemplate(tripId: string, templateId: string) { return request<{ templateId: string; addedCount: number; skippedCount: number; items: TripPackingItem[] }>(`/trips/${tripId}/packing-items/apply-template`, 'POST', { templateId }); }
export function createTripPackingItem(tripId: string, input: { name: string; quantity?: number; unit?: string; note?: string; responsibleMembershipId?: string; groupId?: string }) { return request<TripPackingItem>(`/trips/${tripId}/packing-items`, 'POST', input); }
export function updateTripPackingItem(tripId: string, item: TripPackingItem, input: { name?: string; quantity?: number; unit?: string; note?: string; status?: TripPackingItem['status']; responsibleMembershipId?: string; groupId?: string }) { return request<TripPackingItem>(`/trips/${tripId}/packing-items/${item.id}`, 'PATCH', { expectedVersion: item.version, ...input }); }
export function removeTripPackingItem(tripId: string, item: TripPackingItem) { return request<{ removed: boolean }>(`/trips/${tripId}/packing-items/${item.id}?expectedVersion=${item.version}`, 'DELETE'); }
export function listTasks(status?:Task['status']){return request<Task[]>(`/tasks${status?`?status=${status}`:''}`);}
export function getTask(taskId:string){return request<Task>(`/tasks/${taskId}`);}
export function listTaskAssignees(){return request<TaskPerson[]>('/tasks/assignees');}
export function createTask(input:{type:Task['type'];title:string;description?:string;assigneeMembershipId?:string;dueAt?:string;priority:Task['priority'];reminderAt?:string}){return request<Task>('/tasks','POST',input);}
export function updateTask(task:Task,input:{type?:Task['type'];title?:string;description?:string;assigneeMembershipId?:string|null;dueAt?:string|null;priority?:Task['priority'];reminderAt?:string|null}){return request<Task>(`/tasks/${task.id}`,'PATCH',{expectedVersion:task.version,...input});}
export function updateTaskStatus(task:Task,status:Task['status'],reason?:string){return request<Task>(`/tasks/${task.id}/status`,'PATCH',{expectedVersion:task.version,status,reason});}
export function addTaskComment(taskId:string,comment:string){return request<Task>(`/tasks/${taskId}/comments`,'POST',{comment});}
export function listFavorites(){return request<Favorite[]>('/favorites');}
export function getFavorite(favoriteId:string){return request<Favorite>(`/favorites/${favoriteId}`);}
export function createFavorite(input:{type:Favorite['type'];title:string;text?:string;sourceUrl?:string;tags:string[];visibility:Favorite['visibility']}){return request<Favorite>('/favorites','POST',input);}
export function updateFavorite(favorite:Favorite,input:{type?:Favorite['type'];title?:string;text?:string|null;sourceUrl?:string|null;tags?:string[];visibility?:Favorite['visibility']}){return request<Favorite>(`/favorites/${favorite.id}`,'PATCH',{expectedVersion:favorite.version,...input});}
export function archiveFavorite(favorite:Favorite){return request<{archived:boolean;id:string}>(`/favorites/${favorite.id}/archive`,'POST',{expectedVersion:favorite.version});}
export function convertFavorite(favorite:Favorite,input:{targetType:'RECIPE'|'TASK';idempotencyKey:string;confirmedTitle:string;confirmedDescription?:string}){return request<{targetId:string;targetType:'RECIPE'|'TASK';status:'DRAFT';repeated:boolean}>(`/favorites/${favorite.id}/convert`,'POST',{expectedVersion:favorite.version,...input});}
