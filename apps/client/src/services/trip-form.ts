// Travel timestamps are displayed in the household's Shanghai timezone, not
// the device timezone. Accommodation dates are calendar dates, not instants.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function shanghaiDate(value: string): string {
  if (isCalendarDate(value)) return value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function travelTimestamp(day: string, hour: '08' | '18' | '20', original?: string | null): string | undefined {
  if (!day) return undefined;
  if (!isCalendarDate(day)) throw new Error('请选择有效日期');
  // Editing a title must not silently replace the original arrival/departure time.
  if (original && shanghaiDate(original) === day) return original;
  return `${day}T${hour}:00:00+08:00`;
}

export function assertTravelOrder(start?: string, end?: string): void {
  if (start && end && Date.parse(end) < Date.parse(start)) throw new Error('结束时间不能早于开始时间');
}

export function parseCoordinates(latitudeText: string, longitudeText: string): { latitude: number; longitude: number } {
  const latitudeValue = latitudeText.trim(), longitudeValue = longitudeText.trim();
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const latitude = Number(latitudeValue), longitude = Number(longitudeValue);
  if (!decimal.test(latitudeValue) || !decimal.test(longitudeValue)
    || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('请填写有效经纬度：纬度 -90～90，经度 -180～180');
  }
  return { latitude, longitude };
}
