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

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The nearest of eight compass points for a bearing in degrees: 225 is "SW". */
export function compassPoint(degrees: number): string {
  const i = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return POINTS[i]!;
}

const MPH = 0.44704;

/** A fresh breeze (8 m/s, Beaufort 5) or gusts of 15 m/s and up. */
export function isWindy(w: Pick<Weather, 'windSpeed' | 'windGusts' | 'windUnit'>): boolean {
  const ms = (v: number) => (w.windUnit === 'mph' ? v * MPH : v);
  return (
    (w.windSpeed !== null && ms(w.windSpeed) >= 8) ||
    (w.windGusts !== null && ms(w.windGusts) >= 15)
  );
}
