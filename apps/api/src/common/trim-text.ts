import { Transform } from 'class-transformer';
export const TrimText = () => Transform(({ value }) => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item.trim() : item);
  return value;
});
