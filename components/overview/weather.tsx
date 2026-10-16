import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
} from 'lucide-react';
import type { Weather as WeatherData } from '@/lib/shared/contract';

type Condition = NonNullable<WeatherData['condition']>;

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

function Glyph({ condition, isDay }: { condition: Condition | null; isDay: boolean | null }) {
  const cls = 'size-4';
  const night = isDay === false;
  switch (condition) {
    case 'clear':
      return night ? <Moon aria-hidden className={cls} /> : <Sun aria-hidden className={cls} />;
    case 'partly-cloudy':
      return night ? (
        <CloudMoon aria-hidden className={cls} />
      ) : (
        <CloudSun aria-hidden className={cls} />
      );
    case 'fog':
      return <CloudFog aria-hidden className={cls} />;
    case 'drizzle':
      return <CloudDrizzle aria-hidden className={cls} />;
    case 'rain':
    case 'showers':
      return <CloudRain aria-hidden className={cls} />;
    case 'snow':
      return <CloudSnow aria-hidden className={cls} />;
    case 'thunderstorm':
      return <CloudLightning aria-hidden className={cls} />;
    default:
      return <Cloud aria-hidden className={cls} />;
  }
}

/** One quiet line: icon, temperature, condition word, place. Hidden unless the read worked. */
export function Weather({
  weather,
  compact = false,
}: {
  weather: WeatherData | null | undefined;
  /** The phone's top bar: the icon and the temperature only. */
  compact?: boolean;
}) {
  if (!weather || weather.state !== 'ok' || weather.temperature === null) return null;
  const temperature = `${Math.round(weather.temperature)} ${weather.unit === 'celsius' ? '°C' : '°F'}`;
  if (compact) {
    return (
      <p className="flex items-center gap-1.5 text-text-2">
        <Glyph condition={weather.condition} isDay={weather.isDay} />
        <span className="sr-only">{weather.label}: </span>
        <span className="text-[15px] font-semibold text-text tabular-nums">{temperature}</span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 text-xs text-text-2">
      <Glyph condition={weather.condition} isDay={weather.isDay} />
      <span className="font-semibold text-text tabular-nums">{temperature}</span>
      {weather.condition && <span>{WORD[weather.condition]}</span>}
      <span aria-hidden>·</span>
      <span>{weather.label}</span>
    </p>
  );
}
