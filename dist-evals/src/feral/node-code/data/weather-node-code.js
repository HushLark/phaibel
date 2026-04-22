// ─────────────────────────────────────────────────────────────────────────────
// Feral CCF — Weather Data NodeCode (Open-Meteo, no API key required)
// ─────────────────────────────────────────────────────────────────────────────
import { ResultStatus } from '../../result/result.js';
import { AbstractNodeCode } from '../abstract-node-code.js';
import { NodeCodeCategory } from '../node-code.js';
/** WMO Weather interpretation codes → human-readable descriptions. */
const WMO_CODES = {
    0: 'Clear sky',
    1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Depositing rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    56: 'Light freezing drizzle', 57: 'Dense freezing drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    66: 'Light freezing rain', 67: 'Heavy freezing rain',
    71: 'Slight snowfall', 73: 'Moderate snowfall', 75: 'Heavy snowfall',
    77: 'Snow grains',
    80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
    85: 'Slight snow showers', 86: 'Heavy snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with slight hail', 99: 'Thunderstorm with heavy hail',
};
export class WeatherNodeCode extends AbstractNodeCode {
    static configDescriptions = [
        { key: 'location', name: 'Location', description: 'City name to look up. Supports {context_key} interpolation.', type: 'string' },
        { key: 'units', name: 'Units', description: 'Unit system for temperature and wind speed.', type: 'string', default: 'metric', options: ['metric', 'imperial'] },
        { key: 'response_context_path', name: 'Response Path', description: 'Context key to store the weather summary object.', type: 'string', default: 'weather' },
    ];
    static resultDescriptions = [
        { status: ResultStatus.OK, description: 'Weather data retrieved successfully.' },
        { status: ResultStatus.ERROR, description: 'Geocoding or weather fetch failed.' },
    ];
    constructor() {
        super('weather', 'Weather Lookup', 'Fetches current weather for a city via Open-Meteo (no API key needed).', NodeCodeCategory.DATA);
    }
    async process(context) {
        const locationTemplate = this.getRequiredConfigValue('location');
        const units = this.getRequiredConfigValue('units', 'metric').toLowerCase();
        const responsePath = this.getRequiredConfigValue('response_context_path', 'weather');
        // Interpolate {context_key} references
        const city = locationTemplate.replace(/\{(\w+)\}/g, (_, key) => {
            return String(context.get(key) ?? '');
        }).trim();
        if (!city) {
            return this.result(ResultStatus.ERROR, 'Location resolved to an empty string.');
        }
        const isImperial = units === 'imperial';
        const tempUnit = isImperial ? 'fahrenheit' : 'celsius';
        const windUnit = isImperial ? 'mph' : 'kmh';
        try {
            // 1. Geocode city name → lat/lon
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
            const geoRes = await fetch(geoUrl);
            if (!geoRes.ok) {
                return this.result(ResultStatus.ERROR, `Geocoding request failed: ${geoRes.status}`);
            }
            const geoData = await geoRes.json();
            if (!geoData.results?.length) {
                return this.result(ResultStatus.ERROR, `No location found for "${city}".`);
            }
            const { latitude, longitude, name, country } = geoData.results[0];
            // 2. Fetch current weather
            const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;
            const wxRes = await fetch(wxUrl);
            if (!wxRes.ok) {
                return this.result(ResultStatus.ERROR, `Weather request failed: ${wxRes.status}`);
            }
            const wxData = await wxRes.json();
            const cur = wxData.current;
            const tempLabel = isImperial ? '°F' : '°C';
            const windLabel = isImperial ? 'mph' : 'km/h';
            const summary = {
                location: `${name}, ${country}`,
                condition: WMO_CODES[cur.weather_code] ?? `Code ${cur.weather_code}`,
                temperature: `${cur.temperature_2m}${tempLabel}`,
                feels_like: `${cur.apparent_temperature}${tempLabel}`,
                humidity: `${cur.relative_humidity_2m}%`,
                wind: `${cur.wind_speed_10m} ${windLabel}`,
            };
            context.set(responsePath, summary);
            return this.result(ResultStatus.OK, `Weather for ${summary.location}: ${summary.condition}, ${summary.temperature}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.result(ResultStatus.ERROR, `Weather lookup failed: ${message}`);
        }
    }
}
