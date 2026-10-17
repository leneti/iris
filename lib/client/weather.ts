import type { Weather } from '@/lib/shared/contract';

type Condition = NonNullable<Weather['condition']>;

const WORD: Record<Condition, string> = {
  clear: 'Clear',
  'partly-cloudy': 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  snow: 'Snow',
  showers: 'Showers',
  thunderstorm: 'Thunderstorm',
};

/** "Partly cloudy"; "Weather" when the condition is not known. */
export function conditionWord(c: Condition | null): string {
  return c === null ? 'Weather' : WORD[c];
}
